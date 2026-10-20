# Browser panel

`/browser` shows a real web page in a viewer-family panel: tab strip, address, page, one status line, controls. The page is a
Chromium frame (see `src/browser/types.ts`) drawn through the shared graphics service; nothing here depends on Chromium itself.

## What owns what

| Piece | File | Responsibility |
|---|---|---|
| Frames to rows | `graphics/stream.ts` (`FrameStream`, `GraphicsService.openStream`) | One live picture: Kitty placeholders under two alternating image ids (the previous id is deleted one update later, `settle()` removes the last), or character art. Identical frames skipped by hash; frames dropped, never queued; adaptive interval (66 ms, backs off); character art at most 8 fps. PNG over 16 MB skipped; box clamped to 297. |
| Tabs | `browser/session.ts` (`BrowserSession`) | Up to 12 tabs, one stream and latest frame per tab, popups as tabs, notices, debounced resize to the viewport (CSS px = columns x cell width / scale), zoom steps 25..500%, find, change notifications at most every 33 ms, crash/close shown as an error with Reload. |
| Panel | `browser/BrowserPanel.ts` | Focus model, key and mouse handling, drawing. |
| Addresses | `browser/address.ts` | `normalizeAddress`, `displayUrl`, `popupAddress`. |
| Keys | `browser/keymap.ts` | `Key` to `KeyEventInput`; `cellToViewport` for the mouse. |

## Focus

| Focus | Keys |
|---|---|
| `chrome` (start) | Browser commands only; none reaches the page. `j/k` arrows scroll, Space/`b` PageDown/PageUp page, `g/G` top/bottom, `+ - 0` zoom, `[ ]` or `H/L` back/forward, `r/R` reload/hard, `s` stop, `o` address, `t` new tab, `x` close tab, Tab/Shift+Tab/`1-9` tabs, `/` find, `n/N`, Enter or `i` page, `c` copy URL, Esc closes the browser. |
| `page` | Every key goes to the page except Esc (back to chrome). Paste is `insertText`. |
| `address` | Edit the URL; Enter navigates through `normalizeAddress` (a Markdown file is returned as `open-document`); Esc cancels. |
| `find` | Edit the query; Enter finds (again: next); Esc returns to chrome. |

Ctrl+C closes the browser in every focus. A click on the page focuses and is forwarded; the wheel scrolls the page in any focus; a
click on a tab or the address row is a browser click. The terminal key decoder reports no Ctrl+L, so `o` opens the address bar.

## Addresses

Accepted: `http:`, `https:`, `file:` (regular files), `about:blank`, bare hosts with a dot (`https://`), `localhost`/loopback
(`http://`), existing files by relative, absolute or `~` path. Refused with a plain reason: every other scheme, text with spaces
(NMSh has no search engine and looks nothing up), single words, user:password addresses, control and bidi characters.
Displayed URLs are always the tab's real URL with control and bidi characters removed and any password hidden.

## For the integrator

- Build the session with `openStream: owner => service.openStream(owner)` and `cell: () => decision.cell`.
- Call `renderBrowserPanel` for every frame of the UI (it resizes the session to the page area) and `session.settle()` after the
  rows were written. Subscribe `session.onChange` to schedule a render.
- When a program takes the screen and the graphics are released, call `session.forgetPictures()`.
- Handle the actions `close`, `copy` and `open-document`; dispose the session when the panel closes.
