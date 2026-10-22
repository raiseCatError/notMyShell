# Browser engine and preview server

`src/browser/engine/*` implements the `BrowserEngine`, `BrowserPage` and `PreviewServer` contracts of `src/browser/types.ts` on an
installed Chromium. Nothing else in NMSh depends on Chromium. Nothing is downloaded: with no browser installed `available()` says what
to install or set and everything else keeps working.

## What owns what

| Piece | File | Responsibility |
|---|---|---|
| Locator | `chrome.ts` | Finds Chrome, Chromium or Edge and checks `--version` (major 110 or newer). `NMSH_BROWSER` (absolute, executable) wins and is never second-guessed. macOS: the three `/Applications` bundles. Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge` on `PATH`, in that order. |
| Protocol | `cdp.ts` | DevTools Protocol over `--remote-debugging-pipe`: UTF-8 JSON, one NUL after each message, written to the child's fd 3 and read from fd 4. Ids, per-request timeout (15 s), events, flat sessions. Buffering is bounded: one message over 32 MB tears the connection down. Closing the pipe rejects everything pending. |
| Process | `engine.ts` | One lazily started process tree, idle shutdown, `shutdown()`, relaunch after a crash. |
| Page | `page.ts` | One DevTools target plus NMSh's policy: URL rules, frames, input, find, zoom, dialogs, popups, downloads. |
| Preview | `preview.ts` | The loopback server behind a document preview. |
| Markdown | `markdownHtml.ts` | `markdownToHtml` and `htmlDocumentFor` (Mermaid fences become `data:` PNG images when drawn). |
| Diagrams | `diagram.ts` | The Mermaid renderer page: isolated world, page scripts off, no network, SVG drawn only as an image, PNG out ([diagrams](diagrams.md)). |

## Process

The engine starts on the first `open`, is shared by every page and stops by itself `idleMs` (default 60 s) after the last page closes
(a new `open` cancels the timer, which is unref'd). `shutdown()` sends `Browser.close`, waits 2 s, then SIGTERM, 2 s, then SIGKILL; an
`exit` hook on NMSh's own process kills the browser synchronously so none is left behind. If the browser dies by itself every page gets
`crashed` then `closed`, `stats()` reports it stopped and the next `open` launches a fresh one.

The browser sees almost nothing of NMSh: the child environment is `PATH`, `LANG` and `TMPDIR` from `options.env` and `HOME` set to
the profile directory (created `0700`). Flags: `--headless=new --remote-debugging-pipe --user-data-dir=<profile>`, extensions, sync,
background networking, component updates, breakpad and default apps off, audio muted, two renderers at most, Translate / MediaRouter /
OptimizationHints off, a fixed colour profile, `--deny-permission-prompts`, and a mock keychain (macOS) or basic password store (Linux)
so the throwaway profile never touches the person's keychain. The sandbox stays on; `NMSH_BROWSER_NO_SANDBOX=1` adds `--no-sandbox`
and exists only for CI containers where the sandbox cannot start. Downloads are denied at the browser and at every preview context.

Every new page target is auto-attached paused. A target that has an opener (a window a page opened) is closed before it requests
anything; the pages NMSh creates are resumed at once. So a popup never loads, and the opener's `Page.windowOpen` becomes a `popup`
event (web) or a `blocked` event (preview) for the panel to act on. Each page is opened in its own window (`newWindow`) so every page is
visible and renders and screenshots independently.

## Pages

- `web` pages use the default (persistent) context. Only `http:`, `https:`, `file:` and `about:blank` are navigated. The requested
  address is checked before `Page.navigate`, and the committed main-frame URL after every navigation (a redirect or link to `blob:`,
  `data:`, `chrome:`, `view-source:` and so on ends on `about:blank` with a `blocked` event). Chrome's own error page for a failed load is
  allowed and shown under the address that failed.
- `preview` pages each get a throwaway browser context, disposed on close, so they share no cookies or storage with browsing. Network
  requests are intercepted (`Fetch`): only the preview's own origin passes (plus `data:` images and fonts); everything else fails with
  `BlockedByClient` and a `blocked` event. A refused main-frame navigation is aborted, so the preview stays where it was. Requests the
  preview's CSP stops never reach the network layer; those are reported from Chrome's security log entries.

### Frames

The screencast starts with the first frame listener and stops with the last. A screencast frame is always in CSS pixels, so at 1:1 it is
used as is and otherwise (device scale, zoom) the moment is captured again with `Page.captureScreenshot` so every frame is
`viewport * scale` pixels, as the contract says. Delivery is one frame at a time: while a listener is still working, newer frames are
skipped, and the acknowledgement that asks Chrome for more is held until every listener has settled. A slow consumer therefore sees fewer
frames and nothing queues. The size reported in `Frame` is read from the PNG header.

### Zoom

The page is told a viewport of `viewport / zoom` CSS pixels with a device scale of `scale * zoom`, so the frame size is constant for
any zoom (0.25 to 5). Mouse coordinates and wheel deltas are divided by the zoom.

### Input

Mouse maps to `Input.dispatchMouseEvent` (move, press, release with a held-buttons mask, wheel). A key `down` of a printable character
is a `keyDown` with its text (which types it); other keys are `rawKeyDown` with the Windows virtual key code Chrome needs for scrolling
and editing; with Ctrl or Meta a few letters carry the editing command (`selectAll`, `copy`, `paste`...). `up` is `keyUp`. `char` sends a
`char` event: a caller sends either `down` with `text` or `char`, not both. `insertText` is `Input.insertText`.

### Editable focus

With scripts on, a script added to every new document (and a binding with a random name per page, removed from `window` once captured)
reports whether the focused element is a text field, a `textarea`, a `select` or content-editable. It becomes `editable` events, so the
panel knows keys belong to the page. Without scripts there is nothing to report and `editable` stays false.

### Find

`find()` runs in a DevTools isolated world (`Page.createIsolatedWorld` and `Runtime.evaluate`). This is not page script: it works on
previews with scripts disabled, which was verified against Chrome 156. It counts case-insensitive matches in visible text (hidden
elements, `script`, `style` and `textarea` are skipped), selects the next one (the selection is the highlight) and scrolls it to the
middle. The same query steps forward or (with `backwards`) back and wraps; a new query starts at the first (or last) match. `clearFind()`
clears the selection. The world is recreated after a navigation.

### Titles

`Target.targetInfoChanged` is not sent for every title change (a script setting `document.title` can go unreported), so the title is
also read with `Target.getTargetInfo` after each load and every 500 ms while the page is open. Titles and addresses shown to the person
have C0, C1 and bidi controls stripped.

### Dialogs, popups, downloads

`alert` is accepted; `confirm`, `prompt` and `beforeunload` are dismissed. Each emits `dialog` with the message. A download is denied and
emits `download-blocked` with its address.

## Preview server

One `node:http` server on `127.0.0.1` (port 0) for all handles. A handle's address is `http://127.0.0.1:<port>/<token>/` with a
16-byte random token; `dispose()` invalidates it, `close()` stops the server. Only `GET` and `HEAD`; `Host` must be `127.0.0.1:<port>`
or `localhost:<port>` (else 421, the DNS-rebinding defence); `Sec-Fetch-Site: cross-site` is refused; at most 32 connections; header and
request timeouts are set.

