# Background tasks

Issue: [#382](https://github.com/raiseCatError/notMyShell/issues/382). A core terminal workflow feature: run
long-running commands (`adb logcat`, `tail -f`, `journalctl -f`, `docker logs -f`, dev servers, watchers, `ping`,
`scrcpy`) beside the normal shell instead of in front of it.

Status: **core modules and tests** (`src/backgroundTasks/`: detector, preferences, output, supervisor). The task bar
and `/background` manager are a stacked PR; wiring into the session service and the frontend is the integration step
described below. Nothing here changes the running app yet.

## Why a separate, supervised process

The real shell runs one foreground job at a time; NMSh's composer, queue (#357) and input awareness (#348) all depend
on that. Its job control (`&`, `bg`, `fg`) belongs to the person and stays untouched. A background task therefore
cannot be "the shell, but in the background". It is an **NMSh-owned process in its own pseudo-terminal**:

- a PTY, because programs behave as in a terminal (line buffering, colors, `scrcpy`/`adb` checking `isatty`), exactly
  like the foreground would show them;
- its own session and process group (the PTY makes the child a session leader), so a stop reaches the task's
  processes, including pipeline stages, and nothing else.

Alternatives rejected: sending `&` to the live shell (the shell's job then shares the foreground terminal, its output
interleaves with every command, and NMSh cannot stop it truthfully); pipes instead of a PTY (changes program
behavior); moving a running foreground command (impossible without changing its controlling terminal and session;
NMSh never does it, never kills and re-runs it).

### What a task inherits, and what it does not

The command text is passed **as one argument** to the session's own shell: `<shell> -c <command>`. NMSh never
re-quotes, concatenates or re-parses it, so quoting means exactly what it means in the shell (tested with mixed
quotes, `$` in single quotes and escaped double quotes).

A task runs in the live shell's reported working directory, with the session's launch environment plus the live
`PATH`. It does **not** see the live shell's aliases, functions, unexported variables, options, or variables exported
after the session started. The suggestion says so, and the detector never recognizes commands that obviously depend
on live state (expansions, substitutions). If a command needs that state, the person runs it in the foreground.

## Detection (`detector.ts`)

Conservative and explainable; nothing is executed or expanded, and classification of 2,000 realistic commands takes
well under 500 ms in tests (it runs only on submission, never per keystroke).

- A command is recognized only when its words say it keeps running: `adb logcat` (but not `adb logcat -d/-c/-t N`,
  `adb devices`), `tail -f/-F/--follow` (not plain `tail`), `journalctl -f`, `docker|podman|kubectl logs -f`,
  `kubectl get --watch`, `ping` without a count, `scrcpy` (not `--version`/`--list-*`), `tsc --watch`,
  `webpack serve|--watch`, `cargo watch`, `python -m http.server`, `php -S`, `rails server`, `flask run`,
  `hugo server`, `jekyll serve`, `ng serve`, `vite`, `next|nuxt|astro dev|start`, `nodemon`.
- Package scripts `dev`, `start`, `serve`, `watch`, `preview`, `storybook` are only **likely** (it depends on the
  project); `npm test` and builds are not recognized.
- adb's global `-d` (USB device) is told apart from logcat's `-d` (dump and exit).
- Only plain pipelines are classified (the first stage decides: `adb logcat | grep X`). Substitutions, expansions in
  double quotes, redirections, heredocs, lists, background jobs, subshells, multi-line input, `sudo`/`doas`/`ssh`,
  and full-screen or interactive programs (`top`, `less`, editors, `watch`, `tmux`, `fzf`, …) are never recognized.
- Families are specific (`adb logcat`, `npm run dev`), so a remembered decision never covers a whole program.

## Preferences (`preferences.ts`)

`background-tasks.json` in NMSh's config directory, written atomically with mode 0600. It stores families and
settings, never commands, arguments or output.

- Per family: **Always** (run in the background without asking), **Never** (do not ask), or unset (**Ask**).
- Suggestions on or off; remembered Always rules still apply when suggestions are off.
- No global "always background" mode. An invocation can always be forced to the foreground.
- Retention per task (lines and bytes, clamped to 100–100,000 lines and 64 KiB–32 MiB), finished tasks kept,
  notifications (never / on failure / always), bar collapsed or expanded, whether Up enters the bar.

`decide()` turns a classification and the preferences into foreground / suggest / background.

## Supervisor (`supervisor.ts`)

- `start` validates the command (non-empty, no NUL, bounded), an absolute shell and an existing directory, and a
  running-task limit (16 by default), then spawns the PTY. The environment is used for the spawn only; task records
  never carry it.
- States come from evidence: `running`; `stopping` after a stop request; `stopped` (it exited after a request),
  `exited` (status 0) or `failed` (non-zero or an unrequested signal) **only after the exit is observed**.
- **Stop** is SIGINT to the task's process group, what Ctrl+C does in a terminal. It is a signal, not the byte 0x03
  written to the task's input, which a program in raw mode reads as data. `nextEscalation` offers SIGTERM, then
  SIGKILL; each is an explicit request. NMSh's interactive shell, other tasks, and processes that left the group
  (an adb server started by `adb logcat` detaches with `setsid`) are never signalled (tested).
- After a stop request the task is the whole process group: a shell that does not `exec` its command (dash, Ubuntu's
  `/bin/sh`) dies of SIGINT while a program that ignores SIGINT keeps running, so the task stays `stopping`, and
  escalation still reaches the group, until the group is gone (found by Linux CI; reproduced on macOS in tests).
- When the leader exits on its own while members of its group still run (they ignored the hangup), the task says so
  (`leftovers`) and they are killed only on an explicit request.
- **Remove** deletes a finished task and its output; a running task is never removed. **Dismissing** a view is a
  presentation matter and touches no task. These are three different operations.
- `shutdown` ends every task (interrupt, terminate, kill, with a grace period) for an explicit session exit.
- Output notifications are coalesced to at most one per 50 ms per task; state changes are immediate.
- Signals are sent only while the task's leader has not been reaped, so a recycled pid cannot be hit; the leftover
  check is a signal-0 probe of the group.

## Output (`output.ts`)

PTY output is one stream (stdout and stderr merged exactly as a terminal shows them; separating them would need
pipes and change program behavior). Each completed line is sanitized with NMSh's `stripTerminalControls`: colors,
OSC titles and hyperlinks, cursor movement, C0/C1 controls and bidi overrides are removed, so a log line cannot
restyle NMSh, move its cursor or pose as another task. `\r\r\n` (a program's `\r\n` through a PTY) ends a line; a
lone `\r` overwrites it, so progress lines keep their last state. Lines are numbered (`seq`), so a view knows what is
new; the stream is bounded by lines and bytes, counts what it dropped and what it received, and splits endless lines.
An 8 MiB hostile burst stays within a 64 KiB bound in tests.

## Lifecycle and ownership (integration)

The supervisor belongs to the **session service** (`nmshd`), one per session, beside the session's shell PTY:

| Event | Behavior |
| --- | --- |
| Frontend closes or detaches | tasks keep running (they are the service's, like the shell) |
| Reattach | the frontend receives the task list and each task's bounded recent output; nothing is started again |
| Session exited or deleted explicitly | `shutdown`: interrupt, then terminate, then kill what remains; the result is reported |
| Service restart or crash | tasks of the previous service are **lost**: listed as such, never claimed as controlled, never restarted |
| Session restore from the journal | finished task records may be shown; nothing is re-run |

Journal: task records (id, command, family, cwd, times, state, exit status) may be journaled; output follows the
existing journal budget and privacy rules, and the environment is never stored.

### Service protocol (to add with the integration)

Client → service: `task-start {command, family?, cwd}` (the service supplies shell, environment and PATH),
`task-stop {taskId, level}`, `task-remove {taskId}`, `task-output {taskId, after: seq}`.
Service → client: `tasks {tasks}` on attach and on change, `task-output {taskId, lines, partial, dropped}`.
A service without the feature does not list `background-tasks` in `SERVICE_FEATURES`; the frontend then offers no
background execution and says why.

### Frontend contract (TerminalApp, after #359's checkpoint)

1. **Submission.** Before sending a submitted command to the shell, call `classifyCommand` and `decide`. `foreground`
   → unchanged path. `suggest` → show the suggestion strip (UI PR) and wait for the choice; Enter keeps the normal
   foreground path. `background` → `task-start`.
2. **Never while foreground input is owned.** No classification or task-bar key handling while a foreground command
   is running or waiting for input (#348), while passthrough owns the terminal, or for queued commands (#357's queue
   keeps its foreground semantics).
3. **Transcript.** Each task gets an NMSh-owned block (`Background: adb logcat · t3`) with its live output, folded and
   bounded; foreground command blocks never receive task output, and task output never enters the shell's PTY.
4. **Keys and the bar** are in the UI PR (`background-task-ui.md`).

Conflict-prone paths: `src/app/TerminalApp.ts`, `src/session/SessionService.ts`, `src/session/SessionProtocol.ts`,
`src/commands/slashCommands.ts`.

## Security review

| Concern | Handling |
| --- | --- |
| Command meaning | one argv element to the session's shell; no NMSh parsing or quoting |
| Automatic execution | only for a family the person set to Always; never from the heuristic alone |
| Environment and secrets | used for the spawn only; not on records, not in preferences; journals keep no environment |
| Signals | only to the task's own process group, only while its leader is unreaped; escalation explicit |
| Foreign processes | never signalled; detached helpers survive (tested) |
| Hostile output | sanitized per line; bounded; cannot reach the foreground PTY |
| Resource exhaustion | per-task line/byte bounds, running-task limit, coalesced notifications |
| Multiple NMSh instances | tasks belong to one session in one service; another frontend sees them only by attaching to that session |
| Restart/crash | unknown tasks are lost, not adopted |

## Tests

`tests/backgroundSupervisor.test.ts` (real PTYs and controlled programs): a logcat-like stream stopped by SIGINT and
reported only after exit; a program ignoring SIGINT stays `stopping` until an explicit SIGTERM, one ignoring both
until SIGKILL; a pipeline stopped as a whole while a detached adb-server-like helper and another task keep running;
leftover group members reported and killed only on request; exact quoting; exit status; environment never on records;
refusals; an 8 MiB hostile burst. `tests/backgroundDetector.test.ts`: recognition and refusal tables, timing,
decisions, preference normalization and private storage, output line handling.

## Physical QA (not performed)

- Real `adb logcat` with a device or emulator: stream, stop with `x`, confirm the adb server and other adb commands
  keep working.
- Real `scrcpy`: the window closes on stop; escalation if it does not.
- A dev server (`npm run dev`) on macOS and Linux; WSL2 where available.
- Detach the frontend while tasks run, reattach, confirm state and output.
