/**
 * Where notes come from. The plugin backs this with Obsidian's vault API;
 * scripts and tests back it with the filesystem.
 */
import { promises as fs } from "fs";
import { join, relative, sep } from "path";

export interface NoteSource {
  /** Absolute path of the vault root, used to serve images and other files. */
  basePath: string;
  /** Vault-relative paths of every Markdown note, "HLD/Caching.md". */
  listMarkdown(): Promise<string[]>;
  read(rel: string): Promise<string>;
  mtime(rel: string): Promise<number>;
}

const SKIP = new Set([".git", ".obsidian", ".deck", "node_modules", ".trash"]);

export class FsNoteSource implements NoteSource {
  constructor(public basePath: string) {}

  async listMarkdown(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(ent.name) || ent.name.startsWith(".")) continue;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.name.endsWith(".md")) out.push(relative(this.basePath, full).split(sep).join("/"));
      }
    };
    await walk(this.basePath);
    return out.sort();
  }

  read(rel: string) {
    return fs.readFile(join(this.basePath, rel), "utf8");
  }

  async mtime(rel: string) {
    return (await fs.stat(join(this.basePath, rel))).mtimeMs;
  }
}
