# Mermaid diagrams (#462)

A ```` ```mermaid ```` fence in a Markdown document is drawn as a diagram in NMSh's rendered views when a Mermaid the person installed and
the real browser are available. The fence's text is the only truth: drawing never changes it, and anything not drawn shows the fence
exactly as written with one line saying why.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Fences whose first info word is `mermaid` (any case) are diagrams; other fences are untouched. | `diagramsMermaid`, `diagramsDocument` |
| 2 | Preview (NMSh's renderer and the Chromium preview), Split's preview pane, the read-only viewer and Hybrid's inactive blocks draw them; Source and the editor show text. | `diagramsDocument`, `browserPreviewMarkdown`, `documentWorkspaceApp` |
| 3 | Hybrid: the block with the caret is its exact, editable source; nothing is drawn while it is open; leaving it draws the edited text. | `diagramsDocument` (Hybrid) |
| 4 | Source positions: diagram rows carry the fence's source line; copy-code numbering is unchanged; a drawing arriving does not move the hybrid viewport (it is anchored to a line). | `diagramsDocument` |
| 5 | Edits re-draw without rewriting Markdown; undo and redo go through the text (an undone diagram comes from the cache). | `diagramsDocument` |
| 6 | Theme: light or dark from the theme's text colour, the theme's text, accent and line colours; grey without colour. | `diagramsMermaid`, `diagramTheme()` |
| 7 | Any width: the picture is fitted to the columns (aspect kept) and at most 24 rows; `i` opens it in the image viewer (zoom 150–400 %, pan). | `diagramsDocument` (30/50/80/120) |
| 8 | Not drawn → the fence as written + `(diagram not drawn: reason)`: on request and not asked yet, off, no browser, browser off, images off, Mermaid not installed, syntax error, out of bounds, timeout, crash, unclosed fence. | `diagramsService`, `diagramsDocument`, `documentWorkspaceApp`, `diagramsChrome` |
| 9 | No document script runs, nothing is fetched, nothing on disk is reachable, the generated SVG reaches the terminal only as pixels. | `diagramsChrome` (hostile set, zero requests at a local server) |
| 10 | Bounded work: text, lines, line length, nesting, directives, edges, drawing size, pixels, time; a hung or crashed renderer never freezes the editor. | `diagramsMermaid`, `diagramsChrome` |
| 11 | No browser is started by opening a document; one renderer page at most, closed when no document shows diagrams or after 60 s idle; nothing retained after close. | `diagramsService`, `documentWorkspaceApp` |

## Renderer choice

| Option (October 2026) | Licence | Cost | Verdict |
|---|---|---|---|
| **mermaid** 12.2.0, the reference implementation | MIT; its single-file bundle `dist/mermaid.min.js` (5.5 MB) also contains DOMPurify (Apache-2.0/MPL-2.0), chevrotain (Apache-2.0), d3 (ISC), KaTeX, cytoscape, dagre, lodash (MIT) and ELK (**EPL-2.0**) | needs a DOM: a browser | **Chosen**, run in NMSh's existing lazy Chromium. Whatever it draws is Mermaid's own reading of the syntax, so nothing is approximated. |
| mermaid as an npm dependency of NMSh | as above | 122 MB unpacked plus about 20 dependencies in every install | Rejected: weight for every user, and the bundle's EPL-2.0 part would ship inside a GPL-3.0-only package. |
| Vendoring `mermaid.min.js` into the repository | as above | 5.5 MB in git and in every package | Rejected for the same licence reason (an aggregate is arguable, but it is the maintainer's call, not this slice's). |
| @mermaid-js/mermaid-cli 12.0.0 | MIT | Puppeteer and its own Chromium download | Rejected: a second browser manager and implicit downloads. |
| beautiful-mermaid 1.1.3 (SVG/ASCII without a DOM) | MIT, depends on elkjs (EPL-2.0) | small, in-process | Rejected: a re-implementation of a subset of the syntax; unsupported input could be drawn wrongly instead of refused. Not updated since 2026-02. |
| A Rust renderer (mermaid-rs and similar) | various | a native binary per platform | Rejected: a second toolchain and binary to sign and ship, again a subset. |

So NMSh **uses a Mermaid the person installed**, exactly as it uses a browser the person installed: `NMSH_MERMAID` (a package folder or
its `dist/mermaid.min.js`, absolute; when set it is the only candidate), else a global npm install next to the running Node
(`<prefix>/lib/node_modules/mermaid`), `/opt/homebrew`, `/usr/local`, `/usr`, `~/.npm-global`, `~/.local`, or the copy inside a global
`@mermaid-js/mermaid-cli`. Install with `npm install -g mermaid`. The bundle is read once into memory (a regular file opened without
following a final symlink, at most 16 MB, not world-writable, from a package named `mermaid`, version 10 or newer). Nothing is downloaded.
Tested with 12.2.0; CI fetches that exact release for its tests and checks the npm integrity hash.

## The security boundary

The page that draws is designed so that **neither the document nor Mermaid itself has to be trusted**: Mermaid is trusted only to
draw correctly, not to be safe.

```
document text ──(argument of a DevTools call: data, never HTML or code)──► isolated world: mermaid.render() ──► SVG string
                                                                                                                   │ untrusted
       inert DOMParser document ◄── parse (no script, no loads) ◄─────────────────────────────────────────────────┘
                │ sized from its viewBox (bounded), serialised as XML
                ▼
       <img src=blob:…> (SVG as an image: no script, no external loads, no interaction) ──► Page.captureScreenshot ──► PNG
                                                                                                                   │
