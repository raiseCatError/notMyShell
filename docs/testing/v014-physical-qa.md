# v0.14 polish and customization: physical QA (pending)

Nothing below has passed physical QA. Automated PTY fixtures validate
protocols and rendering, not a physical terminal. Record host and version,
macOS version, font (Nerd or Safe), commit, actual result and any failure.

Host order: **Zed** (primary development and QA host), **Ghostty**
(enhanced), **Terminal.app** (baseline), **Kitty** (advanced).

## Zed

- Trackpad scrolls the transcript up and down; the mouse wheel does too.
- PageUp/PageDown page the transcript; Ctrl+End or `↓ Jump to bottom`
  returns to the latest output, and new output follows again.
- Shift+drag selects text with Zed's own selection (if Zed supports it while
  mouse reporting is on); plain drag does not.
- Scroll while a long block is folded, then expand it (Ctrl+O) and scroll
  again; the fold hint and rows stay correct.
- Run `vim -u NONE` or `less`: the application owns the mouse while it runs,
  and wheel scrolling returns to the transcript afterwards.
- `/appearance` says "Appearance is configured by Zed." With two live
  sessions, startup names `nmsh --attach <id>` instead of opening windows.
- Optional: `NMSH_HYPERLINKS=1 nmsh` and Cmd+click an OSC 8 link; record
  whether Zed opens it.

## Composer history (every host)

- Run `npm test`, `git status` and `clear` (or any three commands). At an empty
  composer, Up repeatedly recalls `clear`, then `git status`, then `npm test`;
  it stops at the oldest. Down walks forward, and Down past the newest
  restores the empty composer.
- Type `git di`, press Up, then Down: `git di` returns exactly.
- Type a multiline command (Ctrl+J). Up and Down move between its lines first
  and enter or leave history only at the first or last line.
- Recall a command, edit it, press Enter: the edited command runs once, and
  the original history entry is unchanged.
- With a completion menu open, Down moves within it; Up from its first
  candidate recalls history. Slash suggestions and panels keep Up/Down.
- Detach and reattach (`nmsh --attach <id>`), then repeat.
- Terminal.app: if "Scroll alternate screen" is on, record what the wheel does
  (expected: arrow keys, so it walks history).

## Prompt styles, themes and vibrance

- In `/prompt` → Main Prompt, cycle Style through Powerline, Soft, Minimal,
  Outline, Breadcrumb, Compact and Ribbon. Each shows only its own controls,
  and every control visibly changes the preview.
- Customize Soft, switch to Outline and customize it, then switch back: Soft
  is unchanged. Save, restart, and confirm it persisted.
- With an existing Powerline config: after upgrading, the prompt looks the
  same.
- Check every style in Nerd and Safe glyph modes, one- and two-line layouts,
  with a right-placed module, at narrow widths (about 30 and 50 columns).
  Confirm historical headers replay the submitted style.
- Browse all twelve themes in the gallery; none look like near duplicates.
  Soft/Standard/Vibrant are visibly different, and Vibrant separates adjacent
  modules.

## Chroma

- `/chroma` and `/prompt` → Chroma open the same view and settings.
- The palette gallery tells Off, Lavender, Aurora, Current Theme, Rainbow,
  Nebula, Black Hole, Warm, Cool, Monochrome and Custom apart at a glance.
  Aurora is not Lavender. Current Theme on Cool First stays cool and on Warm
  First stays warm; it is not pale purple-to-white.
- The Current row matches your real prompt; the Showcase row shows every
  module.
- Apply Chroma to Powerline and Soft: filled text stays readable. Minimal and
  Outline: text, separators and outlines are treated. A failing exit status
  and Rich Git states keep their colors.
- Motion: Travel, Breathe, Comet and Pulse at each speed and ramp, plus
  Reverse for Travel and Comet. With Reduced Motion or Effects Off the
  treatment holds still. With a static treatment CPU stays idle.
- Custom gradient: add, remove, edit hex (invalid input is refused), reorder,
  reset, and Esc back. The preview updates live, and nothing is saved until
  Enter in the panel.
- Off → Aurora → Off returns exactly the original prompt.
- 256-color (`NMSH_COLOR=256`), 16-color and `NO_COLOR=1` degrade coherently.

## Panels, providers and effects

- `/transcript` shows Output folding (Off/Smart/Always) with a preview. Saving
  it changes Config → Output folding (one shared value).
- `/tools`: Discover is grouped by category, with aligned status badges, a
  clear selection band and the selected tool's description. Check narrow
  widths.
- Provider galleries (Welcome, History, Picker, Navigation, Suggestions):
  highlight a missing provider with a recipe. Enter shows the exact `brew
  install …`, asks for confirmation, shows progress, then the provider is
  selected. A provider without a recipe gives a factual reason.
- Milestone effects: a successful confirmed install, `/update apply`, or
  finishing first-run tool setup shows brief confetti after the panel closes.
  Turning off Config → Milestone effects, Reduced Motion or Effects Off stops
  it. `/effects confetti` previews it manually.

## Completion

- Typing `g` lists ten candidates at most, with `↓ N more`. Aliases,
  functions, builtins and keywords have distinct icons and quiet type words;
  there is no `[command]` label.
- `_fzf_*`, `__atuin_*` and `_zoxide_*` helpers do not appear unless you type
  `_`.
- The highlighted candidate shows a muted description: zsh's own text, local
  knowledge, "Alias in the current zsh session" (never the alias body), or a
  man-page summary for executables.
- Frequently used commands rank above obscure equal matches.
