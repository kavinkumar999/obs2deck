#!/usr/bin/env python3
"""
obs2deck - present an Obsidian note with deckrun.

Converts Obsidian-flavoured Markdown (frontmatter, ![[embeds]], [[wikilinks]],
> [!callouts], ==highlights==) into deckrun slide Markdown, writes it to
<vault>/.deck-current.md, and makes sure a deckrun server is serving that file.
deckrun watches the file on disk, so re-running on another note swaps the deck
in place.

Usage:
    obs2deck.py "HLD/Caching.md"                 # one note
    obs2deck.py "HLD/HLD.md" --follow-links      # MOC note -> stitched course deck
    obs2deck.py "DSA/Graph" --dir                # every note in a folder, in order
    obs2deck.py "HLD/Caching.md" --no-serve      # convert only, print output path
    obs2deck.py "HLD/Caching.md" --reveal        # step through bullets one by one

Paths are relative to the vault root (the parent of this tools/ folder) or absolute.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

VAULT = Path(__file__).resolve().parent.parent
# The deck lives at the vault root (as a dotfile Obsidian hides) because deckrun
# serves images relative to the deck file's own directory and refuses `..` paths.
OUT_DIR = VAULT
OUT_FILE = VAULT / ".deck-current.md"
LOG_FILE = VAULT / ".deck" / "deckrun.log"
SKIP_DIRS = {".git", ".obsidian", ".deck", "tools", "_resources"}

DEFAULT_PORT = 7890
DEFAULT_THEME = "nord"
MAX_SLIDE_LINES = 10          # soft cap before a slide is split further
MAX_TITLE_LEN = 70            # deckrun lint warns on long headings

# Obsidian callout -> label. Mirrors Template/Callout.md and Formatting Rules.md.
CALLOUTS = {
    "note": "🔵 Note",
    "info": "🔵 Info",
    "todo": "🔵 Todo",
    "tip": "🔥 Tip",
    "hint": "🔥 Hint",
    "important": "🔥 Important",
    "abstract": "📋 Summary",
    "summary": "📋 Summary",
    "tldr": "📋 TL;DR",
    "question": "❓ Question",
    "help": "❓ Help",
    "faq": "❓ FAQ",
    "quote": "💬 Quote",
    "cite": "💬 Quote",
    "example": "📑 Example",
    "success": "✔ Success",
    "check": "✔ Check",
    "done": "✔ Done",
    "warning": "⚠ Warning",
    "caution": "⚠ Caution",
    "attention": "⚠ Attention",
    "failure": "❌ Failure",
    "fail": "❌ Failure",
    "missing": "❌ Missing",
    "danger": "⚡ Danger",
    "error": "⚡ Error",
    "bug": "🐞 Bug",
}

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")

# --------------------------------------------------------------------------- #
# Vault index
# --------------------------------------------------------------------------- #


def build_note_index() -> Dict[str, Path]:
    """basename (without .md, lowercase) -> path, for resolving [[wikilinks]]."""
    index: Dict[str, Path] = {}
    for root, dirs, files in os.walk(VAULT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".md"):
                p = Path(root) / f
                index.setdefault(f[:-3].lower(), p)
                rel = p.relative_to(VAULT).with_suffix("").as_posix().lower()
                index.setdefault(rel, p)
    return index


def resolve_note(target: str, index: Dict[str, Path]) -> Optional[Path]:
    key = target.strip().lower()
    if key.endswith(".md"):
        key = key[:-3]
    return index.get(key)


# --------------------------------------------------------------------------- #
# Inline conversions
# --------------------------------------------------------------------------- #


ASSET_PREFIX: Optional[str] = None   # None -> relative to OUT_DIR; "/" -> absolute URL path


def rel_asset(path: str) -> str:
    """Vault-relative asset path -> URL-safe path the deck can load."""
    p = path.strip().lstrip("/")
    if ASSET_PREFIX is None:
        rel = os.path.relpath(VAULT / p, OUT_DIR).replace(os.sep, "/")
    else:
        rel = ASSET_PREFIX.rstrip("/") + "/" + p
    return quote(rel, safe="/:")


def alt_for(target: str, alt: str) -> str:
    alt = alt.strip().strip('"')
    if alt:
        return alt
    stem = Path(target).stem
    return "figure" if re.fullmatch(r"[0-9a-f]{32}(_MD5)?", stem, re.I) else stem


def convert_inline(line: str, related: List[str]) -> str:
    # ![[path|alt]] embeds (images only; note embeds become a pointer line)
    def embed(m: re.Match) -> str:
        target, _, alt = m.group(1).partition("|")
        alt = alt_for(target, alt)
        if target.lower().endswith(IMAGE_EXT):
            return f"![{alt}]({rel_asset(target)})"
        related.append(target)
        return f"*See note: **{target}***"

    line = re.sub(r"!\[\[([^\]]+)\]\]", embed, line)

    # [[path.png|"caption"]] – a plain wikilink to an image (used in this vault)
    def img_link(m: re.Match) -> str:
        target, _, alt = m.group(1).partition("|")
        return f"![{alt_for(target, alt)}]({rel_asset(target)})"

    line = re.sub(r"\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp)(?:\|[^\]]*)?)\]\]", img_link, line, flags=re.I)

    # [[Note]], [[Note|alias]], [[Note#Heading]] -> bold text
    def wikilink(m: re.Match) -> str:
        body = m.group(1)
        target, _, alias = body.partition("|")
        note, _, heading = target.partition("#")
        note = note.strip()
        if note:
            related.append(note)
        text = alias.strip() or heading.strip() or note or target
        return f"**{text}**"

    line = re.sub(r"\[\[([^\]]+)\]\]", wikilink, line)

    # ==highlight== -> <mark>
    line = re.sub(r"==([^=\n]+)==", r"<mark>\1</mark>", line)

    # Obsidian %%comments%% (single line)
    line = re.sub(r"%%.*?%%", "", line)
    return line


# --------------------------------------------------------------------------- #
# Block-level conversion
# --------------------------------------------------------------------------- #


def split_frontmatter(text: str) -> Tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*\n?", text, re.S)
    if not m:
        return {}, text
    meta: dict = {}
    tags: List[str] = []
    for raw in m.group(1).splitlines():
        s = raw.strip()
        if s.startswith("- "):
            tags.append(s[2:].strip().strip("'\""))
        elif ":" in s:
            k, _, v = s.partition(":")
            v = v.strip()
            if k.strip() == "tags" and v:
                tags.extend(t.strip().strip("'\"[]") for t in v.split(",") if t.strip())
            elif v:
                meta[k.strip()] = v.strip("'\"")
    if tags:
        meta["tags"] = tags
    return meta, text[m.end():]


EMOJI_PREFIX = re.compile(r"^(\s*>\s*)(?:[🔵🌐🟡🔘🟣🟢🟠🔴⚪⚫🟤]️?\s*)(?:\S{1,2}\s+)?")


def convert_callouts(lines: List[str]) -> List[str]:
    """> [!tip] Title\n> body  ->  > **🔥 Tip: Title**\n> body"""
    out: List[str] = []
    strip_next = False
    for line in lines:
        m = re.match(r"^(\s*>\s*)\[!([A-Za-z]+)\]([+-]?)\s*(.*)$", line)
        if m:
            prefix, kind, _fold, title = m.groups()
            label = CALLOUTS.get(kind.lower(), kind.capitalize())
            head = f"**{label}**" if not title.strip() else f"**{label}: {title.strip()}**"
            out.append(f"{prefix}{head}")
            strip_next = True
            continue
        if strip_next and line.lstrip().startswith(">"):
            # the vault's callout template repeats "🔵 ✏ " inside the body; the label carries it now
            line = EMOJI_PREFIX.sub(r"\1", line, count=1)
        strip_next = False
        out.append(line)
    return out


def apply_reveal(lines: List[str]) -> List[str]:
    out: List[str] = []
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        if not in_fence and re.match(r"^\s{0,1}(?:[-*+]|\d+\.)\s+\S", line) and "{reveal}" not in line:
            line = line.rstrip() + " {reveal}"
        out.append(line)
    return out


# --------------------------------------------------------------------------- #
# Slide splitting
# --------------------------------------------------------------------------- #


def is_fence(line: str) -> bool:
    return line.lstrip().startswith("```") or line.lstrip().startswith("~~~")


def count_visible(lines: List[str]) -> int:
    return sum(1 for l in lines if l.strip())


def heading_level(line: str) -> int:
    m = re.match(r"^(#{1,6})\s+\S", line)
    return len(m.group(1)) if m else 0


def heading_text(line: str) -> str:
    return re.sub(r"^#{1,6}\s+", "", line).strip()


def clean_slide(lines: List[str]) -> List[str]:
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def chunk_blocks(lines: List[str]) -> List[List[str]]:
    """Split into blocks at blank lines, never inside a fence or a table."""
    blocks: List[List[str]] = []
    cur: List[str] = []
    in_fence = False
    for line in lines:
        if is_fence(line):
            in_fence = not in_fence
        if not in_fence and not line.strip():
            if cur:
                blocks.append(cur)
                cur = []
            continue
        cur.append(line)
    if cur:
        blocks.append(cur)
    return blocks


def paginate(heading: str, body: List[str]) -> List[List[str]]:
    """Cut an over-long slide body into continuation slides sharing a heading."""
    blocks = chunk_blocks(body)
    pages: List[List[str]] = []
    cur: List[str] = []
    for block in blocks:
        if cur and count_visible(cur) + count_visible(block) > MAX_SLIDE_LINES:
            pages.append(cur)
            cur = []
        cur.extend(block + [""])
    if cur:
        pages.append(cur)
    out: List[List[str]] = []
    for i, page in enumerate(pages):
        h = heading if i == 0 else f"{heading} (cont. {i + 1})"
        out.append([h, ""] + page)
    return out


def split_by_subheadings(h2: str, body: List[str]) -> List[List[str]]:
    """Long H2 slide -> intro slide + one slide per H3 (H3 kept as subheading)."""
    sections: List[List[str]] = [[]]
    in_fence = False
    for line in body:
        if is_fence(line):
            in_fence = not in_fence
        if not in_fence and heading_level(line) == 3:
            sections.append([line])
        else:
            sections[-1].append(line)
    slides: List[List[str]] = []
    intro = clean_slide(sections[0])
    if intro:
        slides.extend(finalize_slide(h2, intro))
    for sec in sections[1:]:
        sub_heading = sec[0]
        sub_body = clean_slide(sec[1:])
        combined = f"{heading_text(h2)} · {heading_text(sub_heading)}"
        sub_h2 = f"## {combined if len(combined) <= MAX_TITLE_LEN else heading_text(sub_heading)}"
        slides.extend(finalize_slide(sub_h2, sub_body))
    return slides


IMAGE_LINE = re.compile(r"^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$")


def layout_images(body: List[str]) -> List[str]:
    """One image plus text -> deckrun split layout (text left, image right)."""
    imgs = [i for i, l in enumerate(body) if IMAGE_LINE.match(l)]
    if len(imgs) != 1 or count_visible(body) < 2:
        return body
    i = imgs[0]
    m = IMAGE_LINE.match(body[i])
    body[i] = f'![{m.group(1)}]({m.group(2)} "right")'
    return body


def finalize_slide(heading: str, body: List[str]) -> List[List[str]]:
    body = clean_slide(list(body))
    if count_visible(body) <= MAX_SLIDE_LINES:
        body = layout_images(body)
        return [[heading, ""] + body] if body else [[heading]]
    if any(heading_level(l) == 3 for l in body) and heading_level(heading) == 2:
        return split_by_subheadings(heading, body)
    return paginate(heading, body)


def build_slides(body_lines: List[str], title: Optional[str], meta: dict, source: Path) -> List[List[str]]:
    """Group converted lines into slides: title slide, then one per H2."""
    raw_slides: List[List[str]] = [[]]
    in_fence = False
    for line in body_lines:
        if is_fence(line):
            in_fence = not in_fence
        if in_fence:
            raw_slides[-1].append(line)
            continue
        lvl = heading_level(line)
        if re.match(r"^\s*---\s*$", line):          # author-placed slide break
            raw_slides.append([])
            continue
        if re.match(r"^\s*(\*\*\*|___)\s*$", line):  # keep as in-slide rule
            raw_slides[-1].append("***")
            continue
        if lvl == 1:
            if title is None:
                title = heading_text(line)
                continue                              # first H1 goes on the title slide
            raw_slides.append([f"# {heading_text(line)}"])  # later H1 = section slide
            continue
        if lvl == 2:
            raw_slides.append([line])
            continue
        raw_slides[-1].append(line)

    slides: List[List[str]] = []
    # Title slide: H1 + tags + whatever preceded the first H2 (usually the abstract)
    lead = clean_slide(raw_slides[0])
    title_line = f"# {title}" if title else f"# {source.stem}"
    subtitle: List[str] = []
    if meta.get("tags"):
        subtitle.append(" · ".join(f"`#{t}`" for t in meta["tags"]))
    subtitle.append(f"*{source.relative_to(VAULT).as_posix()}*")
    slides.append([title_line, ""] + subtitle + ([""] + lead if lead else []))
    if count_visible(slides[0]) > MAX_SLIDE_LINES + 2:      # abstract too long -> own slide
        slides[0] = [title_line, ""] + subtitle
        slides.extend(finalize_slide("## Overview", lead))

    for raw in raw_slides[1:]:
        raw = clean_slide(raw)
        if not raw:
            continue
        if heading_level(raw[0]) in (1, 2):
            slides.extend(finalize_slide(raw[0], raw[1:]))
        else:                                               # content after a manual --- with no heading
            slides.extend(paginate("", raw))
    return slides


def render(slides: List[List[str]]) -> str:
    parts = []
    for s in slides:
        s = clean_slide(list(s))
        if s and s[0].strip():
            parts.append("\n".join(s))
    return "\n\n---\n\n".join(parts) + "\n"


# --------------------------------------------------------------------------- #
# Note -> slides
# --------------------------------------------------------------------------- #


def convert_note(path: Path, reveal: bool = False, related_slide: bool = True) -> Tuple[List[List[str]], List[str]]:
    text = path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
    meta, body = split_frontmatter(text)
    related: List[str] = []
    lines = body.split("\n")

    # inline conversions (skip fenced code)
    converted: List[str] = []
    in_fence = False
    for line in lines:
        if is_fence(line):
            in_fence = not in_fence
            converted.append(line)
            continue
        converted.append(line if in_fence else convert_inline(line, related))

    converted = convert_callouts(converted)
    if reveal:
        converted = apply_reveal(converted)

    slides = build_slides(converted, None, meta, path)

    seen: List[str] = []
    for r in related:
        if r.lower().endswith(IMAGE_EXT):
            continue
        name = Path(r).name
        if name not in seen:
            seen.append(name)
    has_related_section = any(
        heading_level(l) and "related" in heading_text(l).lower() for l in converted
    )
    if related_slide and seen and not has_related_section:
        slides.append(["## Related notes", ""] + [f"- {r}" for r in seen[:MAX_SLIDE_LINES]])
    return slides, seen


def natural_key(p: Path):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def gather_targets(target: Path, mode: str, index: Dict[str, Path]) -> List[Path]:
    if mode == "dir":
        return sorted((p for p in target.rglob("*.md") if not SKIP_DIRS & set(p.parts)), key=natural_key)
    if mode == "links":
        text = target.read_text(encoding="utf-8", errors="replace")
        _, body = split_frontmatter(text)
        order: List[Path] = [target]
        for m in re.finditer(r"(?<!!)\[\[([^\]|#]+)", body):
            p = resolve_note(m.group(1), index)
            if p and p not in order and not p.name.lower().endswith(IMAGE_EXT):
                order.append(p)
        return order
    return [target]


def convert_many(paths: List[Path], reveal: bool) -> str:
    all_slides: List[List[str]] = []
    single = len(paths) == 1
    for p in paths:
        slides, _ = convert_note(p, reveal=reveal, related_slide=single)
        all_slides.extend(slides)
    return render(all_slides)


# --------------------------------------------------------------------------- #
# deckrun server management
# --------------------------------------------------------------------------- #


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_deckrun() -> str:
    for cand in (shutil.which("deckrun"), "/opt/homebrew/bin/deckrun", str(Path.home() / ".npm-global/bin/deckrun")):
        if cand and Path(cand).exists():
            return cand
    sys.exit("deckrun not found. Install with: npm install -g deckrun")


def subprocess_env() -> dict:
    env = dict(os.environ)
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + env.get("PATH", "")
    return env


def spawn_and_wait(cmd: List[str], port: int, what: str) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log = open(LOG_FILE, "ab")
    subprocess.Popen(cmd, cwd=str(VAULT), env=subprocess_env(), stdout=log, stderr=log,
                     stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(40):
        if port_open(port):
            return
        time.sleep(0.25)
    sys.exit(f"{what} did not start within 10s; see {LOG_FILE}")


def ensure_editor(port: int, theme: str, template: str, transition: str, force_open: bool) -> None:
    """Legacy flow: one deck file served by deckrun's own editor."""
    url = f"http://127.0.0.1:{port}"
    if port_open(port):
        print(f"deckrun already running → {url} (deck reloaded from disk)")
        if force_open:
            subprocess.Popen(["open", url])
        return
    spawn_and_wait([find_deckrun(), str(OUT_FILE), "-p", str(port), "--theme", theme,
                    "--template", template, "--transition", transition], port, "deckrun")
    print(f"deckrun started → {url}")


