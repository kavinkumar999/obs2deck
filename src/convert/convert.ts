/**
 * Obsidian Markdown -> deckrun slide Markdown.
 *
 * Pure functions, no I/O. Ported line-for-line from the original Python
 * converter so that output is byte-identical (see scripts/parity.mjs).
 */

export const MAX_SLIDE_LINES = 10; // soft cap before a slide is split further
export const MAX_TITLE_LEN = 70; // deckrun lint warns on long headings

/** Obsidian callout type -> label shown in the deck. */
export const CALLOUTS: Record<string, string> = {
  note: "🔵 Note",
  info: "🔵 Info",
  todo: "🔵 Todo",
  tip: "🔥 Tip",
  hint: "🔥 Hint",
  important: "🔥 Important",
  abstract: "📋 Summary",
  summary: "📋 Summary",
  tldr: "📋 TL;DR",
  question: "❓ Question",
  help: "❓ Help",
  faq: "❓ FAQ",
  quote: "💬 Quote",
  cite: "💬 Quote",
  example: "📑 Example",
  success: "✔ Success",
  check: "✔ Check",
  done: "✔ Done",
  warning: "⚠ Warning",
  caution: "⚠ Caution",
  attention: "⚠ Attention",
  failure: "❌ Failure",
  fail: "❌ Failure",
  missing: "❌ Missing",
  danger: "⚡ Danger",
  error: "⚡ Error",
  bug: "🐞 Bug",
};

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

export interface ConvertOptions {
  /** Vault-relative path of the note, e.g. "HLD/Caching.md". Shown on the title slide. */
  relPath: string;
  /** Prefix for image URLs. "/" -> "/HLD/_resources/x.png". Default "/". */
  assetPrefix?: string;
  /** Append {reveal} to every bullet. */
  reveal?: boolean;
  /** Append a "Related notes" slide (single-note decks only). */
  relatedSlide?: boolean;
  /** Visible lines a slide may hold before it is split at H3 or paginated. Default MAX_SLIDE_LINES. */
  maxSlideLines?: number;
}

export interface Frontmatter {
  tags?: string[];
  [key: string]: string | string[] | undefined;
}

// ---------------------------------------------------------------------------
// small helpers mirroring Python str methods
// ---------------------------------------------------------------------------

const pyStrip = (s: string) => s.trim();
const stripChars = (s: string, chars: string) => {
  const set = new Set(chars);
  let a = 0,
    b = s.length;
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
};
const partition = (s: string, sep: string): [string, string, string] => {
  const i = s.indexOf(sep);
  return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
};
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const codePoints = (s: string) => [...s].length;
const isImage = (p: string) => IMAGE_EXT.some((e) => p.toLowerCase().endsWith(e));
const pathName = (p: string) => {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
};
const pathStem = (p: string) => {
  const name = pathName(p);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

/** Python urllib.parse.quote(s, safe="/:") */
function quotePath(s: string): string {
  let out = "";
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9_.\-~/:]/.test(c)) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

// ---------------------------------------------------------------------------
// inline conversions
// ---------------------------------------------------------------------------

function assetUrl(path: string, prefix: string): string {
  const p = path.trim().replace(/^\/+/, "");
  return quotePath(prefix.replace(/\/+$/, "") + "/" + p);
}

function altFor(target: string, alt: string): string {
  alt = stripChars(alt.trim(), '"');
  if (alt) return alt;
  const stem = pathStem(target);
  return /^[0-9a-f]{32}(_MD5)?$/i.test(stem) ? "figure" : stem;
}

export function convertInline(line: string, related: string[], prefix: string): string {
  // ![[path|alt]] embeds (images only; note embeds become a pointer line)
  line = line.replace(/!\[\[([^\]]+)\]\]/g, (_m, body: string) => {
    const [target, , alt] = partition(body, "|");
    const a = altFor(target, alt);
    if (isImage(target)) return `![${a}](${assetUrl(target, prefix)})`;
    related.push(target);
    return `*See note: **${target}***`;
  });

  // [[path.png|"caption"]] – a plain wikilink to an image
  line = line.replace(/\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp)(?:\|[^\]]*)?)\]\]/gi, (_m, body: string) => {
    const [target, , alt] = partition(body, "|");
    return `![${altFor(target, alt)}](${assetUrl(target, prefix)})`;
  });

  // [[Note]], [[Note|alias]], [[Note#Heading]] -> bold text
  line = line.replace(/\[\[([^\]]+)\]\]/g, (_m, body: string) => {
    const [target, , alias] = partition(body, "|");
    const [noteRaw, , heading] = partition(target, "#");
    const note = noteRaw.trim();
    if (note) related.push(note);
    const text = alias.trim() || heading.trim() || note || target;
    return `**${text}**`;
  });

  // ==highlight== -> <mark>
  line = line.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

  // Obsidian %%comments%% (single line)
  line = line.replace(/%%.*?%%/g, "");
  return line;
}

// ---------------------------------------------------------------------------
// block-level conversion
// ---------------------------------------------------------------------------

