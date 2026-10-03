# Cursor, prompt glyphs, status strip and small displays

## Cursor (text caret)

Settings → Cursor (or `/cursor`, which opens the same rows): Host default, Block, Bar, Underline; nested Blink: Host
default, On, Off (shown only with a chosen shape). NMSh uses DECSCUSR
(`CSI n SP q`) and never touches the OS mouse pointer. Host default sends
nothing at all. Blink speed is the terminal's own; there is no portable control
for it.

Lifecycle: the style is written when NMSh enters its screen and after a
passthrough program returns; it is reset to the host default (`CSI 0 SP q`)
before a passthrough program (vim, less, ssh, …) gets the terminal and on
exit, `/zsh`, detach, suspend, error and signal paths (all go through the
renderer's leave/suspend paths). Terminals without DECSCUSR ignore the
sequence and keep their own cursor. Protocol behavior is covered by tests;
physical behavior in Zed, Ghostty, Terminal.app and Kitty is pending QA.

## Prompt separators and symbol

Only styles that draw a text separator get separator choices:

- Minimal: Space, Dot ·, Bullet •, Pipe │, Slash /, Chevron, Arrow →, Double
  chevron », Diamond ◆, ASCII -, Custom.
- Breadcrumb: Chevron, Arrow →, Slash, Dot ·, Double chevron », Triangle ▸,
  Custom.

- Outline (connected layout): a divider between outlined segments: Pipe │,
  Dashed ┆, Dot ·, Slash /, Custom.

Powerline, Soft, Compact and Ribbon keep their geometry choices (shapes,
caps, seams, slants); a free-form glyph would not read as their structure. Existing separator ids load
unchanged. A custom glyph is stored per style (`customSeparator`), so switching
styles keeps each style's glyph.

Prompt symbol: ❯, >, $, λ, →, ➜ or Custom. It changes only the composer's
marker; Starship and Powerlevel10k output is never modified.

Custom glyphs must be exactly one grapheme of one or two cells with no
control characters, escapes or newlines. Glyphs whose width varies by font are
accepted with a factual warning, and the /prompt preview renders through the
real renderer.

## Glyph mode

NMSh keeps its two modes: Nerd Font and Safe. Safe uses no private-use Nerd
Font glyphs; prompt separators and the prompt symbol fall back to ASCII in
Safe mode (a non-ASCII custom glyph falls back too). Some portable Unicode
(box rules, arrows in help text) may still appear elsewhere in Safe mode, so it
is "no Nerd Font required" rather than strict ASCII everywhere. A three-way
Nerd/Unicode/ASCII model was considered and deferred: it would rename a stored
setting for little visible benefit in this pass.

Semantic icons (clock, battery, CPU, memory, branch, search, …) each have a
Nerd, a portable Unicode and an ASCII form, and text always carries the
meaning: icons are used where they read faster than text (the status strip),
not everywhere.

## Status strip

Off by default. When enabled, Minimal shows the clock, plus the battery only
when the machine really has one (desktops never show a battery). Optional:
CPU, RAM (Percent, Absolute or Both; Percent by default) and uptime. Network
throughput and weather are not included: network rates are not cleanly
available locally on macOS without polling a subprocess, and weather is
networked.

The strip owns one right-aligned row at the top, part of the single screen
plan, so mouse hit-testing and cursor placement agree. It is not in the
transcript, `/copy` or the session journal, hides during passthrough and while
a panel owns the screen, and yields its row below 30 columns. Data comes from
local OS counters (`os`, `/proc`, `/sys`; `vm_stat` and `pmset` on macOS) on a
5-second timer that exists only while the strip is on and NMSh owns the
screen; battery is sampled at most once a minute.

## Display too small

Complex panels declare a minimum size (Setup Cat 44×12, Theme Studio 56×18).
Below it a centered notice says what the view needs and the current size; it
disappears on the next frame once a resize makes the view viable. Very small
terminals get one line: "Display too small · resize terminal". The ordinary
shell and composer keep degrading on their own and never show the notice.
