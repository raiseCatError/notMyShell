---
title: Tools and integrations
description: Curated tools, frameworks, managed targets and repository workspaces.
group: Make it yours
order: 10
sources: [README.md, docs/architecture/optional-tools.md, docs/architecture/github-workspace.md]
---

## Start with what is already installed

`/tools` detects and explains a curated tool list. `/providers` selects providers;
`/integrations` reports integration health. Detection reads facts; it is not blanket
authorization to install, source configuration or execute workspace code.

Install plans show typed package-manager arguments and require confirmation.
Some tools need manual installation; NMSh does not run special installers such
as an Oh My Zsh install script.

## Configuration is code until proven otherwise

`/configure`, `/tmux` and `/dotfiles` expose supported configuration workflows.
Frameworks such as Oh My Zsh, Prezto, Zim, zinit and Antidote are detected from files.
Shell configuration is executable, not harmless data to merge automatically.
Review exact diffs and ownership before accepting changes.

## Agents, without making NMSh an AI terminal

`/claude` opens managed Claude Code targets, with launch profiles, structured
permission and question handling, and a conversation workspace. Claude Code must
already be installed. This integration remains beta.

Inside a managed Claude conversation, `/model` and `/effort` open native pickers.
Choices come from provider telemetry; a requested change is not shown as confirmed
until Claude reports it. The context panel identifies the source of its runtime facts.

Codex and OpenCode activity can be observed, but they are not controlled as managed
targets. Codex adapter code exists without an integrated frontend path; it does not
establish feature parity with managed Claude Code.

`/mods` inventories several extension-related surfaces, including declarative
Context Packs. These do not all have the same authority or execution model. Ordinary
Claude plugin inventory is read-only. Plugin toggling stays behind an experimental
gate; the normal UI names the upstream command for you to run yourself instead of
silently editing Claude settings.

## Repositories

`/worktrees` lists worktrees, stages navigation and offers explicit create/remove
plans; removal is never forced and does not delete the branch. Enter stages `cd`
only into an empty composer. A related PR appears only when the last `/github`
listing has matching same-repository branch evidence; `p` opens that PR.

`/github` (also `/prs`, `/issues`) is a **read-only** workspace using your own `gh`
login and a github.com origin. It can inspect PRs, issues, checks, reviews, files
and diffs. It does not submit reviews, merge PRs or write to GitHub.

## Optional workspace regions

The workspace sidebar and detail panel are experimental and **Off by default**.
Enable them in Settings → Layout → Workspace sidebar & panel. `/sidebar` and `/panel`
open the regions; their `focus` forms give them the keyboard. Esc returns to the
shell and Tab moves between regions. Wide terminals dock them; narrow terminals
use a focused drawer. Fullscreen programs regain the terminal's width.

`/keys` explains optional workspace bindings and host or tmux conflicts. These are
opt-in, not replacements for normal composer keys. `/worktrees`, `/github`, sessions
and [background tasks](/docs/execution/) work independently of the regions.

NMSh complements your editor and terminal. It does not replace project editing,
an editor's search or every upstream tool's interface.