export function splitFrontmatter(text: string): [Frontmatter, string] {
  if (!text.startsWith("---")) return [{}, text];
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(text);
  if (!m) return [{}, text];
  const meta: Frontmatter = {};
  const tags: string[] = [];
  for (const raw of m[1].split("\n")) {
    const s = raw.trim();
    if (s.startsWith("- ")) {
      tags.push(stripChars(s.slice(2).trim(), "'\""));
    } else if (s.includes(":")) {
      const [k, , vRaw] = partition(s, ":");
      const v = vRaw.trim();
      if (k.trim() === "tags" && v) {
        for (const t of v.split(",")) if (t.trim()) tags.push(stripChars(t.trim(), "'\"[]"));
      } else if (v) {
        meta[k.trim()] = stripChars(v, "'\"");
      }
    }
  }
  if (tags.length) meta.tags = tags;
  return [meta, text.slice(m[0].length)];
}

const EMOJI_PREFIX = /^(\s*>\s*)(?:[🔵🌐🟡🔘🟣🟢🟠🔴⚪⚫🟤]️?\s*)(?:\S{1,2}\s+)?/u;
const CALLOUT_HEAD = /^(\s*>\s*)\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/;

/** `> [!tip] Title` + body  ->  `> **🔥 Tip: Title**` + body (leading emoji pair removed). */
export function convertCallouts(lines: string[]): string[] {
  const out: string[] = [];
  let stripNext = false;
  for (let line of lines) {
    const m = CALLOUT_HEAD.exec(line);
    if (m) {
      const [, prefix, kind, , title] = m;
      const label = CALLOUTS[kind.toLowerCase()] ?? capitalize(kind);
      const head = !title.trim() ? `**${label}**` : `**${label}: ${title.trim()}**`;
      out.push(`${prefix}${head}`);
      stripNext = true;
      continue;
    }
    if (stripNext && line.trimStart().startsWith(">")) {
      line = line.replace(EMOJI_PREFIX, "$1");
    }
    stripNext = false;
    out.push(line);
  }
  return out;
}

