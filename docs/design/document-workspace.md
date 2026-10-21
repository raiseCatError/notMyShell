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

## Markdown editing helpers

`src/viewer/markdownEdit.ts` ([#463](https://github.com/raiseCatError/notMyShell/issues/463), slice 1) works on the editor's `TextBuffer` and nothing else. The source text is the authority: each helper reads the lines it needs, replaces only the lines it names with `TextBuffer.edit` (one undoable edit that also restores the caret and selection), and leaves everything it does not clearly understand to the editor's ordinary behavior. It is active only for `.md`, `.markdown` and `.mdx` files.

| Key | Behavior |
|---|---|
| Enter | On a list item with the caret after the marker: a new item with the same quote prefix, indentation and marker (ordered: next number, same delimiter; task: unchecked box); the rest of the line moves to it. An empty item ends the list: top level is cleared, a nested one steps out to its parent's level. Not handled (plain newline): a selection, the caret inside the marker, code fences, rules (`---`, `* * *`), escaped markers, non-items. Later numbers are not renumbered. |
| Tab / Shift+Tab | List items covered by the caret or selection move one level with their children and continuation lines. In: by the previous sibling's marker width, so a child still nests under `10.`. Out: to the parent item's indentation. Not a list item: Tab inserts a tab as before. |
| F1 → t | Task: no box → `[ ]`; any open box → check the open ones; all checked → uncheck. Only list items change. |
| F1 → n | Renumber the ordered list at the caret from its first number (same delimiter), across loose items; an item's children follow if its number gains or loses a digit. A bullet or other delimiter at the same level ends the list. |
| F1 → l / p | Link / image around the selection with the address selected for typing; a selected web address becomes the destination and the text is selected; brackets in the text are escaped; no selection inserts a placeholder; multi-line selections are refused. |
| F1 → b i c s | Wrap or unwrap bold, italic, code (a fence longer than any backtick run inside) or strikethrough; the selection stays on the same text. A multi-line selection wraps each non-blank line inside its own quote and list prefix. A marker that is escaped, or part of a longer run (`**x**` is not italic `x`), is text. |

**Tables** (`src/viewer/markdownTable.ts`, slice 2). A table is a header row followed by a delimiter row with the same number of cells (cells split on unescaped pipes, outer pipes optional), through the next blank line; fences are excluded. Tab / Shift+Tab select the neighbouring cell's text (an empty cell puts the caret in its padding; the delimiter row is skipped; at the first or last cell the caret stays and the status says why). F1 in a table adds **r** row below (shaped like the header), **d** delete row (body rows only), **o** column right (each row's new cell mirrors its neighbour's width; a table without trailing pipes gets them on that edit), **x** delete column (never the last), **a** cycle alignment none → left → centre → right (a dash becomes a colon, so the column keeps its width). The editor always shows the source, so there is no separate narrow-terminal rendering: the status line carries the row and column. Not provided: re-padding a table to align its pipes, moving rows, tables inside block quotes or lists, pipes inside HTML.

Limits: code fences are recognised by a line scan (indented code blocks and fences inside block quotes are not); nesting is by indentation columns with tabs as four; HTML blocks are not parsed. Table editing and hunk-by-hunk review of external changes are separate slices of #463.

**Verified by** `tests/markdownEdit.test.ts` (each helper: empty and multi-line selections, nested and mixed lists, quotes, fences, Unicode, very long lines, one undo step, restored drafts) and `tests/markdownEditorKeys.test.ts` (keys, menu at 30–120 columns, non-Markdown files unchanged, CRLF saved as CRLF). Physical Ghostty/Zed: NOT RUN.

## Reviewing external changes

`src/viewer/threeWayMerge.ts` (pure) and `src/viewer/ReviewPanel.ts` (state, keys, drawing) implement the review of [#463](https://github.com/raiseCatError/notMyShell/issues/463); `fileEdit.ts` still owns every read and write.

- **Model:** `base` = `EditableFile.lines` (the lines on disk when the editor last opened or saved the file — a stable common base), `mine` = the buffer, `theirs` = the file now. `merge3` diffs base→mine and base→theirs with the bounded Myers diff already used by `/compare` (`diffLines`, bound 1,500 edits), turns each into change regions in base coordinates and groups regions that overlap, touch, or insert at the same point. A group changed by one side only is taken as is; a group both changed identically appears once; otherwise it is a conflict. Past the bound or 2,000 hunks the region where mine and theirs differ is one coarse conflict (`aligned: false`; "original" is then not offered).
- **Decisions:** disk-only hunks default to the disk's version; conflicts have none until chosen. Enter is refused while one is undecided. History of decisions allows `z`.
- **Applying:** the app re-reads the file with `openForEdit` and applies only if its device, inode, content hash and format are exactly those the review was built from; otherwise the review restarts from the newest version (decisions are not carried over). The merged text replaces the buffer in one `TextBuffer` edit (Ctrl+Z restores what you had), `file` becomes the freshly read disk version (its identity, line endings, BOM and final newline are what a save uses and checks), and the draft keeper sees a dirty buffer, so the recovery draft stays until a save really succeeds. A file deleted meanwhile ends the review; only Save anyway recreates it.
- **Independent review (opus subagent, 2026-10-21) and what changed:** (1) undoing the merge and then saving overwrote the disk's changes because the base had moved on while undo only restored text — `TextBuffer` edits now carry undo/redo hooks and the merge puts the old base back (and the new one on redo); (2) a symlink retargeted to another file was merged against the old file — the review is refused when the real path differs; (3/4) a recovery draft was retired under the wrong path or kept a stale base hash — the keeper now retires under the path it wrote and rewrites when the base changes; (5) repeated lines let the aligner attribute a deletion to either copy — pure insertions and deletions are widened over every place they can slide before clustering, so such cases are conflicts; (6) a restarted review with nothing to decide now re-bases directly. Reproductions are in `tests/reviewExternal.test.ts` and `tests/threeWayMerge.test.ts`; a 200,000-case property check by the reviewer found no other lost or duplicated line.
- **Never:** reading, navigating, previewing and closing write nothing; the review does not change `file.identity`, so a save during or after a closed review still hits the conflict check.
- **Not provided:** word-level hunks, a merge of three arbitrary files, resolving a hunk by editing it in place (apply, then edit), and moved-line detection. Adjacent changes are conflicts on purpose.
- **Verified by** `tests/threeWayMerge.test.ts` (rules, boundaries, identical edits, a 200-round property test, bounds, 50,000 lines) and `tests/reviewExternal.test.ts` (real app and files: apply and undo, conflicts, a file changing again, atomic replacement before save with the draft kept, deletion, no writes while navigating, CRLF and Unicode, 20,000 lines, the Markdown workspace, 30–120 columns).

## Crash recovery

Unsaved text is protected by `src/viewer/draftRecovery.ts` ([#469](https://github.com/raiseCatError/notMyShell/issues/469)); the editor, the workspace and `fileEdit.ts` stay the only owners of the buffer and of the file.

- **When:** a dirty buffer is written 1.5 s after the last change, and at once when the window ends (`stop`). A buffer that is clean again (saved, or undone to the saved text), closed or reloaded retires its draft. A failing store is reported once in the editor's status row and never interrupts typing.
- **Where and how:** `<NMSh config dir>/recovery/<hash of real path>-<pid>.json`, written beside and renamed into place, fsynced, 0600 in a 0700 directory that must be a real directory owned by the user (never followed through a symlink). Persistent app data, not scratch: it lives with the configuration, not under a temporary volume.
- **Offer:** opening a file lists drafts of that real path whose process is no longer running, or whose last write is over a day old (process ids are reused), and ones kept earlier. Stale temporaries of an interrupted write are removed by pruning; kept drafts age out with the rest. The offer is a dialog of the editor (`recover`): Restore puts the draft in the buffer as one undoable, unsaved edit (the caret and scroll come back; the file is unchanged); Compare says where the draft differs; Discard retires that draft only; Esc keeps it under a name of its own so later edits cannot replace it. A draft whose base hash differs from the file now on disk says the file changed since.
- **Not provided:** encryption (a key store would be needed to mean anything; the directory is private instead), a hunk-by-hunk merge (#463), recovery of read-only viewer state, a guarantee after every filesystem failure. A window killed within 1.5 s of the last keystroke loses those keystrokes.
- **Verified by** `tests/draftRecovery.test.ts` (store permissions, symlinked directory, liveness, corruption, bounds, keeper debounce/flush/retire, dialog choices), `tests/draftRecoveryApp.test.ts` (the real app: offer, restore, checked save, discard, window end, and a real `SIGKILL` of a process with unsaved text).

## Not provided

No split view, so no automatic refresh while typing; the preview refreshes on request. There is no "open in an external browser" action.

## Verified by

`tests/documentWorkspace.test.ts` (modes, keys, ownership of `h e r`, undo history across switches, unsaved preview, dialogs, per-mode scroll), `tests/documentWorkspaceApp.test.ts` (real files: atomic save with BOM and CRLF, conflicts, reload, read-only fallbacks, images of the unsaved buffer), `tests/documentPreview.test.ts` (the Chromium view against a fake engine: serving, refresh, trust, find, mouse, links, ordering of trust and refresh), `tests/browserApp.test.ts` (fallbacks) and `tests/browserEngineChrome.test.ts` against a real Chrome. Automated and headless: how it looks and feels in Ghostty or Zed is NOT RUN.
