# v0.16: shell UX, transcript selection, Ask and local understanding

## Transcript selection and the wheel

Physical QA: while Shift+drag selecting, the wheel could not move through
NMSh's transcript.

What actually happens: Shift+mouse is reserved by terminals for their own
selection, so the host does not report it to NMSh (NMSh also ignores any
Shift+button report). Most hosts do not report Shift+wheel either; when one
does (SGR button 68/69), NMSh already scrolls. The deeper limit is that a
native selection lives in the host's screen grid, while NMSh repaints its
virtual transcript into that grid when it scrolls, so a native selection
cannot extend past the visible rows. No decoder fix changes that.

NMSh therefore owns a transcript selection (`src/output/TranscriptSelection.ts`):

- A plain drag over the transcript selects. Rows are wrapped-transcript
  indices, so the wheel scrolls while the button is held and the selection
  follows the pointer into the newly visible rows.
- The selection is transcript content: wrapped rows of one logical line join
  without a break, lines join with newlines, padding is trimmed, synthetic
  rows (filter notices) are skipped.
- Release copies it (silently, like a terminal selection; only a failure is
  reported). The next key or click clears the highlight.
- A press-and-release without movement is an ordinary click: hover, fold
  toggles and block actions behave as before.
- Shift+drag is unchanged: the terminal's own selection, limited to what is
  on screen.
- Mouse mode 1002 (button-event motion) is enabled with 1000/1006 and
  released with them on passthrough and exit; full-screen programs keep
  their own mouse ownership.

Physical QA is still needed per host (Ghostty, Terminal.app, Kitty, Zed):
drag past the top with the wheel, release, paste.
