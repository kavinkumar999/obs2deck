import { App, PluginSettingTab, Setting } from "obsidian";
import type Obs2DeckPlugin from "./main";
import { TEMPLATE_IDS, THEME_IDS, TRANSITION_IDS } from "./render";

export interface Obs2DeckSettings {
  port: number;
  theme: string;
  template: string;
  transition: string;
  autoStart: boolean;
  openInBrowser: boolean;
  /** Visible lines a slide may hold before it is split at H3 or paginated. */
  maxSlideLines: number;
}

export const MIN_SLIDE_LINES = 6;
export const MAX_SLIDE_LINES_SETTING = 30;

export const DEFAULT_SETTINGS: Obs2DeckSettings = {
  port: 7890,
  theme: "nord",
  template: "classic",
  transition: "slide",
  autoStart: true,
  openInBrowser: true,
  maxSlideLines: 10,
};

export class Obs2DeckSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Obs2DeckPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Server port")
      .setDesc("Decks are served at http://127.0.0.1:<port>. Restart the server after changing.")
      .addText((t) =>
        t.setValue(String(s.port)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 1023 && n < 65536) {
            s.port = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Start server when Obsidian opens")
      .addToggle((t) =>
        t.setValue(s.autoStart).onChange(async (v) => {
          s.autoStart = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Open browser when presenting")
      .setDesc("Off: the command only copies the deck URL to the clipboard.")
      .addToggle((t) =>
        t.setValue(s.openInBrowser).onChange(async (v) => {
          s.openInBrowser = v;
          await this.plugin.saveSettings();
        }),
      );

    const dropdown = (name: string, key: "theme" | "template" | "transition", ids: string[]) =>
      new Setting(containerEl).setName(name).addDropdown((d) => {
        for (const id of ids) d.addOption(id, id);
        d.setValue(s[key]).onChange(async (v) => {
          s[key] = v;
          await this.plugin.saveSettings();
        });
      });
    dropdown("Default theme", "theme", THEME_IDS);
    dropdown("Default template", "template", TEMPLATE_IDS);
    dropdown("Default transition", "transition", TRANSITION_IDS);

    new Setting(containerEl)
      .setName("Lines per slide")
      .setDesc(
        `A slide body over this many visible lines is split at ### headings, or paginated as "(cont. 2)". ` +
          "Table rows, list items, callout lines and code lines all count. Takes effect on the next deck load.",
      )
      .addSlider((sl) =>
        sl
          .setLimits(MIN_SLIDE_LINES, MAX_SLIDE_LINES_SETTING, 1)
          .setValue(s.maxSlideLines)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxSlideLines = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Server")
      .setDesc(this.plugin.server?.running ? `Running at ${this.plugin.server.url}` : "Stopped")
      .addButton((b) =>
        b.setButtonText(this.plugin.server?.running ? "Stop" : "Start").onClick(async () => {
          if (this.plugin.server?.running) await this.plugin.stopServer();
          else await this.plugin.startServer();
          this.display();
        }),
      );
  }
}
