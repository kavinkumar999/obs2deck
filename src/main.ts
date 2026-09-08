import { FileSystemAdapter, Notice, Plugin, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, Obs2DeckSettingTab, type Obs2DeckSettings } from "./settings";
import { DeckServer, type DeckMode } from "./server/server";
import type { NoteSource } from "./server/source";

/** NoteSource backed by Obsidian's vault API. */
class VaultNoteSource implements NoteSource {
  constructor(private plugin: Obs2DeckPlugin) {}

  get basePath(): string {
    const adapter = this.plugin.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error("obs2deck needs a filesystem vault");
  }

  async listMarkdown(): Promise<string[]> {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .sort();
  }

  async read(rel: string): Promise<string> {
    const f = this.plugin.app.vault.getAbstractFileByPath(rel);
    if (!(f instanceof TFile)) throw new Error(`not a file: ${rel}`);
    return this.plugin.app.vault.cachedRead(f);
  }

  async mtime(rel: string): Promise<number> {
    const f = this.plugin.app.vault.getAbstractFileByPath(rel);
    return f instanceof TFile ? f.stat.mtime : 0;
  }
}

export default class Obs2DeckPlugin extends Plugin {
  settings: Obs2DeckSettings = DEFAULT_SETTINGS;
  server: DeckServer | null = null;
  private statusEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new Obs2DeckSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("obs2deck-status");
    this.statusEl.onClickEvent(() => this.openIndex());
    this.updateStatus();

    this.addRibbonIcon("presentation", "Present current note with deckrun", () => this.present("single"));

    this.addCommand({
      id: "present",
      name: "Present current note",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "P" }],
      callback: () => this.present("single"),
    });
    this.addCommand({
      id: "present-reveal",
      name: "Present current note (reveal bullets one by one)",
      callback: () => this.present("single", { reveal: "1" }),
    });
    this.addCommand({
      id: "present-links",
      name: "Present as course (this note + every note it links)",
      callback: () => this.present("links"),
    });
    this.addCommand({
      id: "present-folder",
      name: "Present current folder as one deck",
      callback: () => this.present("dir"),
    });
    this.addCommand({ id: "open-index", name: "Open deck index in browser", callback: () => this.openIndex() });
    this.addCommand({ id: "copy-url", name: "Copy deck URL of current note", callback: () => this.copyUrl() });
    this.addCommand({
      id: "toggle-server",
      name: "Start / stop the deck server",
      callback: () => (this.server?.running ? this.stopServer() : this.startServer()),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((i) => i.setTitle("Present with deckrun").setIcon("presentation").onClick(() => this.present("single", {}, file.path)));
        } else if (file instanceof TFolder) {
          menu.addItem((i) => i.setTitle("Present folder with deckrun").setIcon("presentation").onClick(() => this.present("dir", {}, file.path)));
        }
      }),
    );

    if (this.settings.autoStart) {
      this.app.workspace.onLayoutReady(() => void this.startServer(true));
    }
  }

  async onunload() {
    await this.stopServer(true);
  }

  // ---------------------------------------------------------------- server

  async startServer(quiet = false): Promise<boolean> {
    if (this.server?.running) return true;
    const s = this.settings;
    this.server = new DeckServer(new VaultNoteSource(this), {
      port: s.port,
      defaults: { theme: s.theme, template: s.template, transition: s.transition },
      maxSlideLines: s.maxSlideLines,
      log: (m) => console.log(m),
    });
    try {
      await this.server.start();
      if (!quiet) new Notice(`obs2deck server → ${this.server.url}`);
      this.updateStatus();
      return true;
    } catch (e) {
      this.server = null;
      this.updateStatus();
      new Notice(`obs2deck: could not start server on port ${s.port}: ${(e as Error).message}`, 8000);
      return false;
    }
  }

  async stopServer(quiet = false) {
    if (!this.server) return;
    await this.server.stop();
    this.server = null;
    this.updateStatus();
    if (!quiet) new Notice("obs2deck server stopped");
  }

  private updateStatus() {
    if (!this.statusEl) return;
    const running = !!this.server?.running;
    this.statusEl.setText(running ? `deckrun :${this.server!.port}` : "deckrun off");
    this.statusEl.toggleClass("is-running", running);
    this.statusEl.setAttribute("aria-label", running ? `obs2deck: ${this.server!.url} (click to open index)` : "obs2deck: server stopped (click to start)");
  }

  // ---------------------------------------------------------------- actions

  private targetPath(mode: DeckMode, explicit?: string): string | null {
    if (explicit) return explicit;
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("obs2deck: open a note first");
      return null;
    }
    if (mode === "dir") {
      if (!file.parent || file.parent.isRoot()) {
        new Notice("obs2deck: this note is at the vault root; no folder to present");
        return null;
      }
      return file.parent.path;
    }
    return file.path;
  }

  private async deckUrl(mode: DeckMode, query: Record<string, string>, explicit?: string): Promise<string | null> {
    const rel = this.targetPath(mode, explicit);
    if (!rel) return null;
    if (!(await this.startServer(true))) return null;
    const url = await this.server!.urlFor(rel, mode, query);
    if (!url) new Notice(`obs2deck: cannot find ${rel} in the vault index`);
    return url;
  }

  async present(mode: DeckMode, query: Record<string, string> = {}, explicit?: string) {
    const url = await this.deckUrl(mode, query, explicit);
    if (!url) return;
    if (this.settings.openInBrowser) {
      window.open(url, "_blank");
    } else {
      await navigator.clipboard.writeText(url);
      new Notice(`obs2deck: copied ${url}`);
    }
  }

  async copyUrl() {
    const url = await this.deckUrl("single", {});
    if (!url) return;
    await navigator.clipboard.writeText(url);
    new Notice(`obs2deck: copied ${url}`);
  }

  async openIndex() {
    if (!(await this.startServer(true))) return;
    window.open(this.server!.url + "/", "_blank");
  }

  // ---------------------------------------------------------------- settings

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.server?.setMaxSlideLines(this.settings.maxSlideLines);
  }
}
