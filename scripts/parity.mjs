// Compares the TypeScript converter against the original Python converter
// for every note in a vault. Used once during the port; kept for regressions.
//
//   OBSIDIAN_VAULT=~/notes PY_CONVERTER=~/notes/tools/obs2deck.py npm run parity
import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const { convertNote, renderSlides, FsNoteSource } = require("../dist/node.cjs");

let vault = process.env.OBSIDIAN_VAULT;
if (!vault && existsSync(".env")) vault = readFileSync(".env", "utf8").match(/^OBSIDIAN_VAULT=(.+)$/m)?.[1].trim();
const py = process.env.PY_CONVERTER || join(vault ?? "", "tools", "obs2deck.py");
if (!vault || !existsSync(py)) {
  console.error("need OBSIDIAN_VAULT and a Python converter at PY_CONVERTER");
  process.exit(1);
}

const source = new FsNoteSource(vault);
const notes = (await source.listMarkdown()).filter((r) => !r.startsWith("tools/"));
let same = 0;
const diffs = [];
for (const rel of notes) {
  const expected = execFileSync("/usr/bin/python3", [py, rel, "--no-serve", "-o", "-", "--asset-prefix", "/"], { cwd: vault, encoding: "utf8", maxBuffer: 64 << 20 });
  const actual = renderSlides(convertNote(await source.read(rel), { relPath: rel, relatedSlide: true }).slides);
  if (expected === actual) same++;
  else {
    diffs.push(rel);
    writeFileSync(`/tmp/obs2deck-parity-${diffs.length}.expected.md`, expected);
    writeFileSync(`/tmp/obs2deck-parity-${diffs.length}.actual.md`, actual);
  }
}
console.log(`${same}/${notes.length} notes identical`);
if (diffs.length) {
  console.log("differences (expected/actual written to /tmp/obs2deck-parity-N.*.md):");
  for (const d of diffs) console.log("  " + d);
  process.exit(1);
}
