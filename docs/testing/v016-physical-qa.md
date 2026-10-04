# v0.16 physical QA

## Status

- **Already physically validated (baseline):** the maintainer ran the v0.16 physical QA pass on the
  integrated build before the follow-up passes, and it passed. The checklists below from "Session
  notices and /resume" through "Linux / WSL 2" are that baseline and are not reopened.
- **Still required (new since that pass):** only behavior introduced or materially changed afterwards,
  listed in the last two sections: "Post-QA follow-up" and "Final pre-freeze pass".
- **Not covered by the maintainer's hosts:** Linux and WSL 2 on real machines (tracked in #18) and
  iTerm2, Kitty and WezTerm windows (#13). CI on Ubuntu and macOS is automated validation only.

Record host and version, OS, font (Nerd or Safe), commit, result and failures. Supported is not the
same as physically validated.

Hosts: integrated (Zed, VS Code) and standalone (Ghostty, macOS Terminal,
Superlogical where available) are equally first-class; Kitty, iTerm2 and
WezTerm are supported profiles.

## Session notices and /resume
- Two windows (service mode). In window B run `sleep 3; false`, switch to A:
  within ~4 s one line above the composer says Session N · sleep failed (exit 1).
- Run `printf '\a'` in a long command in B: A shows "asked for attention".
- Focus B (type in it, or `/resume` → attach): A's notice disappears.
- Four sessions finishing: three rows max, the third says "… N more".
- `/notices off` hides them; `/notices clear` dismisses for all windows.
- `/resume`: state words, agent mark only for real `claude`/`codex` runs,
  durations; Safe glyphs and `NO_COLOR=1` stay readable.

## Agent activity
- Run `claude` (or `codex`) briefly and exit: completion line reads
  "Worked with Claude for …". `/agents` shows totals, heatmap, recent runs.
- `/agents off`, run again: nothing recorded. `/agents reset`: data gone.

## History, completion, find/filter
- `/history make` in a repo ranks this directory's commands first.
- `/history agent:claude` lists only agent runs.
- `/find error`, then `/find disk`: only lines with both match; chrome shows
  both terms left with the count; `/find remove 1`, `/find clear`.
- Ctrl+F at the idle composer opens a new term (caret visible); Enter applies
  it, empty Enter/Shift+Enter step older/newer; Esc keeps applied terms.
  Ctrl+F inside `less`/`vim` still reaches the program; Cmd+F is the host's.
- Five find terms and four filter terms: exactly two chrome rows with
  `+3 more` / `+2 more`; narrow the window: summaries on one row.
- Type `/screensaver`, press Up: previous command. Down enters the menu,
  Up from its first row returns to history; Tab still completes.
- Inside Zed/VS Code without the CLI: `/open x.ts` names the editor and its
  install step; `/status` shows Integrated editor, Editor bridge unavailable.
- `npm test` then `/filter FAIL`, `/filter network` (AND), `/filter -v PASS`,
  `/filter -C 2 FAIL`, `/filter remove 2`, `/filter clear`; run another
  command: the filter stays on its block; `/copy` copies the full output.

## Shell backends (each host)
- `/shell`: lists zsh/Fish/Bash with versions or "not installed".
- `/shell fish`: same window, same cwd, draft kept, transcript line explains
  what did not carry over; `ls`, `vim` (passthrough), Ctrl+C, Ctrl+Z/fg,
  `cd`, a failing command, Tab completion with Fish descriptions.
- `/shell bash`: same checks; completion names only.
- With `sleep 60 &` running: `/shell zsh` refuses and says why.
- Detach and reattach after a switch (`nmsh --attach`): same backend.
- Settings → Default shell = Fish; a new session starts Fish.

## Editor bridge
- Zed integrated terminal: `/open src/app/TerminalApp.ts:418:12` opens Zed at
  that position; `/open-diff a.ts b.ts` opens Zed's diff (if `zed --help` lists
  `--diff`).
- VS Code integrated terminal: same with `code --goto` / `code --diff`.
- Ghostty with `EDITOR=nvim`: `/open x.ts:12` places `nvim +12 x.ts` in the
  composer; Enter runs it in passthrough.
- `/open` alone after a failing `tsc`: references listed, Enter opens.

## Images
- Kitty, Ghostty, WezTerm: `/about` shows the logo; closing removes it; running
  `vim` right after shows no leftover image.
- iTerm2: logo via inline image. Zed, VS Code, Terminal.app: text logo and a
  plain note.

## Portability and uninstall
- `nmsh config export --output x.json` on one machine, `nmsh config import
  x.json` on another: preview, No by default, apply.
- `/tools` → an NMSh-installed tool → X: provenance, starts on No.
- `nmsh uninstall --dry-run`, then a real uninstall in a disposable account.

## Linux / WSL 2
- Ubuntu/Fedora desktop terminal: install, sessions, notifications
  (`notify-send`), clipboard (`wl-copy`/`xclip`), all of the above.
