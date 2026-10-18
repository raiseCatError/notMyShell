# v0.21 physical QA

## Status

- **Candidate, not released.** Items are added as each v0.21 slice lands ([ledger](../development/v021-ledger.md)).
  Nothing below has been run yet.
- **What does not count:** headless PTY fixtures, synthetic keys, captures of a window driven that way, and green CI.
  Each item needs a person at a real terminal with a real keyboard and pointer.
- **Build under test:** record the exact commit (`node dist/index.js --version`) built from a clean checkout
  (`npm ci && npm run build`).
- **Isolation:** a throwaway `HOME` (or `XDG_CONFIG_HOME`) and a temporary working directory.

## Results

| Pass | Host and version | OS | Shell and version | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Multi-row progress (#388) | Ghostty | macOS | zsh | | Not run | |
| 1 Multi-row progress (#388) | Terminal.app | macOS | Bash or Fish | | Not run | |

## 1. Multi-row progress redraws (#388)

- [ ] 1.1 `node -e 'for (let i=0;i<=10;i++){process.stdout.write((i?"\x1b[1A\x1b[2K":"")+"Downloading "+i*10+"%\n")}'`
  leaves one `Downloading 100%` line, at 80 columns and at 40 columns.
- [ ] 1.2 A two-row display (for example `docker pull` of a multi-layer image, or `brew install` of a formula with
  concurrent downloads) updates its rows in place; log lines printed between frames all stay. Record the command.
- [ ] 1.3 Resize the window narrower and wider while 1.2 runs: no earlier command, prompt or NMSh notice is erased.
- [ ] 1.4 `/copy` of that block copies the final rows once, not every frame.
- [ ] 1.5 `printf '10%%\r20%%\r100%%\n'` still shows one `100%` line; `clear` still clears.
- [ ] 1.6 `vim`, `less` and `htop` still take the full screen and return to the composer.
- [ ] 1.7 Queue two quick commands (`ls` then `pwd`) with Ctrl+Q while a short command runs: both stored command
  lines end with the known-command color (#408).
