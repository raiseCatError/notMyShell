# ShellAdapter boundary: research after v0.11

Refs #17. zsh is the only supported shell. No Bash, Fish, Nushell or PowerShell
backend, generic runtime adapter or implementation child is introduced here.

## Existing boundaries

`ShellSession` owns the persistent PTY, trusted zsh startup proxy, authenticated
OSC command/prompt markers and real shell signals/job control. `SessionClient`
already separates frontend consumers from in-process/socket transport; that is
a transport contract, not a multi-shell contract. `SessionService` and backlog
replay preserve lifecycle/output events. The frontend owns its editable buffer,
menus, pickers and presentation. The configured completion bridge consumes zsh
completion knowledge in an isolated hidden zpty and inserts through that editor.

## Assumption inventory

| Area / current code | zsh assumption | Classification / future action |
| --- | --- | --- |
| `ShellSession` spawn/startup | `/bin/zsh -i`, HOME startup proxies, ZDOTDIR, prompt suppression | Leave zsh-specific now; another shell needs startup/trust research before extracting a backend factory. |
| PTY and job control | Persistent PTY, foreground process group, Ctrl+C/Ctrl+Z, resize | Expensive to generalize across OS/terminal models; preserve PTY ownership and test actual shell signal behavior. |
| Command lifecycle / hooks | `preexec`, `precmd`, `add-zsh-hook`, OSC status/cwd markers | Candidate adapter boundary later; hook ordering and multiline/parse failure behavior require another-shell research. |
| cwd/environment | Shell cwd from prompt marker; launch environment in helpers | Leave zsh-specific capture now. Future context snapshots need explicit names, privacy and generation semantics; do not pretend helpers mirror live PATH/environment. |
| Status | `$?` captured before precmd metadata work | Future backend should emit factual status; pipelines/signals/job statuses require shell probes. |
| History | zsh history formats and privacy/submission policy | Keep provider boundaries; shell history import needs per-shell parsing/privacy rules. |
| Completion | compinit/compdef, compadd, zpty/ZLE capture | Expensive shell-specific engine; abstract structured requests/candidates only when a second backend produces them. No foreign widgets may own the NMSh editor. |
| Aliases/functions | zsh parameter tables; bounded name-only precmd snapshot | Future metadata capability, with completeness/generation. Another shell needs name/type/visibility research; do not generalize function bodies. |
| Semantic classification | lexical zsh roles and isolated `whence` | Safe to leave zsh-specific; syntax families differ materially. Unknown forms must degrade safely. |
| Prompt suppression | unset ZLE and blank prompts, p10k/fastfetch suppression | Shell/plugin-specific startup policy, never a generic prompt string replacement. |
| Restore / detach | Service owns the same real shell; frontend replays events | Transport can stay shared. Backend identity/version belongs in future session metadata before supporting multiple backends. No shell-state serialization is promised. |
| Commands and interactive apps | Buffer submitted to real zsh, passthrough forwards terminal bytes | Preserve frontend/PTY boundary; execution syntax and interactive detection require shell-specific probes. |
| Configured completion lifecycle | trusted HOME config, bounded helper, conservative invalidation | Keep helper implementation zsh-specific. A future completion capability must state context provenance and config generation rather than imply live state parity. |

No area needs an additional generic interface **now**: current candidate,
lifecycle, provider and transport contracts already isolate useful consumers.
A tiny extraction without a second concrete behavior would add names without
reducing risk. No child issue or runtime extraction is justified for v0.11.

## Future surface to validate

A backend factory could expose persistent-session start/stop/resize/submit and
interrupt/suspend operations, factual output/exec/prompt events, startup trust
policy and capabilities. Capabilities may provide bounded command classification,
name metadata, history import and structured completion for a context containing
buffer/cursor/cwd/session/config generations. Completion remains optional and
failure must preserve native editing. Signal handling and raw PTY forwarding
belong beside the backend, never in command-by-command subprocess execution.

Do not require all shells to implement all capabilities. First investigate one
additional shell in a separate future milestone with real fixtures: bootstrap
without competing prompt UI, exact lifecycle/status/cwd, incomplete/multiline
input, alias/function visibility, history privacy, command-not-found behavior,
completion replacement semantics, job control and detach/reattach. Extract only
the behavior demonstrated by that work. Linux/Windows and broader frontend/TUI
research remain outside v0.11.
