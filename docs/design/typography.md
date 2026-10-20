# Typography and text sizing

Components ask for a semantic role, never for escape sequences: `typeset({role, text, maxColumns, maxRows, level?, segments?})` in
`src/ui/typography.ts` returns a block with the cells it really occupies, its ordinary text form, and (only when allowed) a sized form.
Roles: `title`, `heading`, `subheading`, `body`, `caption`, `counter`, `celebration`.

## OSC 66

Kitty's text sizing protocol (https://sw.kovidgoyal.net/kitty/text-sizing-protocol/): `OSC 66 ; s=<1-7>:n=:d=:v=:h=:w= ; text ST`. It scales terminal cells (an `s` block is `s*w` cells wide and `s` rows high);
`n/d` only shrinks the glyph inside those cells. It is relative terminal scaling, not a font engine.

- **Detection** (`host/probe.ts`, the specification's method): on a scratch alternate screen, report the cursor, draw `w=2` and a space, report, draw `s=2` and a space, report. Equal positions mean unsupported;
  a step of two means width works; two more means scale works. Scale and width are separate facts. Bounded by the probe's 80 ms, replies consumed so they never reach the composer, and the alternate screen is left again.
- **Policy** (`ui/textSizing.ts`): scaling is used only when the setting is not Off, the probe proved `scale`, no multiplexer is in between, `TERM` is not `dumb` and `NMSH_TEXT_SIZING` is not `0`.
  Hosts known to parse the sequence without drawing scaled glyphs (Ghostty) stay off in Auto; **Enhanced** is the deliberate override there. Enhanced never forces an unproven terminal.
- **Safety:** only text of certain width is sized (printable ASCII, Latin, Greek, Cyrillic, general punctuation); wide characters, emoji, combining marks and anything unusual are drawn plain. The text is escape-safe (control characters refused) and under 4096 bytes.
- **Placement:** a multicell block is erased when any one of its cells is overwritten, so the renderer writes every row first and draws the blocks last (`TerminalRenderer.setTextBlocks`), and again whenever a row they cover repaints; a block that goes away forces its rows to repaint. Blocks that are not wholly visible are never drawn: the heading's ordinary text shows instead.
- **Never persisted:** sized text is a drawing concern. Transcripts, saved documents, copy and the clipboard hold the words only.

## The scale

| Level | Role | Size (when proven) | Otherwise |
|---|---|---|---|
| H1 | title | 3× (60+ columns), 2× (36+) | bold accent |
| H2 | heading | 2× (36+) | bold primary |
| H3 | subheading | 1.5× in a 2×2 box (36+) | bold secondary |
| H4 | caption | ordinary size | italic secondary |
| H5, H6 | body | ordinary size | italic secondary |
| arcade counters | counter | 2× | bold |
| game over, new record | celebration | 3× / 2× | bold |

Markdown `#` headings and HTML `<h1>`–`<h6>` map onto this one scale. A heading keeps its inline styling piece by piece (bold, italic, code, links each get their own sequence at the same scale). Body text, code, tables and lists are never enlarged. Only top-level
headings are sized (a block cannot sit behind a list marker or quote bar). A heading takes one line: if it does not fit at any size it is drawn as ordinary wrapped text. A search match in a heading shows the plain text so the highlight is visible.

## Settings

Settings → General → Text sizing: **Auto** (default), **Off**, **Enhanced**. `/doctor` says which state applies and why.

## Support status

Detection and placement are covered by automated tests with simulated terminal replies. No terminal has been physically verified.

| Terminal | Expected | Physical verification |
|---|---|---|
| Kitty (0.40+) | Scale and width | NOT RUN |
| Ghostty | Auto stays off (parses without scaled glyphs); Enhanced available | NOT RUN |
| Zed, Terminal.app, iTerm2, WezTerm, Alacritty | Not expected; the probe decides | NOT RUN |
