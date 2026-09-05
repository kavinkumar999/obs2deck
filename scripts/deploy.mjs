// Copies the built plugin into a vault for local testing. No symlinks.
// Vault path comes from OBSIDIAN_VAULT (env) or a git-ignored .env file:
//   OBSIDIAN_VAULT=/Users/me/notes
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

let vault = process.env.OBSIDIAN_VAULT;
if (!vault && existsSync(".env")) {
  const m = readFileSync(".env", "utf8").match(/^OBSIDIAN_VAULT=(.+)$/m);
  if (m) vault = m[1].trim().replace(/^["']|["']$/g, "");
}
if (!vault) {
  console.error("Set OBSIDIAN_VAULT in the environment or in .env");
  process.exit(1);
}
const dest = join(vault, ".obsidian", "plugins", "obs2deck");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(f, join(dest, f));
}
const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
console.log(`obs2deck ${version} → ${dest}  (reload Obsidian: Cmd+R)`);
