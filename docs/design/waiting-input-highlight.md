# Waiting-input highlight (proposal, 2026-10-16)

**Status: proposal; post-v0.20 feature branch after the stabilization gates.** A presentation change only: it reads
`InputWatch`'s existing `InputRequest` and changes no routing, timing or stored data.

## Today

While a command waits, the live activity region shows `◆ Waiting for input · program · 12s` (◇ / "Probably" when only
likely) and the question it left open, and the composer hint says where Enter goes. The look is deliberately static
(`src/status/inputStatus.ts`), so it reads differently from the shimmering "Running" line.

## Proposal

- **Which line:** only a request InputWatch reports (`confirmed`, or `likely` drawn one step quieter). The highlighted
  row is the program's open prompt line as already identified by InputWatch (`request.prompt`), matched to the last
  output row on screen; text alone (`Password:` in a log) never triggers it.
- **Look:** a subtle background from the theme's selection role behind that one row (the same role as a selected
  list row; foreground swapped to the palette's text role when contrast would fall under 4.5:1), and a thin accent
  gutter `▏` that continues from that row down to the composer's left edge, so the question and the composer read as
  one interaction. A small mode mark at the gutter: line `›` / `>`, key `⌨` / `[k]`, hidden `🔒` / `[*]` (Safe glyphs in
  the second form). Hidden input shows no characters and no count here.
- **Motion (no new system):** the existing Semantic Echo event `attention` (Motion → Event feedback, tone
  `attention`) runs **once** when the request opens, as Clean or Rich per the Rendering setting; then the highlight is
  static. Nothing loops, so it never resembles the Running/Cooking animation. Event feedback Off, Decorative effects
  Off, Reduced Motion or NO_COLOR: static highlight only (NO_COLOR: the gutter and mark carry it, inverse video for the
  row where available).
- **Ends at once** when the answer is sent (`answerSent`), the request clears, the command finishes or is
  interrupted/suspended, passthrough starts, or ownership changes; no fade that outlives the state.
- **Never touches data:** decoration is applied at frame composition over the rendered transcript row; records,
  copies, reports, archives and compare see the raw text.
- **Rendering cost:** a one-row overlay on the existing frame; the one-shot echo uses the existing presentation clock
  (no extra timer when it is off); resize, scroll and reattach recompute the row from the request, not from cached
  coordinates.

## Tests

Rendering (theme, light/dark, NO_COLOR, Safe glyphs, 16 colors, narrow widths, scrolled transcript); the echo runs once
and not under Reduced Motion / Effects Off; it ends on each terminating event; real-PTY: zsh/Bash/Fish `read`, hidden
and key reads with the highlight present, typing at 0/150/700 ms gets every key to the program exactly once (the
decoration never delays or intercepts input); `echo Password:` produces no highlight.
