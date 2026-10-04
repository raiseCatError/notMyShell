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

## Shell presentation and handoffs

- The welcome names the backend NMSh manages (zsh, fish, bash), never
  `$SHELL`; archived presentations keep the shell they were created with.
- `/shell` keeps the same live session and cwd, archives the old view (its
  last line is the transition; it is in `/resume`) and starts a fresh
  presentation with the new backend's welcome.
- `/shell` marks rows `[current]` (this session) and `[default]` (new
  sessions) in text, separate from the selection arrow.
- Current-shell prompt module (`shell`): When different (default) / Always /
  Never, from the session's backend; Settings → Sessions and Setup Cat →
  Shell share the row. Changing the default never switches this session.
- `/zsh` `/fish` `/bash` `/exit` detach a service session and `nmsh` in that
  ordinary shell returns to exactly it; see the ShellAdapter document.

## Ask

`/ask` opens "Ask NMSh — What can I help you with?"; `/ask <request>` opens
the same surface and submits the request at once. Ask is not an agent and has
no shell:

- **Deterministic first** (`src/ask/resolver.ts`): a typed capability
  registry (shell, sessions and transcripts, find/filter, files, editor, Git
  read-only, settings/theme/prompt/tools/screensaver/providers, provider
  status/switch, local understanding, help). Arguments resolve only to facts:
  files that exist (bounded project scan, `.git`, `node_modules`, build output
  skipped), real worktrees (`git worktree list --porcelain`), live sessions,
  archived transcripts (yesterday / this morning / last / this repo),
  installed shells, detected providers, recent file references.
- **Outcomes** are typed: proposal, answer, choose (ambiguous or missing
  argument), unsupported, unsafe, unclear. Uncertain is not unsupported:
  ambiguity shows 2–5 ranked interpretations plus "None of these"; low
  confidence asks for more with categories that exist here. Rejected
  interpretations are not offered again in the same Ask; a clarification
  refines the original request. Numbers, ordinals and words pick options;
  typing narrows a picker.
- **Safety classes**: answer and plain NMSh navigation run directly; opening
  a file, resuming, attaching, switching and settings are confirmed; read-only
  Git (`git status`, `git diff [--staged]`, `git log --oneline -n 20`, each
  optionally `-C <worktree>`) is NMSh-built argv, confirmed, then submitted as
  a normal visible command; shell installs use the existing `/shell` recipe
  and start on No. Destructive, privileged or arbitrary requests (rm, reset,
  clean, push, commit, chmod, sudo, kill, …) are understood and refused, with
  a safe read-only alternative where one exists.
- **Record Ask in transcript** (Settings → Ask, Setup Cat → Ask; default On):
  On keeps the visible conversation (request as the command line, then
  Ask/You turns) with the session; Off keeps it out of transcripts, journals,
  `/resume` and recall. An empty Ask closed at once records nothing. Approved
  actions always follow their own history rules. Nothing hidden (model
  prompts, raw output) is ever stored, and Ask text never enters shell history.

## Local understanding (optional)

Off by default: no model is downloaded, loaded or run, and no service starts.

- **Modes**: Off; Auto (the model is asked only when built-in understanding
  is unsure, loaded lazily, unloaded after a global idle period); Always
  (asked first for enabled features, kept warm while any window is open).
  Scopes are opt-in: Ask, Smart Folding.
- **One model for every window** (`src/understanding/ModelService.ts`): a
  user-global service on a private Unix socket in the 0700 runtime directory
  (`nmsh-model-v1.sock`). The first eligible request starts it; concurrent
  starters race safely (one binds, the rest connect). Every NMSh window is a
  client of the same runtime and model; requests are self-contained and the
  service keeps no conversation. Interactive Ask outranks folding; stale or
  excess folding work is dropped. With no clients it unloads and exits after
  a grace period; Off tells it to unload and exit.
- **Runtimes**: llama.cpp (`llama-server` on a private 127.0.0.1 port, small
  context, JSON-schema output, temperature 0), or an already-running Ollama or
  LM Studio, which NMSh reuses and never starts or stops.
