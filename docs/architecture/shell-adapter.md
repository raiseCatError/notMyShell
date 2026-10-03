# ShellAdapter: zsh, Fish and Bash backends

v0.16 turns the [v0.11 research](shell-adapter-v011-research.md) into a real
boundary. The rule then was "do not invent an abstraction before a second
backend proves it"; Fish and Bash are implemented in the same change, so the
interface below is derived from what three real shells needed.

```
ZshAdapter   FishAdapter   BashAdapter
      \           |           /
       ShellSession (PTY, markers, startup safety)
               |
   SessionService / InProcessSessionClient
               |
             NMSh: same composer, transcript, sessions, prompt UI,
                   Settings, Chroma, history presentation, completion UI
```

## Contract (`src/shell/adapters/ShellAdapter.ts`)

| Member | Purpose |
|---|---|
| `launch(context)` | Write private bootstrap files into a per-session directory and return argv + env. The user's own startup files load first. |
| marker grammar | Every adapter emits the same authenticated OSC 777 markers: `<status>;<cwd>` when a command finished (or the shell became ready) and `exec2;<0\|1>;<command>` before a command runs. `ShellProtocolDecoder` is shared. |
| `editorChrome` | `none` (zsh with ZLE off, Bash `--noediting`): everything after readiness is output. `prompt-to-exec` (Fish): bytes between readiness and exec are Fish's own line editor redrawing, and are dropped. |
| `scrubCommandStart`, `answerQueries` | Fish turns bracketed paste off as it hands the terminal to a command; that byte sequence is removed from the start of command output so it can never reach the host in passthrough. Fish 4 waits for a primary-device-attributes reply while idle; NMSh, being its terminal, answers minimally. |
| `capabilities` | What the backend can honestly provide: completion richness and descriptions, live names, history import, the shell's private-history rule, job counting. The frontend degrades on absent capabilities instead of faking them. |
| `builtins`, `historyFile`, `parseHistory`, `completionSource` | Shell-specific knowledge, kept inside the adapter. |

Shell-specific terminology never leaks into the generic layer: there is no
"ZLE", "precmd" or "PROMPT_COMMAND" outside its adapter.

## zsh

`ZshAdapter` carries the previous `ShellSession` bootstrap unchanged: a private
ZDOTDIR proxies `.zshenv`, `.zprofile` and `.zshrc`; ZLE stays off; prompts are
blanked every cycle; `precmd`/`preexec` are composed with the user's hooks.
The only behavioral addition is a `jobs N` line in the bounded name snapshot,
used to refuse a shell switch that would end background jobs. The temporary
directory keeps its historical `nmsh-zdotdir-` name. Regression coverage: the
existing zsh suites plus `tests/shellAdapters.test.ts` (bootstrap invariants
and a real lifecycle run).

## Fish

- Fish's facilities, not zsh emulation: the user's `config.fish` loads, then
  `--init-command` sources a private bootstrap.
- Readiness is reported once from `fish_prompt` (Fish calls it on every
  repaint); commands are reported from the `fish_preexec` and
  `fish_postexec` events. `fish_prompt`, `fish_right_prompt`,
  `fish_mode_prompt`, `fish_title` and the greeting are emptied because NMSh
  owns prompt and title.
- Fish's line editor cannot be turned off; its redraws are editor chrome
  (see `editorChrome`). A known consequence: messages Fish prints while idle
  at its prompt (for example "Job 1 has ended") are not shown.
- Completion: `fish -c 'complete -C -- $argv[1]' -- <line>` in an isolated
  process with the user's configuration; candidates carry Fish's descriptions.
  Fish never shows its own pager over NMSh, because NMSh never sends Tab to it.
- History import: `$XDG_DATA_HOME/fish/fish_history` (read-only). A leading
  space keeps a command out of Fish history and out of NMSh history.
- Names: functions, abbreviations (as aliases) and builtins.
- `$status` after starting a background job is whatever Fish reports.

## Bash

- Requires Bash 4.4 or newer (PS0). macOS `/bin/bash` 3.2 is detected and
  reported as too old; a newer Bash on PATH is used.
- `bash --noediting --rcfile <private> -i`: no Readline, so like zsh without
  ZLE NMSh owns the editor and nothing is echoed. The private rcfile loads
  `/etc/bash.bashrc`, `/etc/bashrc` and `~/.bashrc` (as Bash itself would
  without `--rcfile`).
- `PROMPT_COMMAND` (string or 5.1 array) is composed with the user's commands
  and re-asserted if a plugin reassigns it; `PS0` reports the command before
  it runs.
- Honest limits: when Bash does not record a line (ignorespace, ignoredups,
  HISTIGNORE, history off), PS0 cannot recover its text; the marker says "not
  recorded" and NMSh history follows Bash's decision. The submitted text is
  used for display and passthrough detection.
