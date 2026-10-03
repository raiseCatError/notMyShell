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

Default sources: the shell's own (zsh configured completion with native
fallback; Fish `complete -C`; Bash completion), then optional declarative
specs.

### Upstream research

| Source | License (checked) | Decision |
|---|---|---|
| [withfig/autocomplete](https://github.com/withfig/autocomplete) | MIT | Not vendored. Specs are TypeScript modules with generators that run code; NMSh does not execute third-party spec code. |
| [inshellisense](https://github.com/microsoft/inshellisense) | MIT | Consumes Fig specs through a Node runtime per session; not adopted, since NMSh must not spawn a JS runtime per keystroke or show a second menu. |
| [amazon-q-developer-cli](https://github.com/aws/amazon-q-developer-cli) (Fig lineage) | MIT (dual-licensed file `LICENSE.MIT`) | Not adopted; a separate runtime owning its own UI. |

Instead NMSh ships the adapter boundary: `DeclarativeSpecSource` loads a
JSON subset of the Fig model (names, descriptions, subcommands, options) from
`<config>/completion-specs/*.json`. Specs are data only — unknown fields such
as generators are ignored, never run — bounded in size and count, loaded once
and answered from memory. No specs are bundled.
