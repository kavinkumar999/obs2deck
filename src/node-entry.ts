/** Node entry (no Obsidian): used by scripts/parity.mjs, scripts/serve.mjs and tests. */
export { convertNote, convertMany, renderSlides, outgoingLinks, splitFrontmatter, convertInline, convertCallouts, applyReveal } from "./convert/convert";
export { slugify, slugPath, similarity, naturalCompare } from "./convert/slug";
export { FsNoteSource } from "./server/source";
export type { NoteSource } from "./server/source";
export { DeckServer, assetByName } from "./server/server";
export { renderDeckHtml, slideCount, THEME_IDS, TEMPLATE_IDS, TRANSITION_IDS } from "./render";