- Completion: the system bash-completion framework in an isolated helper,
  names only (Bash has no descriptions). Completions defined only in
  `~/.bashrc` are not seen; without bash-completion, commands and files are
  still completed.

## Classification

zsh keeps its isolated `whence` helper (`SemanticService`). Fish and Bash use
`PathClassifier`: the live session's name snapshot (functions, aliases,
abbreviations, builtins), the adapter's builtin list, then PATH. Nothing is
spawned or evaluated.

## Backend selection and in-place switching

- `shellBackend` (Settings → Sessions → Default shell, or `/shell` then D) is
  the backend for new sessions; default zsh. A missing default falls back to
  zsh with a notice and the setting is kept.
- `/shell` lists every backend with its executable and version, or why it is
  unavailable. Nothing is installed without an explicit, previewed confirmation
  (see Installing a missing shell).
- `/shell fish|bash|zsh` (or Enter in the picker) switches the **current
  session** in place: the session service removes the old shell's listeners,
  ends it, starts the new backend in the session's cwd with the session's
  original environment, and keeps the same session id, stream, backlog,
  journal and notices. Attach/reattach works after a switch (`attached`
  carries the backend).
- Kept: NMSh transcript, session identity, cwd, unsent composer draft,
  settings/theme/Chroma/layout, NMSh history and session metadata.
- Rebuilt: completion source, classification, shell history import, live
  names, lifecycle hooks, prompt suppression.
- Not carried over, and said so in the transcript: aliases, functions,
  variables and jobs of the old shell.
- Refused with a factual reason while a command or full-screen program runs,
  while the shell is still starting, or while background/stopped jobs exist.

Protocol: optional `shell` on `create`/`created`/`attached`/`SessionInfo`, and
`switch-shell` / `shell-switched`. Older services ignore `shell` (zsh);
frontends detect that and say so.

## Leaving NMSh: `/zsh`, `/fish`, `/bash`, `/exit`

Different from `/shell`: these hand the terminal to an ordinary interactive
shell started from the NMSh parent process (never nested in the managed
shell), in the current cwd, with NMSh's markers (`NMSH_ACTIVE`,
`NMSH_SESSION_MODE`) removed so `nmsh` can start again. `/exit` uses the
configured **default backend** (Settings → Default shell, or D in `/shell`) —
never `$SHELL` or the login shell; switching the current session does not
change it. One decision path refuses while a command or full-screen program
runs, while the shell is still starting, or while background or stopped jobs
exist. A missing target keeps NMSh open with the reason and an install
pointer; there is no silent fallback to another shell.

### Deliberate round trip

For a service-backed session these commands **detach** the session instead of
ending it; the managed shell keeps running under the session service. The
ordinary shell receives two private markers (only it and its descendants see
them):

- `NMSH_RETURN_SESSION` — the exact detached session.
- `NMSH_HANDOFF_SHELL` — which ordinary shell is waiting.

`nmsh` started there verifies that exact session is still live and detached
and attaches it directly, without the startup picker. `--new`, `--attach` and
`--preset` win over the marker. If the session ended (or is attached
elsewhere), NMSh says so and starts normally; it never substitutes another
detached session, and an "Always resume" policy asks instead for that launch.

Leaving again to the same shell, for the same session, returns to the waiting
ordinary shell instead of starting another one, so repeated round trips do
not grow a chain of nested shells. Leaving to a different shell (or after
switching to another session) starts a new ordinary shell as before.

In in-process mode nothing can keep the session alive, so leaving ends it as
before and no return marker is set. Running plain `zsh`, `fish` or `bash`
inside NMSh starts a normal nested shell; `nmsh` there is refused and says to
run `exit` to return.

## Installing a missing shell

`/shell` → select a missing shell → Enter or I shows a preview (`brew install
fish`) that starts on No and states that it does not change the login shell,
run `chsh`, modify startup files or use sudo. Only Homebrew formulas run as
argv; without Homebrew NMSh gives guidance instead of guessing package names.
After an install, availability is refreshed and the shell can be switched to
immediately.

## Service compatibility

The session service's welcome advertises optional `features`
(`shell-switch`, `shell-backends`, `notices`) and its build. An older service
from an earlier build (same protocol version, still running its live sessions)
advertises none, so the frontend knows at connect time: it shows a launch
notice, `/status` reports "Shell switching: unavailable (older service)", and
`switch-shell` is never sent to it. Its sessions are never killed to upgrade;
when they end and it exits, the next launch starts the current service.

## Not implemented

- **Nushell**: later; structurally different. First goal would be terminal
  output compatibility; any structured-data UI much later.
- **PowerShell / native Windows**: later, likely ConPTY with PowerShell or Nu;
  zsh is never forced onto Windows. See [platforms](platforms.md).
