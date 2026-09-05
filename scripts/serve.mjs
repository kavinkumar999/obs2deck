// Runs the deck server against a vault folder without Obsidian, for development.
//   OBSIDIAN_VAULT=~/notes npm run serve -- -p 7890
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DeckServer, FsNoteSource } = require("../dist/node.cjs");

let vault = process.env.OBSIDIAN_VAULT;
if (!vault && existsSync(".env")) vault = readFileSync(".env", "utf8").match(/^OBSIDIAN_VAULT=(.+)$/m)?.[1].trim();
if (!vault) {
  console.error("Set OBSIDIAN_VAULT");
  process.exit(1);
}
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("-p") + 1]) || 7890;

const server = new DeckServer(new FsNoteSource(vault), {
  port,
  defaults: { theme: "nord", template: "classic", transition: "slide" },
  log: console.log,
});
await server.start();
console.log(`serving ${vault}`);
process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
