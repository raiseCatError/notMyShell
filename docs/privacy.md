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
| `context-packs/` | Context Packs you installed, with their sha256 | `nmsh packs remove`, `/prompt` → Packs |
| `agent-context/claude-status-line.json` | The exact `statusLine` text NMSh added to Claude Code's settings, so it can remove exactly that | `nmsh agent-status remove` |
| `theme-bridge/` | Theme Bridge's environment files, generated themes and ownership ledger (bat and Helix themes live in those tools' own theme directories, recorded in the ledger) | `/theme-bridge` → Remove managed setup |

Runtime sockets and spools live in a private runtime directory and hold live
session streams until a journal acknowledges them. Each prompt's stream event
includes the shell's command names and its allowlisted context environment (see
below), never credential values. When Claude Code reports to NMSh, its last
status (model, effort, context-window and rate-limit use, cost, repository,
session name; its session id only as a short digest) is kept there too, in a
private file per NMSh session that is pruned when stale.

## Context modules

Prompt, Rail and Status Strip modules read local files and a few environment
values only while a visible module needs them, and only on your machine. The
live shell reports an allowlisted set of non-secret variables (for example
`PATH`, `AWS_PROFILE`, `KUBECONFIG`, `VIRTUAL_ENV`) and only the *presence* of
credential variables such as `AWS_SECRET_ACCESS_KEY`. Nothing is uploaded, no
cloud API is called and nothing in a project is executed to learn about it.
Values marked display-only (memory, battery, agent status, cloud account ids)
never enter transcripts or exported settings. The
[Context Modules guide](architecture/context-modules.md) lists every capability
and what it reads.

## What NMSh does not record

- Environment variables beyond the context allowlist above, credential values,
  secrets, tokens, clipboard contents.
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
