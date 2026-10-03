# Windows, ConPTY and WSL feasibility

Refs #19 and [ShellAdapter research](shell-adapter-v011-research.md). Native
Windows is not supported or promised. This is a source-based recommendation;
no Windows or WSL runtime was tested in this session.

## Dependency versus product

The installed node-pty **1.1.0** includes `windowsTerminal.ts`,
`windowsPtyAgent.ts`, Windows prebuilds and ConPTY bindings. Its API supports
resize and Unicode transport. That establishes a PTY transport option, not an
NMSh shell backend. The installed WindowsTerminal explicitly rejects a signal
argument to `kill`; WindowsPtyAgent closes the pseudoconsole and enumerates
console processes for cleanup. Current upstream differs from the pinned
version, so its removal of legacy winpty must not be attributed to 1.1.0.
See [node-pty v1.1.0](https://github.com/microsoft/node-pty/tree/v1.1.0).

[ConPTY session creation](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)
requires pipes, process startup attributes and explicit resource ownership.
Resize is a pseudoconsole operation. Its stream uses UTF-8 terminal sequences;
this does not recreate POSIX foreground groups or suspend/resume semantics.

## Concrete NMSh blockers

| Boundary | Current implementation | Native Windows work required |
| --- | --- | --- |
| Shell lifecycle | zsh preexec/precmd, ZDOTDIR, add-zsh-hook, OSC cwd/status markers | A real backend supplying trustworthy lifecycle events and bootstrap suppression |
| Completion | zsh/zpty, compinit/compdef, hidden ZLE capture | Another shell-specific completion engine; preserve editor ownership |
| Semantics/history | zsh syntax, whence, parameter tables and history records | Backend-specific classification and history privacy rules |
| Signals | Ctrl+C/Ctrl+Z bytes, SIGTSTP/SIGCONT/SIGHUP, negative process-group kills | Explicit Windows interrupt, shutdown and descendant ownership semantics |
| Session transport | Unix sockets, uid/private 0700 runtime checks, exclusive locks | Named-pipe transport and ACL validation; Unix-socket API availability alone does not satisfy current security checks |
| Filesystem | POSIX paths, executable modes, HOME, colon PATH, shell quoting | Drive/UNC paths, case-insensitive environment, PATHEXT, ACLs, argument quoting and path translation |
| Helpers | Detached POSIX process groups, zpty cleanup | Separate process-tree ownership with leak evidence |
| Persistence | POSIX permissions and atomic journal/lock operations | Validate Windows locking, rename/link behavior, ACL and crash recovery |

[Node child-process documentation](https://nodejs.org/api/child_process.html)
explains Windows environment case folding and distinct detached-process
behavior. NMSh's `process.kill(-pid)` is not a Windows process-tree primitive.
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
can manage process groups on Windows, but designing ownership alongside
ConPTY and surviving session-service detachment needs a dedicated experiment.

CRLF handling, UTF-8 boundaries and ANSI/alternate-screen transport could reuse
parts of the renderer/parser; that is an inference, not runtime proof. Windows
Terminal capability detection must remain conservative and probe-based. A host
name never supplies missing shell hooks or POSIX job control.

## Shell choices

| Route | Semantics retained | Recommendation |
| --- | --- | --- |
| Native Windows + PowerShell | PTY transport, editor and much presentation; zsh lifecycle, syntax, completion and job control do not transfer | No-go now; feasible only after substantial ShellAdapter and process/transport work |
| Native Windows + POSIX-like shell | Potential zsh hooks within MSYS/Cygwin, but path translation and process/PTY boundaries differ | Research only; no clean supported zsh distribution/runtime proven |
| WSL + Linux Node + zsh | Linux PTY, hooks, completion, sockets, uid and persistent service remain inside Linux | Practical first Windows-user route, contingent on Linux baseline and later WSL validation |
| No Windows route | Existing macOS/Linux focus preserved | Correct native-Windows support policy for v0.13 |

Native support is a multi-week backend and platform project with uncertain
integration cost, not a flag change. No implementation children are justified
by this research. ShellAdapter #17 remains future architecture work.

## WSL boundary

Run the **Linux** Node/npm/zsh/NMSh build inside a WSL distribution. Do not
launch Windows Node against Linux files or treat `wsl.exe zsh` as a drop-in
native backend: signals, paths and service ownership cross that boundary.
Windows Terminal is the outer host; NMSh's PTY/session service stays Linux-side.

[Microsoft filesystem guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems)
recommends keeping Linux-tool projects in the Linux filesystem. Put runtime
sockets and journals there, not on `/mnt/c` with uncertain permission semantics.
XDG runtime can be unavailable in non-desktop WSL sessions; private temp fallback
is intentional. Reconnect must target the same distribution and uid. Distro
shutdown/reboot ends live shells; journal recovery is not shell-state recovery.
Clipboard/URL bridges are not required for this milestone. No WSL-specific code
or native Windows promise is added.

## Go/no-go

**No-go for native Windows in v0.13. Prefer WSL as a candidate Linux execution
route, not as validated support.** Native Windows becomes worth reconsidering
only after a second concrete shell backend and explicit process/security
transport proofs. Later WSL checks belong in the additive physical QA document;
Ubuntu CI proves Linux, not WSL or Windows Terminal.
