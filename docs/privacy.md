# Privacy

NMSh is local-first. There is no account, no cloud service, no telemetry and
no network access on the typing path. Network use is limited to explicit
release checks (`/update`, opt-in background checks) and package-manager
commands you confirm.

## What NMSh stores, all under its own config directory

| Data | Contents | Control |
|---|---|---|
| `config.json` | Settings | `/settings`, `nmsh config` |
| `sessions/` | Transcripts you see in `/resume` (command text and output) | retention setting, `/clear`, delete files |
| `history-deletions.json(.d)` | IDs of history entries you deleted | — |
| `agent-activity.json` | Per-agent durations, counts, days used, last 50 run times and exit codes | `/agents off`, `/agents reset` |
| `tool-installs.json` | Tools NMSh installed for you, and how | removed on uninstall through NMSh |
| `completion-specs/` | Only specs you put there | your files |

Runtime sockets and spools live in a private runtime directory and hold live
session streams until a journal acknowledges them.

## What NMSh does not record

- Environment variables, secrets, tokens, clipboard contents.
- Agent conversations, prompts or responses; agent detection uses only the
  program name.
- Terminal output for analytics; session notices carry only program name,
  exit code, duration and cwd.
- Commands excluded from history by the shell's own rules (leading space,
  zsh HISTORY_IGNORE, Bash HISTCONTROL/HISTIGNORE) or deleted by you.

## Shell configuration

NMSh never edits `.zshrc`, `.bashrc` or `config.fish`. Its shell bootstraps are
private per-session files that load your own configuration first. Diagnostics
read shell configuration files as text and never execute them.
