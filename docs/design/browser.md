# Real browser (`/browser` and the rendered document preview)

NMSh does not reimplement CSS. When you ask for a real browser surface it drives a Chrome or Chromium that is **already installed**, over the DevTools Protocol on a pipe, and shows the frames
it produces through the shared graphics service. Prior art studied (all MIT; nothing was copied): [casty](https://github.com/sanohiro/casty) (CDP screencast to Kitty graphics),
[zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser) (Electron offscreen rendering with damage tracking), [konaito/terminal-browser](https://github.com/konaito/terminal-browser)
(TypeScript, screencast frames alternating two image ids, input mapping). NMSh keeps their useful ideas (screencast, two alternating image ids, backpressure by skipping frames) with a smaller dependency set:
no Puppeteer, no Electron, no WebSocket client, no bundled browser.

## Architecture

| Layer | Files | Responsibility |
|---|---|---|
| Boundary | `src/browser/types.ts` | `BrowserEngine`, `BrowserPage`, `PreviewServer`: everything above this file runs against a fake in tests |
| Engine | `src/browser/engine/` ([design](browser-engine.md)) | Locate a browser, launch one process tree lazily with a private profile, CDP over a pipe, pages, input, find, zoom, screencast with acknowledgement-based backpressure, idle shutdown; the loopback preview server; Markdown to HTML |
| Host | `src/browser/host.ts` | Created on first use; loads the engine module (and `marked`) with a dynamic import; nothing is imported, started or listening until a surface opens |
| Presentation | `src/browser/session.ts`, `BrowserPanel.ts`, `documentPreview.ts`, `graphics/stream.ts` ([design](browser-panel.md)) | Tabs, focus model, keys and mouse, resize to the viewport, frames to Kitty placeholders or character art |
| Document workspace | `src/viewer/DocumentWorkspace.ts` ([design](document-workspace.md)) | The Chromium preview of the editor's buffer |

## Installation and resources

- A Chrome or Chromium (110+) is found in the usual places (`/Applications/Google Chrome.app`, Chromium, Edge on macOS; `google-chrome`, `chromium`, `microsoft-edge` on PATH); `NMSH_BROWSER` names another. **NMSh never downloads a browser.** Without one, `/browser` says so and the document preview uses NMSh's own renderer; the rest of NMSh does not notice.
- Nothing runs at startup. One browser process tree exists at a time, started by the first browser surface and stopped 60 s after the last page closes, on exit, or by turning Settings → Real browser Off. Pages of the document preview and `/browser` tabs share it; each preview has its own throwaway browser context.
- The profile is a throwaway directory in NMSh's cache folder (isolated per `XDG_CONFIG_HOME`, so QA never touches a real profile). Idle cost is nil; while a page is shown, expect a Chromium renderer's memory.

## Security

- Sandbox on (the only exception, `NMSH_BROWSER_NO_SANDBOX=1`, is for containers). No remote debugging port, no extensions, downloads and permission prompts denied, no sync or metrics, minimal environment with no NMSh tokens.
- `/browser` addresses: `http`, `https`, `file` (a regular file you named), `about:blank`. Everything else (`javascript:`, `data:`, `chrome:`, `view-source:`, …) is refused before navigation, and again at the engine for redirects and links. Typed addresses with credentials are refused; the address shown is always the tab's real URL.
- Local previews are a different trust class from browsing: scripts off unless trusted, a CSP, loopback-only server with an unguessable path and Host check, local files only inside the document's folder, remote requests refused and reported, no shared cookies.
- Keyboard ownership: the panel starts in `chrome` focus where keys are browser commands and none reaches the page; `page` focus forwards every key except `Esc`; typing never reaches a command, and the browser closes if a command starts.

## Rendering paths

| Terminal | Frames | Status |
|---|---|---|
| Ghostty, Kitty (Kitty graphics verified by reply) | PNG frames uploaded under two alternating image ids, drawn as Unicode placeholders; skipped when identical, dropped under backpressure | NOT RUN |
| Zed, Terminal.app, SSH, tmux, `NO_COLOR` | Frames decoded and drawn as quadrant-block character art at up to 8 frames per second | NOT RUN. Lower resolution, readable layout; **not** visually equivalent to the real pixels |
| iTerm2, WezTerm, Alacritty | Not specifically handled; follow the graphics decision | NOT RUN |

## Verified by

`tests/browserEngineChrome.test.ts` (a real Chrome 156 here: lazy launch and clean shutdown, idle stop and relaunch, URL policy, redirects, screencast, CSS animation advancing between frames, zoom, input into a form and a link click, wheel, find with scripts off, scripts toggle, popups/dialogs/downloads, remote refusal, cookie isolation, closing), `tests/browserPreviewServer.test.ts`, `tests/browserEngineProtocol.test.ts`, `tests/browserPanel.test.ts`, `tests/browserSurface.test.ts`, `tests/documentPreview.test.ts`; the document Console: `tests/browserConsole.test.ts`, `tests/browserConsoleView.test.ts`, `tests/browserConsoleChrome.test.ts`. Chrome-dependent tests skip when no browser can start.
