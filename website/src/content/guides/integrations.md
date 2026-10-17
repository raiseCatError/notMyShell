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

v0.18.0 includes managed Claude Code targets through `/claude`, with launch profiles
and structured permission/question handling. Claude Code must already be installed.
Other agents can have session activity shown without becoming managed targets.
Do not assume Codex or OpenCode control is available: adapters are future work.

`/mods` inventories several extension-related surfaces, including declarative
Context Packs. These do not all have the same authority or execution model.

## Repositories

`/worktrees` lists worktrees, stages navigation and offers explicit create/remove
plans; removal is never forced. This first release slice does not focus tmux or
shell sessions for a worktree.

`/github` (also `/prs`, `/issues`) is a **read-only** workspace using your own `gh`
login and a github.com origin. It can inspect PRs, issues, checks, reviews, files
and diffs. It does not submit reviews, merge PRs or write to GitHub.

NMSh complements your editor and terminal. It does not replace project editing,
an editor's search or every upstream tool's interface.
