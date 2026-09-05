# Changelog

## 0.1.0

First release.

- Converter: frontmatter, image embeds, wikilinks, callouts, highlights,
  comments; one slide per H2 with H3 splitting and pagination. Output is
  byte-identical to the original Python converter across a 150-note vault.
- Embedded HTTP server on 127.0.0.1: one URL per note, folder listings,
  typo redirects, ambiguity picker, folder decks, course decks, raw Markdown,
  vault file serving, live reload on save.
- Rendering with bundled deckrun 1.6 (themes, templates, transitions, reveals).
- Commands: present note, present with reveals, present as course, present
  folder, open index, copy URL, start/stop server. Default hotkey
  Cmd/Ctrl+Shift+P. Ribbon icon, status bar item, file and folder context
  menu entries.
- Settings: port, auto-start, open in browser, default theme / template /
  transition.
