# v0.16 physical QA checklist (pending)

Nothing in v0.16 has passed physical terminal QA. Cloud/CI runs (Ubuntu with
zsh 5.9, Fish 3.7, Bash 5.2) are automated validation only. Record host and
version, OS, font (Nerd or Safe), commit, result and failures. Supported is not
the same as physically validated.

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
