# Session & Interaction UX

**Milestone:** v0.3.0 — Session & Interaction UX

## Goal

Improve routine interaction with NMSh through a safe return to ordinary zsh, configurable context presentation, manageable large text pastes, persistent local transcripts, and first-run setup. NMSh remains a frontend over one persistent real shell.

## Safe shell transition

`/zsh` exits the NMSh frontend and hands the same terminal window to a real interactive zsh. It preserves cwd when practical, while making no promise to preserve shell-local state, jobs, or the hidden managed shell's runtime. Terminal modes owned by NMSh must be restored before handoff. An active foreground command must finish or be interrupted before transition. A managed-shell marker prevents recursive NMSh startup; it must not leak into the ordinary zsh handed to the user.

## Prompt providers and composer layout

NMSh has two independent prompt-provider choices: built-in NMSh Native (the default) and optional Starship. The provider supplies prompt/context content and semantic styled segments. NMSh owns the editor, composer boundaries, multiline input, history, execution behavior, and where provider content appears. `composerLayout` is independently `twoLine` (default) or `oneLine`, and works with either provider.

NMSh Native uses the ordered context modules (project, cwd, git branch, and previous exit status) with an eight-step lavender ramp. Shades are selected by currently visible module order and cycle after eight. The first block is brightest; later blocks darken while staying lavender. Its independent appearance settings are `gapEnabled` (default `true`) and `endStyle` (`fadeWedge` by default, plus `wedge`, `fadeFlat`, and `flat`). Existing `gap` remains the number of neutral cells when enabled; `spacing` remains internal body padding. Explicit per-module colors still override the native ramp.

Each Powerline block has a leading edge, body, and trailing edge. The leading edge belongs to the block on its right; the trailing edge belongs to the block on its left. Nerd Font mode pairs U+E0D6 (``) as the opening edge with U+E0B0 (``) as the closing edge. Each edge is painted over terminal-neutral background, with reset/background state cleared before the following body. Safe glyph mode uses ASCII `<` and `>` edges. This follows the explicit leading/trailing segment model used by Oh My Posh rather than treating U+E0B2 (``) as a reverse cap. `fadeFlat` clears the final block background before its `▓▒░` density fade; `fadeWedge` uses the closing wedge followed by a short `▒░` taper. A two-line composer then draws one solid divider. One-line mode omits the extra tail and divider so editable input keeps its width.

The JSON config remains in `~/Library/Application Support/notMyShell/config.json` on macOS (or `$XDG_CONFIG_HOME/nmsh/config.json` when set). Legacy top-level module, placement, spacing, gap, and composer fields remain accepted. The provider configuration is:

```json
{
  "provider": "nmsh",
  "onboardingComplete": false,
  "nmsh": {
    "gapEnabled": true,
    "endStyle": "fadeWedge",
    "palette": "lavender"
  },
  "starship": {
    "configPath": null
  },
  "placement": "header",
  "composerLayout": "twoLine",
  "separator": "",
  "gap": 1,
  "spacing": 1,
  "modules": [
    { "id": "project", "visible": true, "condition": "always" },
    { "id": "cwd", "visible": true, "condition": "always" },
    { "id": "gitBranch", "visible": true, "condition": "inRepository" },
    { "id": "exitStatus", "visible": true, "condition": "nonzeroExit" }
  ]
}
```

Older valid configs normalize to NMSh Native, two-line layout, gap enabled, and `fadeWedge`. Invalid provider, end-style, and layout values fall back safely. Settings are written only after onboarding or `/prompt` is completed; Starship's own config is never rewritten by provider switching.

Starship rendering uses the installed `starship prompt` binary in the current cwd with the command status. Output is parsed into text and ANSI-derived foreground/background spans before display or transcript storage. Prompt output is cached between meaningful shell prompt/context refreshes and is not invoked on shimmer render ticks. Newlines are flattened into one provider row so NMSh retains its two-line or one-line composer structure. Provider errors fall back to NMSh and update NMSh configuration to avoid claiming a broken provider. Starship may still emit theme-specific glyphs that depend on the user's font; NMSh does not promise to reproduce arbitrary shell initialization hooks or every multiline/right-prompt feature.

Starship detection respects `STARSHIP_CONFIG`, otherwise the documented `~/.config/starship.toml` default. A missing config uses Starship defaults. Presets use Starship's supported `starship preset <name> -o <path>` command; choose a new path to preserve any existing file. On macOS, NMSh offers `brew install starship` behind a confirmation screen. It does not edit `.zshrc` or run curl-based installers. Starship has no separate official interactive onboarding command, so NMSh presents this small provider setup flow.

## Rich text paste

Large multiline text-only pastes appear as one editable logical atom, labeled in current editor order (for example, `[Text #1 · 7 lines]`). Small pastes remain ordinary text. Cursor movement and adjacent deletion treat an atom as one unit; Ctrl+O optionally unwraps the atom beside the caret back into editable source. Enter submits the exact underlying source of every atom in place, together with typed prefix, interstitial, and suffix text; visual labels are presentation-only and never reach zsh. Bracketed paste and multiline submission remain supported. Image clipboard behavior is out of scope.

## Local transcript sessions

