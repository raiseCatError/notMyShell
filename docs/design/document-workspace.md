# Document workspace

`/view` and `/edit` on a Markdown or HTML file open one workspace (`src/viewer/DocumentWorkspace.ts`): the file's source, the native editor and a rendered
preview of **one buffer**. Switching between them reopens nothing and loses nothing. `/edit` and `/view` remain separate commands: `/edit file.md` starts in the
editor, `/view file.md` starts in the source. Files of other kinds, and Markdown or HTML the editor refuses (over 1 MiB, read-only, mixed line endings, not yours), keep
the read-only viewer, with the reason shown ("Read-only: …").

## Modes and keys

| Mode | What it is | Keys |
|---|---|---|
| **source** (navigation) | The buffer's text, read-only, with line numbers (the viewer) | `↑↓`/`j k` scroll, `/` find, `:` line, **`h` preview**, **`e` edit**, `r` refresh the preview, `R` reload from disk (asks first when edited), `Ctrl+S` save, `Esc`/`q` close (asks first when edited) |
| **edit** (typing) | The native editor on the same buffer | Every printable key is text, `h`, `e` and `r` included. **`Ctrl+O`** shows the preview and returns to where you were; `Esc` goes to source without closing or discarding; `Ctrl+S` saves; `Ctrl+Z`/`Ctrl+Y` undo and redo |
| **preview** | The rendered current buffer | `h` source, `e` edit, `r` refresh, `T` scripts on/off for this file, scroll/zoom/find/links as below, `Esc` source |

`Ctrl+O` is the switch that works while typing because a terminal can tell it apart from text and the editor does not use it. Nothing relies on keys a terminal cannot distinguish.

## One buffer

There is one `EditorState` (text buffer, undo history, caret, selection, file identity, save and conflict dialogs). The read-only views are re-synced from its lines whenever they are shown, so the source and
the preview always show what is in the buffer, including unsaved edits, and nothing is a second copy that could drift. Showing the preview never writes to the file. Scroll positions are kept per mode.

- **Save** is the editor's atomic save: a new file beside the original, the original's mode, group, line endings, BOM and final newline kept; if the file changed, was replaced or was deleted since it was opened, nothing is written until you choose Overwrite or Reload.
- **Reload from disk** (`R`) is explicit and, when the buffer has unsaved changes, asks first ("Reload, discard mine"). **Refresh** (`r`) only re-renders the buffer.
- Closing with unsaved changes asks: Save, Discard changes or Keep editing.

## The preview

- **A browser installed** (a Chrome or Chromium, Settings → Real browser not Off): the preview is Chromium's rendering of the buffer. The page is served from memory on a loopback-only server, so unsaved text previews without being saved and the document's relative stylesheets, images and fonts load from its own folder (the server enforces containment, file types and size limits). Scripts are off (and the page is served with a CSP that forbids them) unless you trust the file with `T`; CSS animations and transitions run either way. A preview can reach only its own origin: a clicked link is not followed, the status line says so, and `o` opens it in `/browser`. Missing resources are counted in the status line. Refresh swaps the served HTML and reloads the page (Chromium keeps the scroll position of a reload). Leaving the preview closes the page; the engine stays warm for 60 s and then stops.
- **No browser, or Real browser Off:** NMSh's own renderer draws the preview (headings, lists, tables, code, local images through the graphics service, sized headings where the terminal proved text sizing). The two previews share the keys above; the Chromium one adds zoom (`+`/`-`/`0`) and Chromium's find.
- The rendered Markdown is `marked` (GFM) with the document's raw HTML passed through to the sandboxed page and a built-in stylesheet that follows the theme's light or dark.

## Crash recovery

Unsaved text is protected by `src/viewer/draftRecovery.ts` ([#469](https://github.com/raiseCatError/notMyShell/issues/469)); the editor, the workspace and `fileEdit.ts` stay the only owners of the buffer and of the file.

- **When:** a dirty buffer is written 1.5 s after the last change, and at once when the window ends (`stop`). A buffer that is clean again (saved, or undone to the saved text), closed or reloaded retires its draft. A failing store is reported once in the editor's status row and never interrupts typing.
- **Where and how:** `<NMSh config dir>/recovery/<hash of real path>-<pid>.json`, written beside and renamed into place, fsynced, 0600 in a 0700 directory that must be a real directory owned by the user (never followed through a symlink). Persistent app data, not scratch: it lives with the configuration, not under a temporary volume.
- **Offer:** opening a file lists drafts of that real path whose process is no longer running (and ones kept earlier). The offer is a dialog of the editor (`recover`): Restore puts the draft in the buffer as one undoable, unsaved edit (the caret and scroll come back; the file is unchanged); Compare says where the draft differs; Discard retires that draft only; Esc keeps it under a name of its own so later edits cannot replace it. A draft whose base hash differs from the file now on disk says the file changed since.
- **Not provided:** encryption (a key store would be needed to mean anything; the directory is private instead), a hunk-by-hunk merge (#463), recovery of read-only viewer state, a guarantee after every filesystem failure. A window killed within 1.5 s of the last keystroke loses those keystrokes.
- **Verified by** `tests/draftRecovery.test.ts` (store permissions, symlinked directory, liveness, corruption, bounds, keeper debounce/flush/retire, dialog choices), `tests/draftRecoveryApp.test.ts` (the real app: offer, restore, checked save, discard, window end, and a real `SIGKILL` of a process with unsaved text).

## Not provided

No split view, so no automatic refresh while typing; the preview refreshes on request. There is no "open in an external browser" action.

## Verified by

`tests/documentWorkspace.test.ts` (modes, keys, ownership of `h e r`, undo history across switches, unsaved preview, dialogs, per-mode scroll), `tests/documentWorkspaceApp.test.ts` (real files: atomic save with BOM and CRLF, conflicts, reload, read-only fallbacks, images of the unsaved buffer), `tests/documentPreview.test.ts` (the Chromium view against a fake engine: serving, refresh, trust, find, mouse, links, ordering of trust and refresh), `tests/browserApp.test.ts` (fallbacks) and `tests/browserEngineChrome.test.ts` against a real Chrome. Automated and headless: how it looks and feels in Ghostty or Zed is NOT RUN.