NMSh: bounded PNG decoder (graphics service) ──► Kitty placeholders │ iTerm2/Sixel (viewer) │ character art ◄────┘
```

- **Process and context.** The existing engine (`src/browser/engine`), its single lazily started Chromium (sandbox on, private
  throwaway profile, minimal environment) and a `preview` page: its own throwaway browser context, downloads denied. No new browser, no
  Puppeteer, no remote-debugging port.
- **No network.** The page has no origin of its own, so the engine's request interception fails every request (only `data:` images and
  fonts pass, which cannot leave the machine); the document additionally carries a CSP with `default-src 'none'`, no scripts,
  connections, frames, objects, `base` or forms. The hostile test points every vector it knows (label images, iframes, links, `click`
  directives, `themeCSS` `@import` and `url()`, front matter, icon packs) at a local server: it receives **zero** requests.
- **No page script.** Page scripts are disabled (`Emulation.setScriptExecutionDisabled`): no `<script>`, event handler or `javascript:`
  URL that reaches the DOM can run (the test checks the page's title after hostile labels that try to change it).
- **The library is isolated from the page.** Mermaid runs in a DevTools isolated world: it shares the DOM (for layout and text
  measurement) but no JavaScript with the page. Timers do not fire while page scripts are off, so that world's timer functions run their
  callbacks as microtasks; a callback that waits on real time cannot outlast the timeout.
- **Configuration.** `securityLevel: 'strict'`, HTML labels off, `maxTextSize` and `maxEdges`, error rendering suppressed, and Mermaid's
  `secure` list locks those keys (and `dompurifyConfig`, `themeCSS`, fonts, ids, log level) against `%%{init}%%` directives and front
  matter. The boundary above does not depend on these: they reduce what reaches the page in the first place.
- **SVG is untrusted.** Parsed into an inert document, sized from its viewBox (refused beyond 16 384 CSS px a side or 40 M px²), drawn
  only as an `<img>`, captured as a PNG of at most 4096 px a side and 8.4 M pixels, decoded by NMSh's own bounded PNG decoder. The SVG
  never reaches the terminal, the clipboard, a file or the Chromium preview.
- **No files.** The renderer page has no folder and no server: it cannot name or read a local file.
- **Chromium preview.** A drawn diagram is placed in the preview page as a `data:image/png;base64` image (checked to be exactly that);
  the preview's own CSP and request interception already allow `data:` images and nothing remote.

## Resources

- **Nothing at open.** Settings → General → Mermaid diagrams: **On request** (default) draws a document's diagrams after the person
  presses `D` (Preview, Split's preview pane, the viewer) or chooses F1 › Diagrams (`g`) / *Draw diagrams* in the palette while editing;
  **Automatic** draws them in every rendered view; **Off** never. Until then no service, browser host or Mermaid file is touched (an app
  test asserts it). The real browser setting, an installed browser and Images on are also required.
- **One page, reused.** The service keeps one renderer page; Mermaid loads once (about 1 s on an M2 MacBook Air), then each diagram
  takes 50–500 ms (measured: 17 diagram types, 44–505 ms). The page closes when no document shows diagrams, or after 60 s without
  work; the engine then stops Chromium on its own 60 s idle timer.
- **Off the typing path.** Rendering is asynchronous; work starts only after 250 ms without a new request, and before each job the text
  must still be shown by an open document (a full render or the hybrid block list says which). A burst of 50 edits draws once
  (deterministic test). A drawing in progress is not interrupted by an edit; it is bounded by the timeout.
- **Cache.** By SHA-256 of the text and theme: at most 24 drawings and 48 MB (decoded pixels plus PNG), oldest first, never one a
  document still shows; at most 24 diagrams per document; 200 remembered failures. Failures are not retried in a loop; asking again
  (`D`) retries the transient ones (timeout, crash, nothing available).
- **Failures.** 8 s per diagram: the library's script is terminated and the page thrown away; a crashed page is reported; the next
  diagram opens a fresh page. The editor never waits on either.
- **Cleanup.** Closing the document releases its terminal pictures and detaches it from the service; NMSh's exit disposes the service
  and the browser host.

## Limits

- Diagram text: 20 000 characters, 1 000 lines, 2 000 characters a line, nesting 32 (subgraph/loop/alt/… blocks plus braces outside
  quoted labels), 4 directives; Mermaid: 500 edges.
- Icon packs (architecture diagrams' `logos:…`) are never fetched: Mermaid draws its placeholder icon.
- Click handlers, links and tooltips are not interactive: the result is a picture.
- The drawing reflects Mermaid's own fonts in a headless Chromium; the terminal shows it at the cell resolution the graphics backend
  allows (character art without a graphics protocol).

## Not verified, and remaining #462 work

- Physical Ghostty and Zed QA: **NOT RUN** (added to `docs/testing/v024-editor-physical-qa.md`).
- `/doctor` does not report Mermaid's location or version yet.
- Remaining #462 items outside diagrams: following `#fragment` links inside a rendered document, outline refinements (the optional
  persistent outline rail), pointer toggling of `<details>` (and hybrid toggling).
