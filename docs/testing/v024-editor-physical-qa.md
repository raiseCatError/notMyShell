# v0.24 editor features — physical QA checklist

Automated tests cover the logic headlessly. Everything below is **NOT RUN** until a person does it in a real terminal; record the date, terminal, shell and result per line. Run in Ghostty and in Zed's terminal separately, with a throwaway folder and an isolated `XDG_CONFIG_HOME`.

## Crash recovery (#469)
- [ ] `/edit notes.md`, type, wait two seconds, kill the terminal window (not Esc). Reopen NMSh, `/edit notes.md`: the recovery choice shows; Restore brings the text back unsaved; the file is unchanged until Ctrl+S.
- [ ] The same with `kill -9` of the `nmsh` process; with Discard; with Keep for later (then type, quit normally, reopen: the kept draft is offered).
- [ ] Two terminals editing one file: neither is offered the other's draft while both run.
- [ ] A draft after the file changed on disk says so; Compare names the first differing line.
- [ ] `ls -l` of the recovery folder under NMSh's data directory: drwx------, files -rw-------.

## Markdown helpers and tables (#463)
- [ ] In a Markdown file: Enter continues bullets, numbers and tasks; Enter on an empty item ends the list; Tab / Shift+Tab move items (Shift+Tab is delivered by the terminal, and in Zed too).
- [ ] F1 opens the Markdown actions (F1 is not taken by the terminal or Zed). Task, renumber, link, image, bold/italic/code/strike, each undone by one Ctrl+Z.
- [ ] In a table: Tab / Shift+Tab walk cells; F1 offers row, column and alignment actions; the status line names the cell. Tab in ordinary text still inserts a tab.
- [ ] At 30, 50, 80 and 120 columns the menu and the footer fit; with NO_COLOR=1 and Safe Glyphs they stay legible.

## Snippets (#468)
- [ ] In an `.html` file F1 opens the palette; type `section`, Enter; Tab / Shift+Tab walk the placeholders; Esc ends them; Tab outside is a tab. In a `.md` file F1 then `/`.
- [ ] Select text and insert a wrapping snippet (section, code block): the text is wrapped, its line breaks untouched. Ctrl+Z removes the whole insertion.
- [ ] Mermaid and math entries say they are source text; nothing in the preview claims to render them.
- [ ] The palette rows and footer fit 30, 50, 80 and 120 columns; NO_COLOR and Safe Glyphs stay legible.

## Details (#462)
- [ ] A Markdown file with GitHub-style `<details>`: closed shows `▸ Summary`; `z` opens it; `Z`; in the preview, the split's preview pane and the hybrid view; narrow widths; Safe Glyphs (`>`/`v`); a hostile file.
- [ ] NOT RUN: A Markdown file with `$E=mc^2$`, `$\frac{a}{b}$`, a multi-line `$$ … $$` with `\sum`, `\int` and a matrix, and an unsupported command: inline and display rendering in the viewer, preview, split and hybrid; the unsupported one shows its source and the reason; Safe Glyphs; narrow widths; no glyph drift in Ghostty and Zed.
## Problems (#466)
- [ ] F1 then `e` in a Markdown file with a broken link, a missing image and a bad `#fragment`: the list shows them; Enter selects the exact text; Back returns. `P` in the read-only views and in the split's preview pane.
- [ ] An HTML file (palette → Problems) and a CSS file (F1); the status row counts; fixing a finding removes it after a moment; undo brings it back.
- [ ] A symlink out of the project and `/etc/passwd`-style paths are reported as not checked; an external URL is never fetched (watch the network).
- [ ] 30, 50, 80 and 120 columns; NO_COLOR; Safe Glyphs (E/W/i/?).

## Hybrid view (#460)
- [ ] Open a Markdown file, F3 (is F3 delivered by the terminal and by Zed?): headings, bold, links, lists, tables, quotes and fences render; the block under the caret shows its source; moving with the arrows swaps blocks without the screen jumping.
- [ ] Type in every kind of block; select across blocks with Shift+Down (both show source); undo/redo; insert a snippet and Tab through it.
- [ ] Resize the window while editing; NO_COLOR; Safe Glyphs; 30, 50, 80 and 120 columns; a large file.
- [ ] F2 with F3: the split with a hybrid text pane; Esc, Ctrl+O, Save, recovery after a kill, hunk review.

