import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
obs2deck - Obsidian plugin. Source: https://github.com/kavinkumar999/obs2deck
Bundles deckrun (MIT, Arpit Bhayani) for slide parsing and rendering.
*/`;

const prod = process.argv[2] === "production";

const common = {
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  treeShaking: true,
  sourcemap: prod ? false : "inline",
};

// 1. The Obsidian plugin.
const plugin = await esbuild.context({
  ...common,
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  minify: prod,
  outfile: "main.js",
});

// 2. The same code without Obsidian, for scripts/ and tests.
const node = await esbuild.context({
  ...common,
  entryPoints: ["src/node-entry.ts"],
  external: [...builtins],
  outfile: "dist/node.cjs",
});

if (prod) {
  await Promise.all([plugin.rebuild(), node.rebuild()]);
  process.exit(0);
} else {
  await Promise.all([plugin.watch(), node.watch()]);
}