`/<token>/` returns the current HTML (the editor's buffer, replaced by `update`). Everything else is an asset under the document's
folder: the path is decoded exactly once; NUL, backslash, empty, `.`, `..` and dot-prefixed segments are refused; the extension must be
on the allow-list (css, png, jpg, jpeg, gif, webp, avif, ico, svg, woff, woff2, ttf, otf, html, htm, and js, mjs, json only for a trusted
document); the path is resolved under `realpath(root)` and the real path must stay inside it (and keep an allowed extension and no
dot segment, so a link inside the folder cannot reach a hidden or disallowed file); the file is opened with `O_NONBLOCK | O_NOFOLLOW`
and the same descriptor is `fstat`ed: a regular file of at most 25 MiB. A FIFO, a directory or a device is refused without blocking.
Directories are never listed.

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
`Cross-Origin-Resource-Policy: same-origin`. HTML (the document and html assets) carries a CSP that allows only the page's own origin
and inline styles plus `data:` images and fonts, with scripts, connections, frames, objects, media, `base` and forms off; a trusted
document additionally gets `script-src 'self' 'unsafe-inline'; connect-src 'self'` and still nothing remote. SVG is served with
`Content-Security-Policy: sandbox` and `Content-Disposition: inline`.

Refused and missing assets are recorded in `problems()` (the last 50, newest last, control characters stripped, 200 characters each) for
the interface to show.

## Markdown

`markdownToHtml(markdown, {title, colorScheme})` renders with `marked` (GFM on) into a full document with a built-in README-style
stylesheet (system fonts, readable measure, headings, code, tables, quotes, task lists, images at most 100% wide) and light or dark CSS
variables; no external resources. Raw HTML in the source is kept as written: the preview is served with a CSP that forbids scripts and
remote loads and runs with scripts disabled unless the project is trusted, so sanitising would only change what the author wrote. The
title is escaped. `htmlDocumentFor(source, kind, options)` is the one entry point: HTML is returned as is, Markdown is converted.
`markdownHtml.ts` imports `marked` at module load, so the integrator should import `src/browser/engine/markdownHtml.js` lazily, when a
preview opens.

## Limits

- Find counts occurrences within single text nodes; a match split across inline elements (`ne<b>edle</b>`) is not found.
- A page that never finishes loading does not delay `open`; `loading` simply stays true.
- The first launch on a fresh profile can take several seconds; `open` waits up to 30 s.
- Frames for a scale other than 1 (or a zoom other than 1) cost a second render per frame.

## Tests

`tests/browserEngineChrome.test.ts` drives the real browser (and skips with a reason when none can start). The rest run anywhere:
`browserEngineProtocol` (pipe framing and timeouts against a fake pipe, the locator against a fake filesystem, launch arguments and
environment, URL policy, key mapping), `browserPreviewServer` (traversal, symlinks, FIFOs, size, extensions, Host, cross-site, methods,
tokens, CSP, script gating, the problems log) and `browserPreviewMarkdown`. Shared helpers: `tests/support/browserFixtures.ts`.