export function applyReveal(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  for (let line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && /^\s{0,1}(?:[-*+]|\d+\.)\s+\S/.test(line) && !line.includes("{reveal}")) {
      line = line.trimEnd() + " {reveal}";
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// slide splitting
// ---------------------------------------------------------------------------

const isFence = (l: string) => l.trimStart().startsWith("```") || l.trimStart().startsWith("~~~");
const countVisible = (lines: string[]) => lines.filter((l) => l.trim()).length;
const headingLevel = (l: string) => /^(#{1,6})\s+\S/.exec(l)?.[1].length ?? 0;
const headingText = (l: string) => l.replace(/^#{1,6}\s+/, "").trim();

function cleanSlide(lines: string[]): string[] {
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/** Split into blocks at blank lines, never inside a fence. */
function chunkBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (isFence(line)) inFence = !inFence;
    if (!inFence && !line.trim()) {
      if (cur.length) {
        blocks.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

/** Cut an over-long slide body into continuation slides sharing a heading. */
function paginate(heading: string, body: string[], max: number): string[][] {
  const pages: string[][] = [];
  let cur: string[] = [];
  for (const block of chunkBlocks(body)) {
    if (cur.length && countVisible(cur) + countVisible(block) > max) {
      pages.push(cur);
      cur = [];
    }
    cur.push(...block, "");
  }
  if (cur.length) pages.push(cur);
  return pages.map((page, i) => [i === 0 ? heading : `${heading} (cont. ${i + 1})`, "", ...page]);
}

/** Long H2 slide -> intro slide + one slide per H3. */
function splitBySubheadings(h2: string, body: string[], max: number): string[][] {
  const sections: string[][] = [[]];
  let inFence = false;
  for (const line of body) {
    if (isFence(line)) inFence = !inFence;
    if (!inFence && headingLevel(line) === 3) sections.push([line]);
    else sections[sections.length - 1].push(line);
  }
  const slides: string[][] = [];
  const intro = cleanSlide(sections[0]);
  if (intro.length) slides.push(...finalizeSlide(h2, intro, max));
  for (const sec of sections.slice(1)) {
    const subHeading = sec[0];
    const subBody = cleanSlide(sec.slice(1));
    const combined = `${headingText(h2)} · ${headingText(subHeading)}`;
    const subH2 = `## ${codePoints(combined) <= MAX_TITLE_LEN ? combined : headingText(subHeading)}`;
    slides.push(...finalizeSlide(subH2, subBody, max));
  }
  return slides;
}

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

/** One image plus text -> deckrun split layout (text left, image right). */
function layoutImages(body: string[]): string[] {
  const imgs = body.map((l, i) => (IMAGE_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (imgs.length !== 1 || countVisible(body) < 2) return body;
  const i = imgs[0];
  const m = IMAGE_LINE.exec(body[i])!;
  body[i] = `![${m[1]}](${m[2]} "right")`;
  return body;
}

function finalizeSlide(heading: string, body: string[], max: number): string[][] {
  body = cleanSlide([...body]);
  if (countVisible(body) <= max) {
    body = layoutImages(body);
    return body.length ? [[heading, "", ...body]] : [[heading]];
  }
  if (body.some((l) => headingLevel(l) === 3) && headingLevel(heading) === 2) {
    return splitBySubheadings(heading, body, max);
  }
  return paginate(heading, body, max);
}

function buildSlides(bodyLines: string[], meta: Frontmatter, relPath: string, max: number): string[][] {
  const rawSlides: string[][] = [[]];
  let inFence = false;
  let title: string | null = null;
  for (const line of bodyLines) {
    if (isFence(line)) inFence = !inFence;
    if (inFence) {
      rawSlides[rawSlides.length - 1].push(line);
      continue;
    }
    const lvl = headingLevel(line);
    if (/^\s*---\s*$/.test(line)) {
      rawSlides.push([]);
      continue;
    }
    if (/^\s*(\*\*\*|___)\s*$/.test(line)) {
      rawSlides[rawSlides.length - 1].push("***");
      continue;
    }
    if (lvl === 1) {
      if (title === null) {
        title = headingText(line);
        continue;
      }
      rawSlides.push([`# ${headingText(line)}`]);
      continue;
    }
    if (lvl === 2) {
      rawSlides.push([line]);
      continue;
    }
    rawSlides[rawSlides.length - 1].push(line);
  }

  const slides: string[][] = [];
  const lead = cleanSlide(rawSlides[0]);
  const titleLine = title ? `# ${title}` : `# ${pathStem(relPath)}`;
  const subtitle: string[] = [];
  if (meta.tags?.length) subtitle.push(meta.tags.map((t) => `\`#${t}\``).join(" · "));
  subtitle.push(`*${relPath}*`);
  slides.push([titleLine, "", ...subtitle, ...(lead.length ? ["", ...lead] : [])]);
  if (countVisible(slides[0]) > max + 2) {
    slides[0] = [titleLine, "", ...subtitle];
    slides.push(...finalizeSlide("## Overview", lead, max));
  }

  for (let raw of rawSlides.slice(1)) {
    raw = cleanSlide(raw);
    if (!raw.length) continue;
    const lvl = headingLevel(raw[0]);
    if (lvl === 1 || lvl === 2) slides.push(...finalizeSlide(raw[0], raw.slice(1), max));
    else slides.push(...paginate("", raw, max));
  }
  return slides;
}

export function renderSlides(slides: string[][]): string {
  const parts: string[] = [];
  for (let s of slides) {
    s = cleanSlide([...s]);
    if (s.length && s[0].trim()) parts.push(s.join("\n"));
  }
  return parts.join("\n\n---\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// note -> slides
// ---------------------------------------------------------------------------

export interface ConvertResult {
  slides: string[][];
  related: string[];
  meta: Frontmatter;
  title: string;
}

export function convertNote(text: string, opts: ConvertOptions): ConvertResult {
  const prefix = opts.assetPrefix ?? "/";
  const max = Math.max(1, Math.floor(opts.maxSlideLines ?? MAX_SLIDE_LINES));
  const [meta, body] = splitFrontmatter(text.replace(/\r\n/g, "\n"));
  const related: string[] = [];

  const converted: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isFence(line)) {
      inFence = !inFence;
      converted.push(line);
      continue;
    }
    converted.push(inFence ? line : convertInline(line, related, prefix));
  }

  let lines = convertCallouts(converted);
  if (opts.reveal) lines = applyReveal(lines);

  const slides = buildSlides(lines, meta, opts.relPath, max);

  const seen: string[] = [];
  for (const r of related) {
    if (isImage(r)) continue;
    const name = pathName(r);
    if (!seen.includes(name)) seen.push(name);
  }
  const hasRelatedSection = lines.some((l) => headingLevel(l) && headingText(l).toLowerCase().includes("related"));
  if ((opts.relatedSlide ?? true) && seen.length && !hasRelatedSection) {
    slides.push(["## Related notes", "", ...seen.slice(0, max).map((r) => `- ${r}`)]);
  }
  const title = headingText(slides[0][0]);
  return { slides, related: seen, meta, title };
}

/** Convert several notes into one deck (folder or course mode). */
export function convertMany(notes: { text: string; relPath: string }[], reveal = false, maxSlideLines?: number, relatedSlide = true): string {
  const single = notes.length === 1;
  const all: string[][] = [];
  for (const n of notes) {
    all.push(...convertNote(n.text, { relPath: n.relPath, reveal, relatedSlide: relatedSlide && single, maxSlideLines }).slides);
  }
  return renderSlides(all);
}

/** Wikilink targets in a note body, in order, deduplicated. Used for course mode. */
export function outgoingLinks(text: string): string[] {
  const [, body] = splitFrontmatter(text.replace(/\r\n/g, "\n"));
  const out: string[] = [];
  for (const m of body.matchAll(/(?<!!)\[\[([^\]|#]+)/g)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