def find_node() -> str:
    for cand in ("/opt/homebrew/bin/node", shutil.which("node"), "/usr/local/bin/node"):
        if cand and Path(cand).exists():
            return cand
    sys.exit("node not found; deckrun needs Node.js")


def ensure_deckserver(port: int, note: Path, mode: str, query: Dict[str, str]) -> None:
    """URL-per-note flow: tools/deckserver.mjs renders any note at /<folder>/<slug>."""
    base = f"http://127.0.0.1:{port}"
    if not port_open(port):
        spawn_and_wait([find_node(), str(VAULT / "tools" / "deckserver.mjs"), "-p", str(port)], port, "deckserver")
        print(f"deckserver started → {base}")
    params = dict(query)
    params["path"] = note.relative_to(VAULT).as_posix()
    if mode != "single":
        params["mode"] = mode
    qs = "&".join(f"{k}={quote(v, safe='')}" for k, v in params.items() if v)
    url = f"{base}/__open?{qs}"
    subprocess.Popen(["open", url])
    print(f"opening {url}")


def run_lint(port_unused: int) -> None:
    try:
        r = subprocess.run([find_deckrun(), "lint", str(OUT_FILE), "--max-warnings", "-1"],
                           cwd=str(VAULT), env=subprocess_env(), capture_output=True, text=True, timeout=30)
        out = (r.stdout + r.stderr).strip()
        if out:
            print(out)
    except Exception as e:  # lint is advisory only
        print(f"(lint skipped: {e})")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def main() -> None:
    global OUT_FILE, OUT_DIR, ASSET_PREFIX
    ap = argparse.ArgumentParser(description="Present an Obsidian note with deckrun.")
    ap.add_argument("note", help="note path (vault-relative or absolute); a folder with --dir")
    ap.add_argument("--dir", action="store_true", help="convert every note in the folder, in natural order")
    ap.add_argument("--follow-links", action="store_true", help="MOC mode: stitch the note and every [[link]] it lists")
    ap.add_argument("--reveal", action="store_true", help="add {reveal} to every bullet")
    ap.add_argument("--no-serve", action="store_true", help="convert only; do not start or touch any server")
    ap.add_argument("--editor", action="store_true",
                    help="legacy flow: write .deck-current.md and open it in deckrun's editor (port 7891)")
    ap.add_argument("--open", action="store_true", help="(--editor) open the browser even if deckrun is already running")
    ap.add_argument("--lint", action="store_true", help="run `deckrun lint` on the output")
    ap.add_argument("-p", "--port", type=int, default=None,
                    help=f"server port (default {DEFAULT_PORT}, or {DEFAULT_PORT + 1} with --editor)")
    ap.add_argument("--theme", default=None)
    ap.add_argument("--template", default=None)
    ap.add_argument("--transition", default=None)
    ap.add_argument("-o", "--out", help="write here instead of <vault>/.deck-current.md; '-' for stdout")
    ap.add_argument("--asset-prefix", default=None,
                    help="emit image paths as <prefix>/<vault-relative path> instead of relative to the output file")
    ap.add_argument("--index-only", action="store_true", help="just make sure the server is up and open its index page")
    args = ap.parse_args()

    if args.index_only:
        port = args.port or DEFAULT_PORT
        if not port_open(port):
            spawn_and_wait([find_node(), str(VAULT / "tools" / "deckserver.mjs"), "-p", str(port)], port, "deckserver")
        subprocess.Popen(["open", f"http://127.0.0.1:{port}/"])
        print(f"deck index → http://127.0.0.1:{port}/")
        return

    target = Path(args.note)
    if not target.is_absolute():
        target = VAULT / target
    if not target.exists():
        sys.exit(f"not found: {target}")

    index = build_note_index()
    mode = "dir" if args.dir or target.is_dir() else "links" if args.follow_links else "single"
    paths = gather_targets(target, mode, index)
    if not paths:
        sys.exit("no notes to convert")

    to_stdout = args.out == "-"
    if args.out and not to_stdout:
        OUT_FILE = Path(args.out).resolve()
        OUT_DIR = OUT_FILE.parent
    if args.asset_prefix is not None:
        ASSET_PREFIX = args.asset_prefix

    serve_mode = "none" if args.no_serve or to_stdout else "editor" if args.editor else "server"
    port = args.port or (DEFAULT_PORT + 1 if serve_mode == "editor" else DEFAULT_PORT)

    if serve_mode == "server":
        # The server converts on request; the hotkey path just needs the URL.
        ensure_deckserver(port, target, mode, {
            "theme": args.theme or "", "template": args.template or "",
            "transition": args.transition or "", "reveal": "1" if args.reveal else "",
        })
        return

    markdown = convert_many(paths, reveal=args.reveal)
    if to_stdout:
        sys.stdout.write(markdown)
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(markdown, encoding="utf-8")
    n_slides = markdown.count("\n---\n") + 1
    shown = OUT_FILE.relative_to(VAULT) if OUT_FILE.is_relative_to(VAULT) else OUT_FILE
    print(f"{n_slides} slides from {len(paths)} note(s) → {shown}")

    if args.lint:
        run_lint(port)
    if serve_mode == "editor":
        ensure_editor(port, args.theme or DEFAULT_THEME, args.template or "classic",
                      args.transition or "slide", args.open)


if __name__ == "__main__":
    main()
