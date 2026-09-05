/** Thin wrapper over deckrun's parser and HTML generator (bundled from npm). */
import { parseSlides } from "deckrun/dist/parser.js";
import { generateHtml } from "deckrun/dist/generate.js";
import { THEME_IDS, DEFAULT_THEME } from "deckrun/dist/themes.js";
import { TEMPLATE_IDS, TRANSITION_IDS, DEFAULT_TEMPLATE, DEFAULT_TRANSITION } from "deckrun/dist/presentation-options.js";

export { THEME_IDS, TEMPLATE_IDS, TRANSITION_IDS, DEFAULT_THEME, DEFAULT_TEMPLATE, DEFAULT_TRANSITION };

export interface RenderOptions {
  title: string;
  theme?: string;
  template?: string;
  transition?: string;
  headFont?: string;
  bodyFont?: string;
}

export function slideCount(markdown: string): number {
  return parseSlides(markdown).length;
}

/**
 * Render deck Markdown to a self-contained HTML page. `standalone` makes
 * deckrun load KaTeX and Mermaid from its pinned CDNs instead of /__vendor.
 */
export function renderDeckHtml(markdown: string, opts: RenderOptions): string {
  const slides = parseSlides(markdown);
  return generateHtml(
    slides,
    opts.title,
    false,
    opts.theme || DEFAULT_THEME,
    "m",
    { head: opts.headFont || undefined, body: opts.bodyFont || undefined },
    { template: opts.template || DEFAULT_TEMPLATE, transition: opts.transition || DEFAULT_TRANSITION, standalone: true },
  );
}
