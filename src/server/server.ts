/**
 * Local HTTP server: one URL per note, rendered with deckrun on request.
 *
 *   /                          index of every folder and note
 *   /hld/                      folder listing
 *   /hld/caching  /caching     deck for HLD/Caching.md
 *   /hld/consistant-hashing    typos redirect to the closest note
 *   /introduction              ambiguous names show a picker
 *   /hld/hld?mode=links        MOC note + every note it links
 *   /dsa/graph?mode=dir        every note in a folder
 *   ?theme= ?template= ?transition= ?head= ?body= ?reveal=1 ?raw=1
 *   /HLD/_resources/x.png      any vault file
 *   /__open?path=HLD/Caching.md   redirect to the note's canonical URL
 *   /__mtime?path=...          note mtime, polled by open decks for live reload
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { createReadStream, promises as fs } from "fs";
import { basename, extname, join, relative, resolve, sep } from "path";
import type { NoteSource } from "./source";
import { convertMany, convertNote, outgoingLinks, renderSlides } from "../convert/convert";
import { naturalCompare, similarity, slugPath, slugify, stripNumericPrefix } from "../convert/slug";
import { renderDeckHtml } from "../render";

export interface ServerDefaults {
  theme: string;
  template: string;
  transition: string;
}

export interface ServerOptions {
  port: number;
  host?: string;
  defaults: ServerDefaults;
  /** Visible lines per slide before splitting. Default 10. */
  maxSlideLines?: number;
  /** Append an auto "Related notes" slide to single-note decks. Default true. */
  relatedSlide?: boolean;
  log?: (msg: string) => void;
}