`/clear` archives the current NMSh transcript locally, clears its visible presentation, and starts a new presentation session while retaining the same live zsh. It does not normally reset cwd/environment, kill zsh or jobs, or delete the archived transcript. While a foreground command is running, `/clear` is refused so its transcript is not detached from active execution. `/resume` offers a keyboard-friendly archive picker and restores transcript history without rewinding real shell state; if the current presentation is non-empty, NMSh archives it before switching views. Archives live under `~/Library/Application Support/notMyShell/sessions/` on macOS (or `$XDG_CONFIG_HOME/nmsh/sessions/` when set), use schema version 1 JSON, and are written with mode `0600` in a mode `0700` directory to a synced temporary file before atomic rename and directory sync. They retain structured command/raw-text records and styled terminal cells, not ANSI-only output. Corrupt and unsupported-version archives are left untouched and omitted from the picker. Data is local-only, with no cloud, telemetry, model API, AI summary, or automatic destructive pruning. A temporary file left by a crash is ignored; the final archive is either present after atomic rename or absent.

Both `/clear` and `/resume` wait until the foreground command has finished or been interrupted; neither is sent as input to a running command.

## Historical command context

Each submitted command freezes a semantic prompt snapshot: provider identity, layout, text spans, foreground/background colors, Native geometry/end style when applicable, cwd, and branch metadata. Historical headers are rendered from that captured snapshot, not today's provider or theme. Their generic OKLab archive transform reduces chroma/lightness while preserving each segment's pigment; colored Starship greens/oranges/cyans stay those hues rather than becoming lavender. No raw ANSI string is the stored representation. The header is presentation metadata, not PTY output, and is excluded from `/copy`. Optional prompt snapshots persist in transcript schema version 1; older records without them remain readable through their older cwd/branch snapshot behavior.

Each fresh presentation begins at the top of the output viewport with a compact welcome snapshot containing the compiled build identity, frozen start cwd, and zsh label. A seven-row, two-color block cat has ears, square eyes, paws, and a side tail; narrow widths omit the cat while keeping metadata in bounds. One muted lavender divider follows. Welcome and commands remain contiguous transcript rows: empty viewport space follows the short transcript and fills as commands are added; there is no reserved spacer or sticky header. `/clear` archives the old presentation and creates a new welcome at the current cwd without resetting zsh. `/resume` restores the archived snapshot if present and never injects another welcome. Welcome chrome is excluded from PTY output and `/copy`; it is separate from onboarding.

## Nested execution activities

The persistent shell PTY currently reports aggregate output and root command boundaries; it does not expose a reliable generic child-process tree or per-child PTY output attribution. NMSh therefore reports a narrow deterministic subset: a complete Node TAP v13 stream observed in actual PTY output. It does not infer `npm`, shell, compiler, or other subprocesses from the submitted command or customary tool behavior. Incomplete TAP streams keep their output in the parent transcript but do not create a persisted child range. Arbitrary child processes and individual nested TAP subtests are not currently exposed as separate activities.

For manual shimmer and folding checks after rebuilding, run `node --test scripts/slow-tap-fixture.mjs` inside NMSh. The fixture emits a real delayed Node TAP stream so the secondary row remains active long enough to inspect, then completes and folds its retained details.

An observed activity stores semantic identity/kind, label, start/completion time, status, expansion state, and a range into the parent's retained parsed output lines. The parent remains the source of truth for raw PTY presentation data; activity chrome and labels are not copied to `/copy`. The optional activity field is backward-compatible with transcript schema version 1. No ANSI presentation strings are stored for the activity itself.

While a parent is running, its activity timeline is rendered at the end of the active history viewport so chronological child status remains visible; observed child output is indented beneath its activity row. The existing primary activity and blank breathing row above the composer are unchanged. A running TAP activity shows its observed raw stream. When the protocol summary closes, its output folds by default and the completed activity is static and muted; its inline disclosure can reveal the retained lines. After the parent completes, activity rows render inside the parent's expandable output details and are hidden when the parent is collapsed. No process-tree polling, guessed output attribution, AI, model, or cloud service is used.

## Onboarding

First-run onboarding asks for NMSh Native or Starship (NMSh is preselected), then the independent two-line/one-line composer choice. NMSh Native also asks whether segment gaps are on and which end style to use, with a live preview from the real renderer. Starship setup reports binary version and config path, supports existing/default configuration and truthful preset guidance, and offers an explicit Homebrew install confirmation on macOS when available. Both provider paths ask for composer layout. Escape can skip; completion and choices persist in the existing prompt config. `/prompt` reopens the same settings flow. Switching providers retains inactive provider settings and never edits Starship config or the user's ordinary `.zshrc`.

## Dependencies and non-goals

- Onboarding configures only prompt provider, composer layout, and NMSh gap/end appearance in this v0.3 pass.
- Composer layout uses the same `composerLayout` preference and is independent of provider choice.
- Composer layout changes only input presentation and does not change the primary live activity row or its existing breathing-space row. It is independent of the nested activity architecture in #47.
- Nested activity reporting is limited to completed, directly observed Node TAP v13 streams until the shell/PTy architecture provides stronger per-child boundaries and output attribution.
- Rich paste and transcript persistence are otherwise independent interaction features.
- TerminalHost architecture (#10–#13), platform support, ShellAdapter research, broad compatibility/polish (#20), and unrelated future work are outside this milestone unless a narrow implementation dependency proves necessary.
- No shell-state time travel, chat-composer behavior, image paste, or replacement of NMSh presentation with Starship/Powerlevel10k.