- Windows Terminal → WSL 2 (Ubuntu): `nmsh doctor` says WSL 2; sessions,
  clipboard under WSLg, resize, passthrough. WSL 1: `nmsh doctor` says not
  supported.

## Post-QA follow-up (cursor, motion, paste, notices, Setup)

**New since the earlier pass; needs a fresh physical look.** Automated coverage is in
[v016-acceptance.md](v016-acceptance.md). Design:
[../design/v016-physical-qa-followup.md](../design/v016-physical-qa-followup.md).

### Ghostty (transparent / frosted window)
- Motion: `/appearance` → Motion. Each row's preview runs once on its own fixture,
  stops, and R replays; no dark or purple rectangle, panel height never jumps. Context
  transitions: only cwd and branch react, `Node 22` stays still. Subtle is subtle.
- Real motion: submit a command (launch tint, no black band), Tab-complete (only the
  inserted text is underlined and tinted), finish a command (Block Seal tint on the
  header), fail one (Semantic Echo on the rule).
- Cursor shapes: `/cursor` → Shape Block / Bar / Underline: the preview caret differs and
  the real caret changes at once, with no restart; Blink On/Off likewise.
- Portable effects: Motion Smear/Tail, Effect Fire/Sparks/Ripple/Lightning, Idle Glow:
  text under a trail is tinted, blank cells get shading glyphs, nothing paints a
  background box on the transparent window.
- Ghostty native: `/cursor` → Host native setup (confirm), then Renderer Host native:
  Idle effect shows `Unavailable` with the reason; Lightning is not offered. Auto shows
  `Lightning · Portable fallback`.
- Shader refresh: change Color or Speed: the line says the shader was updated; change
  Motion between Off and Smear: `Reload Ghostty config: ⌘⇧,` and the shortcut works.
- Color: Follow current theme tracks `/theme`; Choose theme (family → variant → Catppuccin
  accent) is independent of the prompt; Custom opens the picker, `#aa66ff` previews at
  once, an invalid value is refused.
- Setup: `/setup syntax` shows Colors, theme family, variant and accent with the real
  syntax preview; the Cursor step previews the selected row; `Advanced cursor tuning ›`
  opens /cursor inside Setup and Esc returns without saving.
- Paste: a very large paste (hundreds of lines): the compact strip stays small; `R` opens
  Review, scrolls (↑↓, PgUp/PgDn, Home/End), Enter inserts without running, Esc returns.
  A prose paragraph says `pasted · text` and never "command"; the four-line sample reads
  read-only / installs packages / runs project script / read-only.
- Session notices: a command finishing in another session shows for about 12 s and then
  disappears by itself; a failure for about 45 s; an agent asking for attention stays until
  you focus it.

### Kitty
- `/cursor` → Host native setup; Renderer Host native offers Tail only; Effect and Idle
  effect say `Unavailable` (`Kitty Native does not provide this effect.`). Color changes
  rewrite only `cursor_trail_color`; `Reload Kitty config: ⌃⌘,`.
- Motion previews and real motion: same transparent-background checks as above.

### Terminal.app
- Portable effects work; Renderer Host native says `Host native is not available in this
  terminal.` on every motion/effect/idle row and draws nothing. Shape/Blink apply if the
  terminal honors DECSCUSR, otherwise the preview still labels what NMSh sends.

### Everywhere
- Truecolor, forced 256-color (`NMSH_COLOR=256`), `NO_COLOR` (previews say so and paint
  nothing), Reduced Motion, Decorative Effects Off, Safe glyphs, a short terminal (15
  rows: Motion hub drops the intro then the preview; large Paste Review opens directly)
  and a narrow one (40 columns).

## Final pre-freeze pass

**New since the earlier pass; needs a fresh physical look.** The earlier v0.16 physical QA passed
(maintainer, before the follow-up work); only what changed afterwards is listed:

- **Motion rendering**: `/appearance` → Motion → Rendering Clean / Rich. The preview shows the
  difference at once; Rich is the stronger filled look, Clean keeps the window transparent. R replays.
  Advanced → Intensity / Speed visibly change the preview; switching Clean ↔ Rich keeps each one's values.
  Real effects (launch, Tab completion, Block Seal, failure echo, cwd/branch change) in both renderings.
- **Cursor effects**, each distinct in a real window: Smear vs Tail vs Smooth; Fire (flame glyphs climbing,
  warm colors), Sparks (sparse twinkles), Lightning (jagged slanted bolt, forks), Railgun (one straight
  beam), Ripple (an opening wave), Wireframe (a bracket); idle Glow / Embers / Flame / Sparks. Transparent
  window still shows no dark rectangle behind them.
- **Zed**: Cursor shape works; Cursor color does not recolor the physical caret and the Cursor color row,
  `/cursor` and Setup say so; the color still tints NMSh's effects and previews.
- **Config**: grouped headings, scrolling keeps the selected row and its heading, search shows only matching
  groups, `A` shows advanced rows inside their groups; narrow and short windows.
- **Status**: named sections, scrolling, tones (warning/success/muted) intact.
