# v0.16: session notices, session viewer, agent activity, history and completion

## Session notices

- Owned by the session service, the one process that sees every session's
  lifecycle (`src/session/SessionNotices.ts`). Each live session holds at most
  its latest notice: a newer transition replaces an older one.
- Kinds: completed, failed (exit ≠ 0; Ctrl+C/130 is not news), attention (the
  program rang the bell or sent an OSC 9 / OSC 777 notification while running),
  long-running (one per run, after 15 minutes, computed lazily when listed),
  ended (the shell exited with no window attached; kept up to an hour, at most
  eight).
- Facts only: program word, known agent identity, exit code, duration, cwd.
  No arguments, prompts, responses or output.
- Focusing a session — attaching to it or typing into it — clears its notice
  in the service, so it disappears from every attached frontend on their next
  refresh. `/notices clear` dismisses the visible ones everywhere.
- Frontends poll the existing `list` request every 4 seconds while NMSh owns
  the screen (no polling during passthrough). At most three rows directly
  above the composer, newest first, never this window's own session; a
  fourth or later becomes "… N more session updates". Not transcript, not
  journaled, not copied. Hidden on screens shorter than 12 + N rows.
- Setting: Session notices, default On (`/notices on|off`).
- "Background command finished" for `&` jobs is not reported: no shell gives a
  factual per-job completion event NMSh can observe without polling.

## `/resume` as the session viewer

Live rows lead with a state word from service evidence (Needs attention,
Active, Running, Completed, Failed, Idle), the agent's mark and short name only
when the program identity proves it (Safe glyph and NO_COLOR fall back to
plain text), then cwd, the command and its duration, attached/detached and
age. Archived rows show "Archived", project, cwd, command count and how long
the session ran. No second session browser was added.

## `/sessions`

The live-session view: the same browser as `/resume` in a live-only mode
(no archives), including this window's session, ordered by start time so `#N`
matches session notices. Rows show this/`#N`, backend (zsh/Fish/Bash), state,
a proven agent, cwd, what runs and for how long, attachment and age, and a
pending notice. Enter on this window's session does nothing; on a session
attached in another window it refuses (never taken over); on a detached one
it attaches through the existing safe path (which clears its notice in the
service). Ctrl+K kills a detached session with the existing confirmation.
`nmsh --sessions` prints the same facts non-interactively. In in-process mode
there is no service, and `/sessions` says so.

## Agent activity

- Detection (`src/agents/agents.ts`): the program word of the command line
  after leading `VAR=value` assignments and a bounded set of transparent
  wrappers (`command`, `exec`, `nohup`, `time`, `builtin`, `noglob`, `nice`),
  or a package runner (`npx`, `bunx`, `pnpx`, `pnpm dlx`, `npm exec`) followed
  by `@anthropic-ai/claude-code` or `@openai/codex`; or the PTY's foreground
  process name. `echo claude` and `git commit -m codex` are not agents.
  Other agents (Aider, Gemini CLI, …) keep their existing labels in
  `/resume`; adding one to stats is a table entry.
- Completion wording: "Worked with Claude for 18m 42s", "Codex exited 1 after
  7m 11s", "Stopped Codex after 5.0s".
- Stats (`agent-activity.json` in the NMSh config directory, schema v1):
  per agent total duration, run count, per-day duration (≤ 400 days) and the
  last 50 runs (start, duration, exit code), plus dedupe keys so a replayed
  completion is counted once. Never stored: command line, arguments, cwd,
  prompts, responses, output, environment.
- A file from a newer NMSh is shown as empty and never overwritten; an
  unreadable file is kept with a `.corrupt-<time>` suffix.
- `/agents` shows totals, recent runs and a contribution-style heatmap built
  from Unicode density glyphs (`· ░ ▒ ▓ █`), so it reads without color. No
  dependency: the grid is ~40 lines; existing terminal chart packages would
  add far more than they save.
- `/agents off` stops recording (data kept), `/agents reset` deletes it.

## NMSh Native history

- Journal entries now record the agent identity (from the program word).
- `/history` (Native) ranks deterministically: same directory (1.2), same
  project (0.5), same session (0.6), recency with a 7-day half-life (1.0),
  frequency (0.8), prefix match (1.5), minus failure rate (0.6). Identical
  commands collapse into one row (×N), keeping the newest instance so delete
  still targets a real record. Ties keep the newest-first order.
- Filters: existing `cwd: project: exit: before: after: session: duration:`
  plus `agent:` and `source:` (`nmsh`, `zsh`, `fish`, `bash`, `atuin`).
- Bounded: ranking considers the newest 5000 matches; a 100k-entry history
  answers in well under the interactive budget (tested).
- No schema change: the index is derived in memory from journals and the
  shell's own history file, so no migration is needed. Privacy rules
  (leading space, HISTORY_IGNORE, the shell's own rules, deletions) apply
  before anything is indexed. Atuin remains an optional read-only provider;
  no sync.

## Completion knowledge sources

`src/shell/CompletionSources.ts` normalizes several sources into one menu:
per-source deadlines and failure isolation (a source that ignores its abort
signal still cannot hold the menu), validation (no control characters, valid
replacement ranges), dedupe on a stable identity (`start:end:value`), provenance
(every source that produced a row), lower-priority sources filling only missing
descriptions, and deterministic ranking (match tier, source priority, source
order). When only one source contributes, its order is kept exactly, so zsh's
grouped order is unchanged.

Default sources, in priority order: the shell's own (zsh configured
completion with native fallback; Fish `complete -C`; Bash completion), then
the user's custom declarative specs, then the bundled catalog. A custom spec
for a command replaces the bundled knowledge for that command entirely.

### Custom specs

`DeclarativeSpecSource` loads a JSON subset of the Fig model (names,
descriptions, subcommands, options) from `<config>/completion-specs/*.json`:
data only (generators are ignored, never run), at most 2048 files of at most
512 KiB each and 48 MiB in total, loaded once and answered from memory.

### Bundled catalog (`assets/completion/`)

Static command knowledge imported at build time by
`scripts/completion-catalog/build.mjs` from
[withfig/autocomplete](https://github.com/withfig/autocomplete) (primary) and
[carapace-bin](https://github.com/carapace-sh/carapace-bin) (secondary, static
cobra declarations only). Both are MIT; their notices are in `licenses/`.
Upstream TypeScript and Go are parsed as syntax only — nothing upstream is
executed. Generators, callbacks and other dynamic completions are dropped and
counted (so, for example, `kubectl get <resource>` names are not offered;
the shell may still offer them). inshellisense and Amazon Q consume the same
Fig specs and are not imported separately. Files with unclear licensing
(`expo.ts`, `expo-cli.ts`: third-party copyright without a grant) are
excluded.

- Pack: `catalog-index.json` (root name → entry key, entry key → offset and
  length) and `catalog.bin` (deflateRaw'd JSON per entry). A subcommand larger
  than 16 KiB is its own entry keyed by command path (`aws s3`), so a lookup
  inflates only the entries on the path being completed; a small LRU keeps
  recent ones. Not subject to the custom-spec limits.
- Supports subcommands, options (with persistent inheritance), static option
  and positional value choices with descriptions.
- `provenance.json`: upstream repositories, commits, licenses, per-file
  outcome (full, partial with dropped count, skipped with reason) and totals.
- Regenerate: `cd scripts/completion-catalog && npm install && node build.mjs
  --fig <checkout> --carapace <checkout>`. The importer's TypeScript
  dependency is local to that directory and not part of NMSh.
