# v0.13 additive physical QA (deferred)

These checks cover portability only. No result below is marked passed.
Use the final cumulative v0.13 branch after review; package version is 0.7.0.
Automated Ubuntu PTY fixtures do not validate a physical Linux terminal or WSL.

## Linux

Start with Kitty, then GNOME Terminal baseline; optionally compare WezTerm,
Konsole and Alacritty. Record distro, architecture, Node/zsh versions, host,
commit, actual result and failures. Do not promise every host.

- Install Node >=22, zsh and native build tools. From the reviewed checkout run
  `npm ci`, `npm run build`, `npm link`; verify `nmsh --version` names this build.
  Missing zsh must report that zsh is required; it must not select bash.
- Launch `nmsh --new`. Verify composer, context, keyboard, prompt and `/tools`.
  `/status` should report factual platform, architecture, Node and capabilities.
- Submit a command immediately during slow trusted shell startup. Its initial
  readiness prompt must not create an empty completion or duplicate record.
- Execute `printf 'λ 世界\n'; pwd`; output remains raw and completion is factual.
  Submit two commands setting then printing a variable; persistent zsh state
  survives. Test spaces/Unicode/symlink working directories and home paths.
- Run a streaming command (`for i in {1..20}; do print $i; sleep .3; done`).
  Resize repeatedly, inspect history then return to FOLLOW. Ctrl+C restores
  editing without corrupting transcript/history; `/copy` stays plain text.
- Run an installed fullscreen TUI such as `vim -u NONE`. Keys, paste, resize and
  exit return terminal ownership to NMSh. Test Ctrl+Z/`fg` with an ordinary job.
- Detach with the session action, use `nmsh --sessions`, then
  `nmsh --attach <id>`. Same shell/cwd/variables and backlog survive. Reboot or
  distro shutdown ends live shells; recovery must not claim shell survival.
- Test a trusted zsh `compdef` and filesystem completion, including Unicode,
  quoted spaces and directory symlinks. Partial composer input is never run.
- Try `NO_COLOR=1 nmsh --new`; effects/presentation off/on and Kitty-capable
  keyboard/protocol smoke. Baseline hosts retain conservative capabilities.
- With XDG runtime available verify private socket storage; without it verify
  fallback and reconnect. Config/journals remain in documented paths. Linux
  notifications are no-op; missing optional integrations cannot block startup.
- Confirm `/zsh` restores terminal modes and launches ordinary zsh. Recursive
  NMSh from its managed shell is still rejected.

## macOS regression

On Ghostty and Terminal.app check startup, completion, persistent sessions,
resize/fullscreen passthrough, existing notifications, configuration paths and
transient effects. HOME quoting must preserve user startup configuration.

## WSL candidate route (unvalidated)

Only test the Linux build inside a WSL distribution, using Linux Node/npm/zsh
and the Linux filesystem. This is not native Windows support. In Windows
Terminal verify startup, Unicode, completion, ordinary/streaming/fullscreen
commands, resize, detach/reattach within the same distro/uid, and truthful
recovery after distro shutdown. Keep sockets/journals off `/mnt/c` for baseline
QA. Native Windows has no runnable supported baseline in v0.13.