- **Discovery** (`src/understanding/discovery.ts`) is local and bounded:
  known runtime executables, the local APIs of running runtimes, and known
  model directories (NMSh's own, llama.cpp cache, LM Studio, Hugging Face hub
  cache, GPT4All); GGUF metadata is read without loading. A compatible small
  model already present is offered before any download; a large one is never
  chosen silently; embedding/vision models are listed but not used.
- **Model contract**: the model returns strictly validated data (a
  capability id from the registry, confidence, short argument words). Unknown
  capabilities, extra fields and malformed output are rejected; arguments are
  re-resolved against facts, so a model cannot introduce a file, session,
  worktree or command. Model failure falls back to the deterministic result.
- **Smart Folding hints**: for borderline blocks only, a bounded, redacted
  excerpt (program word, head/tail lines) may yield an advisory class. Error
  signals always win; a hint never changes output and never overrides a block
  the user toggled.
- **Recommended model**: the official Qwen release only — Qwen3 0.6B
  `Qwen3-0.6B-Q8_0.gguf` from `Qwen/Qwen3-0.6B-GGUF` (Apache-2.0), pinned to
  revision `1eaf4d9657fe65ad10a51eab76a8db5b363bddaa`, 639,446,688 bytes,
  sha256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`
  (`assets/understanding/recommended-model.json`). Q8_0 keeps official
  provenance and less quantization loss at ~639 MB. It is offered only when
  no suitable model is already present, and only with explicit consent. The
  download streams to a temporary file, is checked for the exact size and
  sha256, and only then is renamed into NMSh's model directory; a mismatch is
  rejected, the incomplete file removed, nothing is loaded, and NMSh does not
  retry until the user chooses to. Only the official repository at a pinned
  40-hex revision is accepted: never `main`, mirrors, other publishers or
  third-party quantizations, and there is no fallback download. A compatible
  model the user already has (any reasonable quantization) can still be
  chosen. `scripts/local-model/pin-model.mjs` remains for deliberate future
  re-pins. Weights are never in the npm package.
- The welcome shows one factual row segment (`Local understanding Off`,
  `Auto · model idle · Ask`, or the loaded model's label); it is snapshotted,
  so archived welcomes never change. `/status` and `/providers` report mode,
  model, runtime, state, scopes and how many NMSh sessions share it.

## /providers

One overview of every provider family (Prompt, Welcome, Suggestions,
History, Picker, Directory navigation, Local understanding) plus a pointer to
`/shell`. It reads the one configuration and runtime detection: `[active]`
(after fallback) and `[preferred]` are text, and the selection arrow is
separate. Each provider shows Built in / Installed (version, path, installed
by NMSh or found on this system) / Not installed / Unavailable. Enter opens
the family's existing panel (switch, previewed install that starts on No,
re-detect and activate); R detects again; uninstall of what NMSh installed
stays in `/tools`. A fallback never rewrites the saved preference.

## Lavender Native tints

Lavender Native keeps its identity through the `#A67CF3` accent (and the
`#A67CF3` project/brand prompt block) in every combination. Two independent,
persisted appearance settings add optional tinting
(`uiChrome.lavenderText`, `uiChrome.lavenderSurface`; Settings → Appearance
under the theme, and Setup Cat → Appearance; shown only for Lavender Native):

| Setting | Off (default) | Lavender |
|---|---|---|
| Text tint | NMSh neutral text: primary `#F2F0EC`, secondary `#B0B8C2`, muted `#7D8590` | primary `#F1EBFF`, secondary `#D8CCF2`, muted `#A99BC6` |
| Background tint | neutral selection/focus surface `#586091` | dark plum `#352A47` |

Configurations without the fields normalize to Off/Off. Separator
(`#8B84B2`) and success/failure (`#74B59A` / `#CD737B`) are unchanged; Theme
text Off forces neutral text; other themes ignore both settings. History
muting, NO_COLOR, lower-color fallbacks and safe glyphs are unaffected.
Previews (Settings, Setup Cat) render the draft chrome and restore the live
one. The syntax-color cache fix (escapes keyed by the live chrome) stays.
