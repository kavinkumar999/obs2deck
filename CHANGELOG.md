# Changelog

## 0.1.2

- New setting "Append Related notes slide" (default on). Turn it off to stop
  the converter from adding an auto-generated slide of the note's wikilinks
  at the end of single-note decks. Applies without a server restart. Also
  exposed as `relatedSlide` on `convertMany` and `DeckServer` options.

## 0.1.1

- New setting "Lines per slide" (6 to 30, default 10). Replaces the hardcoded
  10-line cap that decided when a slide is split at `###` or paginated as
  "(cont. 2)". Changes apply to the next deck request without restarting the
  server. Also exposed as `maxSlideLines` on `convertNote`, `convertMany`
  and `DeckServer` options for library users.

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