## Split view (#461)
- [ ] F2 is delivered by the terminal and by Zed's terminal (otherwise use `s` from the read-only view). The split shows the text and the rendered document side by side; typing updates the preview; the preview follows the caret; `l` unlinks.
- [ ] Ctrl+O switches panes; letters typed in the preview pane never change the text; `x`, `<`, `>` behave; below 100 columns one pane at a time; widen the window and the split returns.
- [ ] Esc keeps unsaved text; Ctrl+S saves (or asks for a name in a Playground); resize while typing does not corrupt the screen.
- [ ] 30, 50, 80, 100 and 120+ columns; NO_COLOR; Safe Glyphs (divider is `|`).

## Heading navigation (#462)
- [ ] In a long Markdown file `#` opens the heading prompt (is `#` delivered by your terminal and Zed?); type, Up/Down, Enter jumps in both the source and the rendered view; Backspace returns.
- [ ] `/view README.md#some-heading` opens at the heading. In `/edit`, F1 then `h` lists headings with indentation; `j` returns after editing above the starting point.
- [ ] 30, 50, 80 and 120 columns; NO_COLOR and Safe Glyphs.

## Playground (#468)
- [ ] `/playground` offers Markdown and HTML (no Recover entry on a clean machine); `/playground md` opens at once. Type, Ctrl+O previews with NMSh's renderer; Esc / `e` / `h` as in the workspace. No browser window or process appears.
- [ ] Ctrl+S asks for a name; an existing name is refused; a new one creates the file and the title changes. Closing with unsaved text asks.
- [ ] Kill the terminal with unsaved Playground text; start NMSh; `/playground recover` offers it; Restore, Compare, Discard and Keep each behave.
- [ ] An HTML Playground containing `<script>` runs nothing; no network traffic is generated by the preview.
- [ ] The chooser and the name prompt fit 30, 50, 80 and 120 columns.

## Reviewing external changes (#463)
- [ ] Edit a file, change it from another terminal (`printf`, an editor save, `git checkout`, an atomic `mv`), press Ctrl+S: Review changes appears. Disk-only hunks default to the file's version; a shared line is a conflict.
- [ ] Choose per hunk, preview with `r`, undo a choice with `z`, apply with Enter, undo the whole merge with Ctrl+Z, save, and check the file with `cat -A` (line endings kept).
- [ ] Change the file again while the review is open, then Enter: the review restarts. Delete it: the review ends and says so.
- [ ] Keys never reach the shell while the review is open; after it closes the composer is as it was.

## Mermaid diagrams (#462)
- [ ] With `npm install -g mermaid` and Chrome installed: open a Markdown file with flowchart, sequence, class and state fences; Preview shows `(diagram not drawn: not drawn yet: press D …)`; `D` draws them (Ghostty: pixels through Kitty placeholders; Zed: character art). No Chromium process exists before `D` (`pgrep -fl "Google Chrome.*nmsh"`).
- [ ] `i` on a diagram opens the image viewer; `+`/`-` zoom, arrows pan, Esc returns to the same place.
- [ ] Hybrid (F3): move into a diagram fence (exact source, editable), type, move out: the edited diagram appears after a moment; undo/redo. Split (F2): type in the fence; the preview pane updates after you pause.
- [ ] Settings → General → Mermaid diagrams: Automatic draws without `D`; Off shows the fences as code with the reason. Theme change redraws in the new colours.
- [ ] Without Mermaid installed, with Real browser Off, and with Images Off: the fence is shown as written with the matching reason; nothing hangs.
- [ ] A syntax error shows Mermaid's message; a very large diagram is refused with the limit; closing the document leaves no Chromium page (the browser stops about a minute later).
- [ ] 30, 50, 80 and 120 columns; NO_COLOR (grey diagrams, ASCII character art where no graphics protocol); Safe Glyphs.