interface NoteRef {
  rel: string; // "HLD/Caching.md"
  name: string; // "Caching"
  folder: string; // "HLD"
  slug: string; // "hld/caching"
  base: string; // "caching"
}
interface FolderRef {
  rel: string;
  name: string;
  slug: string;
}
interface Index {
  notes: NoteRef[];
  folders: FolderRef[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;
const SKIP = new Set([".git", ".obsidian", ".deck", "node_modules", ".trash"]);
const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf", ".css": "text/css",
  ".js": "text/javascript", ".md": "text/markdown; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

async function buildIndex(source: NoteSource): Promise<Index> {
  const notes: NoteRef[] = [];
  const folderSet = new Map<string, FolderRef>();
  for (const rel of await source.listMarkdown()) {
    const noExt = rel.slice(0, -3);
    const parts = noExt.split("/");
    const folder = parts.slice(0, -1).join("/");
    notes.push({ rel, name: parts[parts.length - 1], folder, slug: slugPath(noExt), base: slugify(parts[parts.length - 1]) });
    for (let i = 1; i <= parts.length - 1; i++) {
      const f = parts.slice(0, i).join("/");
      if (!folderSet.has(f)) folderSet.set(f, { rel: f, name: parts[i - 1], slug: slugPath(f) });
    }
  }
  return { notes, folders: [...folderSet.values()] };
}

const isMoc = (n: NoteRef) => !!n.folder && slugify(n.folder.split("/").pop() ?? "") === n.base;

function resolveLink(target: string, idx: Index): NoteRef | undefined {
  let key = target.trim().toLowerCase();
  if (key.endsWith(".md")) key = key.slice(0, -3);
  return idx.notes.find((n) => n.rel.slice(0, -3).toLowerCase() === key) ?? idx.notes.find((n) => n.name.toLowerCase() === key);
}

type Route =
  | { root: true }
  | { note: NoteRef }
  | { folder: FolderRef }
  | { redirect: NoteRef }
  | { choices: NoteRef[]; query: string }
  | null;

function route(pathname: string, idx: Index): Route {
  const slug = pathname.split("/").filter(Boolean).map(slugify).join("/");
  if (!slug) return { root: true };
  const exact = idx.notes.find((n) => n.slug === slug);
  if (exact) return { note: exact };
  const folder = idx.folders.find((f) => f.slug === slug);
  if (folder) return { folder };

  const segs = slug.split("/");
  const last = segs[segs.length - 1];
  const prefix = segs.slice(0, -1).join("/");
  const inPrefix = (n: NoteRef) => !prefix || n.slug.startsWith(prefix + "/") || n.slug.includes("/" + prefix + "/");
  let cands = idx.notes.filter((n) => n.base === last && inPrefix(n));
  if (!cands.length) cands = idx.notes.filter((n) => stripNumericPrefix(n.base) === stripNumericPrefix(last) && inPrefix(n));
  if (cands.length === 1) return { redirect: cands[0] };
  if (cands.length > 1) return { choices: cands, query: slug };

  const scored = idx.notes
    .map((n) => ({ n, s: Math.max(similarity(n.base, last), similarity(n.slug, slug), n.base.includes(last) ? 0.75 : 0) }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (best && best.s >= 0.6 && (scored.length < 2 || best.s - scored[1].s > 0.05 || best.s > 0.9)) return { redirect: best.n };
  const near = scored.filter((x) => x.s >= 0.4).slice(0, 8).map((x) => x.n);
  return near.length ? { choices: near, query: slug } : null;
}

// ---------------------------------------------------------------------------
// deck building
// ---------------------------------------------------------------------------

export type DeckMode = "single" | "links" | "dir";

async function deckMarkdown(
  source: NoteSource,
  idx: Index,
  target: NoteRef | FolderRef,
  mode: DeckMode,
  reveal: boolean,
  maxSlideLines?: number,
  relatedSlide = true,
): Promise<string> {
  if ("base" in target && mode === "single") {
    const text = await source.read(target.rel);
    return renderSlides(convertNote(text, { relPath: target.rel, reveal, relatedSlide, maxSlideLines }).slides);
  }
  let order: NoteRef[];
  if (mode === "dir" || !("base" in target)) {
    const folder = target.rel;
    order = idx.notes.filter((n) => n.folder === folder || n.folder.startsWith(folder + "/")).sort((a, b) => naturalCompare(a.rel, b.rel));
  } else {
    order = [target];
    for (const link of outgoingLinks(await source.read(target.rel))) {
      if (IMAGE_EXT.test(link)) continue;
      const hit = resolveLink(link, idx);
      if (hit && !order.includes(hit)) order.push(hit);
    }
  }
  const notes = [];
  for (const n of order) notes.push({ text: await source.read(n.rel), relPath: n.rel });
  return convertMany(notes, reveal, maxSlideLines, relatedSlide);
}

const reloadScript = (rel: string) => `
<script>(function(){var last=null;var u="/__mtime?path="+encodeURIComponent(${JSON.stringify(rel)});
setInterval(function(){fetch(u,{cache:"no-store"}).then(function(r){return r.text()}).then(function(t){
if(last===null){last=t;return}if(t!==last){location.reload()}}).catch(function(){})},2000)})();</script>`;

// ---------------------------------------------------------------------------
// html pages
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:900px;margin:3rem auto;padding:0 1rem;color:#2e3440;background:#eceff4}
a{color:#5e81ac;text-decoration:none}a:hover{text-decoration:underline}h1,h2{font-weight:600}h2{margin-top:2rem;font-size:1.1rem}
ul{list-style:none;padding:0}li{padding:.15rem 0}code{background:#e5e9f0;padding:0 .3em;border-radius:3px;font-size:.9em}
.dim{color:#4c566a;font-size:.85em}.tag{margin-left:.5rem}</style><body>${body}</body>`;

function listing(idx: Index, folderRel: string): string {
  const inFolder = (n: NoteRef) => !folderRel || n.folder === folderRel || n.folder.startsWith(folderRel + "/");
  const notes = idx.notes.filter(inFolder).sort((a, b) => naturalCompare(a.rel, b.rel));
  const groups = new Map<string, NoteRef[]>();
  for (const n of notes) (groups.get(n.folder) ?? groups.set(n.folder, []).get(n.folder)!).push(n);
  const folder = idx.folders.find((f) => f.rel === folderRel);
  const crumbs = folderRel
    ? `<p class="dim"><a href="/">vault</a> / ${esc(folderRel)} · <a href="/${folder?.slug}?mode=dir">▶ present whole folder</a></p>`
    : `<p class="dim">${idx.notes.length} notes · pick one to present. Add <code>?theme=paper</code>, <code>?reveal=1</code>, <code>?mode=dir</code> to any URL.</p>`;
  let html = `<h1>${esc(folderRel || "obs2deck")}</h1>${crumbs}`;
  for (const [g, ns] of [...groups.entries()].sort((a, b) => naturalCompare(a[0], b[0]))) {
    const f = idx.folders.find((x) => x.rel === g);
    html += `<h2>${f ? `<a href="/${f.slug}/">${esc(g)}</a>` : "(root)"}</h2><ul>`;
    for (const n of ns) {
      html += `<li><a href="/${n.slug}">${esc(n.name)}</a>`;
      if (isMoc(n)) html += `<a class="tag dim" href="/${n.slug}?mode=links">course ↗</a>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }
  return page(folderRel || "obs2deck", html);
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

async function vaultFile(basePath: string, pathname: string): Promise<string | null> {
  const abs = resolve(basePath, pathname.replace(/^\/+/, ""));
  const rel = relative(basePath, abs);
  if (!rel || rel.startsWith("..") || rel.split(sep).some((p) => SKIP.has(p))) return null;
  try {
    return (await fs.stat(abs)).isFile() ? abs : null;
  } catch {
    return null;
  }
}

/**
 * Obsidian resolves `![[photo.png]]` by searching the whole vault for a file with
 * that name. The converter emits `/photo.png`, which only exists at the vault root
 * when the note author wrote a full path. This fallback finds the file by basename,
 * preferring the shortest path when several match (Obsidian's "shortest path" rule).
 * The vault walk is cached briefly so a deck with many images costs one scan.
 */
const ASSET_CACHE_MS = 5000;
const assetIndexCache = new Map<string, { at: number; byName: Map<string, string[]> }>();

async function assetIndex(basePath: string): Promise<Map<string, string[]>> {
  const hit = assetIndexCache.get(basePath);
  if (hit && Date.now() - hit.at < ASSET_CACHE_MS) return hit.byName;
  const byName = new Map<string, string[]>();
  const walk = async (dir: string) => {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (SKIP.has(ent.name) || ent.name.startsWith(".")) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (!ent.name.endsWith(".md")) {
        const list = byName.get(ent.name.toLowerCase()) ?? [];
        list.push(full);
        byName.set(ent.name.toLowerCase(), list);
      }
    }
  };
  await walk(basePath);
  assetIndexCache.set(basePath, { at: Date.now(), byName });
  return byName;
}

/** Resolve a bare or wrong-folder asset request to a real vault file, or null. */
export async function assetByName(basePath: string, pathname: string): Promise<string | null> {
  const name = basename(pathname.replace(/^\/+/, "")).toLowerCase();
  if (!name || name.endsWith(".md")) return null;
  const matches = (await assetIndex(basePath)).get(name);
  if (!matches?.length) return null;
  return [...matches].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function send(res: ServerResponse, code: number, type: string, body: string) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function stream(res: ServerResponse, file: string) {
  res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

export class DeckServer {
  private server: Server | null = null;
  readonly host: string;

  /** Change the per-slide line budget without restarting; applies to the next request. */
  setMaxSlideLines(n: number | undefined) {
    this.opts.maxSlideLines = n;
  }

  /** Toggle the auto "Related notes" slide without restarting; applies to the next request. */
  setRelatedSlide(on: boolean) {
    this.opts.relatedSlide = on;
  }

  constructor(private source: NoteSource, private opts: ServerOptions) {
    this.host = opts.host ?? "127.0.0.1";
  }

  get port() {
    return this.opts.port;
  }
  get url() {
    return `http://${this.host}:${this.opts.port}`;
  }
  get running() {
    return this.server !== null;
  }

  /** Canonical deck URL for a vault-relative note or folder path. */
  async urlFor(rel: string, mode: DeckMode = "single", query: Record<string, string> = {}): Promise<string | null> {
    const idx = await buildIndex(this.source);
    const hit = idx.notes.find((n) => n.rel === rel) ?? idx.folders.find((f) => f.rel === rel);
    if (!hit) return null;
    const params = new URLSearchParams(query);
    if (!("base" in hit)) params.set("mode", "dir");
    else if (mode !== "single") params.set("mode", mode);
    const qs = params.toString();
    return `${this.url}/${hit.slug}${qs ? "?" + qs : ""}`;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((ok, fail) => {
      const srv = createServer((req, res) => this.handle(req, res));
      srv.once("error", (e) => {
        this.server = null;
        fail(e);
      });
      srv.listen(this.opts.port, this.host, () => {
        this.server = srv;
        this.opts.log?.(`obs2deck → ${this.url}`);
        ok();
      });
    });
  }

  stop(): Promise<void> {
    const srv = this.server;
    this.server = null;
    if (!srv) return Promise.resolve();
    return new Promise((ok) => {
      srv.closeAllConnections?.();
      srv.close(() => ok());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, "text/plain", "bad url");
    }
    const q = url.searchParams;
    try {
      if (pathname === "/__mtime") {
        const f = await vaultFile(this.source.basePath, q.get("path") ?? "");
        return send(res, 200, "text/plain", f ? String((await fs.stat(f)).mtimeMs) : "0");
      }
      if (pathname === "/__open") {
        const rel = (q.get("path") ?? "").replace(/^\/+/, "");
        const params: Record<string, string> = {};
        for (const [k, v] of q) if (k !== "path" && k !== "mode" && v) params[k] = v;
        const target = await this.urlFor(rel, (q.get("mode") as DeckMode) || "single", params);
        if (!target) return send(res, 404, "text/plain", `not a note: ${rel}`);
        res.writeHead(302, { Location: target });
        return res.end();
      }
      const file = await vaultFile(this.source.basePath, pathname);
      if (file && !pathname.endsWith(".md")) return stream(res, file);
      if (!pathname.endsWith(".md") && extname(pathname)) {
        const byName = await assetByName(this.source.basePath, pathname);   // ![[photo.png]] written without its folder
        if (byName) return stream(res, byName);
      }

      const idx = await buildIndex(this.source);
      const r = route(pathname, idx);
      if (!r) {
        return send(res, 404, "text/html; charset=utf-8", page("not found", `<h1>No note matches <code>${esc(pathname)}</code></h1><p><a href="/">Back to the index</a></p>`));
      }
      if ("root" in r) return send(res, 200, "text/html; charset=utf-8", listing(idx, ""));
      if ("redirect" in r) {
        res.writeHead(302, { Location: `/${r.redirect.slug}${url.search}` });
        return res.end();
      }
      if ("choices" in r) {
        const items = r.choices.map((n) => `<li><a href="/${n.slug}${url.search}">${esc(n.rel)}</a></li>`).join("");
        return send(res, 300, "text/html; charset=utf-8", page("which note?", `<h1>Did you mean…</h1><p class="dim">for <code>${esc(r.query)}</code></p><ul>${items}</ul>`));
      }
      const target = "folder" in r ? r.folder : r.note;
      const mode: DeckMode = "folder" in r ? "dir" : ((q.get("mode") as DeckMode) || "single");
      if ("folder" in r && q.get("mode") !== "dir") return send(res, 200, "text/html; charset=utf-8", listing(idx, r.folder.rel));

      const md = await deckMarkdown(this.source, idx, target, mode, !!q.get("reveal"), this.opts.maxSlideLines, this.opts.relatedSlide ?? true);
      if (q.get("raw")) return send(res, 200, "text/markdown; charset=utf-8", md);
      const d = this.opts.defaults;
      const html = renderDeckHtml(md, {
        title: target.name,
        theme: q.get("theme") || d.theme,
        template: q.get("template") || d.template,
        transition: q.get("transition") || d.transition,
        headFont: q.get("head") || undefined,
        bodyFont: q.get("body") || undefined,
      });
      return send(res, 200, "text/html; charset=utf-8", html.replace("</body>", reloadScript(target.rel) + "\n</body>"));
    } catch (e) {
      this.opts.log?.(`obs2deck error: ${String(e)}`);
      return send(res, 500, "text/plain; charset=utf-8", String((e as Error).stack ?? e));
    }
  }
}
