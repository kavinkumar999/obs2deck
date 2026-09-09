# obs2deck

Present any Obsidian note as a slide deck. Press `Cmd/Ctrl+Shift+P` and the
current note opens in your browser as a [deckrun](https://github.com/arpitbbhayani/deckrun)
presentation. Every note in the vault gets its own local URL, rendered live
from the note, so the deck is never out of date.

No export step, no copies of your notes, nothing leaves your machine. The
plugin runs a small HTTP server on `127.0.0.1` inside Obsidian and bundles
deckrun's parser and renderer.

## Install

**With BRAT (recommended until the plugin is in the community list):**

1. Install and enable the community plugin **BRAT**.
2. BRAT settings → *Add Beta Plugin* → `kavinkumar999/obs2deck`.
3. Enable **obs2deck** in Settings → Community plugins.

BRAT installs the latest GitHub release and updates it when a new version is
tagged.

**Manually:** download `main.js`, `manifest.json`, `styles.css` from the
[latest release](https://github.com/kavinkumar999/obs2deck/releases) into
`<vault>/.obsidian/plugins/obs2deck/`, reload Obsidian, enable the plugin.

Desktop only. Needs no other software.

## Use

| Command | Default hotkey | Opens |
| --- | --- | --- |
| Present current note | `Cmd/Ctrl+Shift+P` | `/folder/note` |
| Present current note (reveal bullets one by one) | | `/folder/note?reveal=1` |
| Present as course (this note + every note it links) | | `/folder/note?mode=links` — for MOC / index notes |
| Present current folder as one deck | | `/folder?mode=dir` |
| Open deck index in browser | | `/` — every note, grouped by folder |
| Copy deck URL of current note | | |
| Start / stop the deck server | | |

Also available: a ribbon icon, a status bar item showing the server port
(click to open the index), and *Present with deckrun* in the file and folder
context menus.

In the deck: arrows move, `F` fullscreen, `O` overview grid, `T` switch theme,
`L` laser, `D` draw, `?` shows all controls. Save the note in Obsidian and the
open deck reloads within two seconds.

## URLs

The server listens on `http://127.0.0.1:7890` (configurable). URLs are the
vault path, lowercased, with runs of non-alphanumerics turned into `-`:
`Java/2. Concurrency & Multithreading/5. Executor Service.md` becomes
`/java/2-concurrency-and-multithreading/5-executor-service`.

| URL | Result |
| --- | --- |
| `/` | index of all notes |
| `/hld/` | folder listing with a "present whole folder" link |
| `/hld/caching` | deck for `HLD/Caching.md` |
| `/caching` | same deck when the name is unique in the vault |
| `/graph-traversal` | numeric prefixes are optional (`2. Graph Traversal.md`) |
| `/hld/consistant-hashing` | typos redirect to the closest match |
| `/introduction` | ambiguous names show a picker |
| `/dsa/graph?mode=dir` | folder as one deck, natural file order |
| `/hld/hld?mode=links` | note plus every note it links, in link order |
| `/hld/caching?raw=1` | the generated deck Markdown |
| `/HLD/_resources/x.png` | any file in the vault (how decks load images) |

Query options: `theme`, `template` (`classic`, `minimal`, `editorial`,
`spotlight`), `transition` (`slide`, `fade`, `zoom`, `lift`, `none`), `head`
and `body` fonts, `reveal=1`, `raw=1`. Defaults are set in the plugin settings.

## How a note becomes slides

| Obsidian | Deck |
| --- | --- |
| YAML frontmatter | removed; `tags` shown under the title |
| `# H1` | title slide with tags and note path; later H1s become section slides |
| Content before the first `##` | stays on the title slide (an `[!abstract]` callout works well); moves to an "Overview" slide if long |
| `## H2` | one slide each |
| Long slide (over the "Lines per slide" setting, default 15) | split at `### H3` into `H2 · H3` slides, then paginated as "(cont. 2)". Table rows, list items, callout lines and code lines all count; blank lines do not |
| `---` | slide break; `***` and `___` stay as rules |
| `![[img.png]]`, `[[img.png\|"caption"]]` | standard images; a lone image on a slide gets deckrun's text-left / image-right split |
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]` | bold text; a "Related notes" slide is appended unless the note already has a Related section or the setting is off |
| `![[Other Note]]` | pointer line "See note: Other Note" |
| `> [!tip] Title` and other callouts | blockquote with a bold label such as `🔥 Tip: Title` |
| `==highlight==` | `<mark>` |
| `%%comment%%` | removed |
| Code, tables, math, Mermaid | passed through; fences are never split |

## Settings

Port, auto-start, open-in-browser (off copies the URL instead), default theme,
template, transition, lines per slide (6 to 30, default 15; raise it if your
notes keep getting "(cont. 2)" slides), an "Append Related notes slide" toggle,
and a start/stop button for the server.

## Privacy

The server binds to `127.0.0.1` only. KaTeX and Mermaid, when a note uses
them, load from jsDelivr; fonts and syntax highlighting themes load from
deckrun's pinned CDNs, exactly as in deckrun itself. Nothing else is fetched
and nothing is uploaded.

## Development

```bash
npm install
npm run dev              # rebuild on change (main.js + dist/node.cjs)
npm test                 # vitest
npm run serve            # run the server against a vault without Obsidian (OBSIDIAN_VAULT or .env)
npm run deploy           # build and copy the three plugin files into OBSIDIAN_VAULT
npm run parity           # compare with the original Python converter in scripts/legacy
```

Releases: `npm version patch|minor|major` bumps `package.json`,
`manifest.json`, and `versions.json` and tags the commit. `git push --follow-tags`
triggers the GitHub Action, which builds, tests, and attaches `main.js`,
`manifest.json`, and `styles.css` to a release named after the tag.

## Credits

Rendering by [deckrun](https://github.com/arpitbbhayani/deckrun) by Arpit
Bhayani (MIT), bundled. MIT licensed.
