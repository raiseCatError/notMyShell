# Agent workspace: native controls, Claude mods and the context panel

Continues [Managed Targets, agent UI, and unified mods](claude-managed-targets-agent-ui.md). Verified against
Claude Code 2.1.295 (2026-10-08) and its documentation on 2026-10-09.

## Principles

- **NMSh owns its interface; Claude owns its state.** Pickers, lists, confirmation and feedback are NMSh's. Every
  change goes through a mechanism Claude documents: control requests on the managed stream-json channel, or Claude's
  own `claude plugin …` commands. NMSh never edits Claude's settings files and never types into Claude's text menus.
- **Nothing is claimed without evidence.** Each fact carries its provenance (`provider`, `requested`, `observed`,
  `estimate`) and age. A change is "requested" until Claude reports it; an estimate says it is one; an unreported value
  is said in words, never shown as 0% or a guessed level.
- **A command beginning with `/` is not automatically NMSh's.** `isSlashInput()` is the single rule: a first word with
  a `/` after the leading one is a path and belongs to the shell. In a managed agent composer only exact NMSh forms
  (`/model`, `/effort`, `/panel`, `/context`, `/approval`, `/copy`) are intercepted; a leading space sends text verbatim.

## Mechanisms

| Need | Mechanism | Takes effect |
|---|---|---|
| Model | control request `set_model` | from Claude's next model call, mid-turn included; confirmed when `system/init` reports it |
| Effort | `apply_flag_settings {effortLevel}` (`null` = model default) | next turn, this session only |
| Launch effort | `--effort` flag from a launch profile (only when `--help` documents it) | the whole session |
| Context breakdown | `get_context_usage` (`summary`) | on request (`/context`) |
| Plugin inventory | `claude plugin list --json` per launch identity (`CLAUDE_CONFIG_DIR`) | read |
| Plugin contents | manifest files read as bounded JSON: `.claude-plugin/plugin.json`, `hooks/hooks.json`, component folders | read; nothing imported or run |
| Enable / disable | `claude plugin enable\|disable <id> --scope <installed scope> --json` | settings; then `reload_plugins` to running managed sessions of that account |
| Inspect | `claude plugin details <id>`, `claude plugin validate <dir>` (static) | read |

Claude's `plugin enable` accepts an id that is not installed and writes it into settings. NMSh only sends ids from the
current listing, and reads the listing again afterwards as evidence.

## What is operational, what is representation, what is unsupported

**Operational (real provider effect, verified by tests against the documented wire format and by the 2.1.295 probe):**

- `/model` picker and `/model <name>`: `set_model`, acknowledgement awaited, refusal kept beside the rows.
- `/effort` picker and `/effort <level>`: `apply_flag_settings`, only the running model's `supportedEffortLevels`.
- `/context`: Claude's own breakdown in the right panel (categories, headroom to auto-compact).
- Plugin enable/disable at the installed scope and account, with listing re-read and live `reload_plugins`.
- Absolute executable paths in the shell composer, verified end to end on zsh, Bash and Fish.

**Representation of provider facts (display only, with provenance):**

- Header model and effort; right panel context meter (estimate between breakdowns), plan (TodoWrite), files read and
  edited with line counts, subagents and tasks, compactions, usage limits near their cap, estimated cost.
- Plugin type, components, dependencies, scope conflicts, project overrides, "Loaded in" (from a target's own report).
- What a plugin does in a managed session: per Claude's docs, under `claude -p` a mod's hooks run but nothing it draws
  appears (skins, filetree panes, terminal-browser, replay-theater's viewer); skills, agents, commands, settings hooks,
  MCP and LSP servers load as usual.

**Unsupported, said in the UI rather than faked:**

- The effort level in effect is never reported by headless Claude; NMSh shows the acknowledged request, launch flag or
  settings value, labelled as such.
- Personal skills (`skills/` folder) and settings hooks have no Claude command to toggle; they are listed with the reason.
- A plugin decided by the project's `.claude/settings(.local).json` is not toggled at user scope; the override is named.
- Mod panes, bands and restyled rows: not hosted by NMSh (no NMSh sandbox exists or is implied).
- Claude's own terminal sessions see a plugin change after `/reload-plugins` or a restart.

## Research conclusions applied

Two research passes (coding-agent interfaces and context tooling; workspace navigation and TUI craft) are summarized in
the PR. The decisions they drove:

- **Two tiers of context.** A quiet pressure snapshot (bar, used of window, headroom, source and age) always in the
  panel; the attribution report only on request. Never `null → 0%` (Claude HUD #330/#576); name the source because
  Claude's own figures differ by denominator (CC #63015).
- **Model and effort pickers converge on one shape** (Claude Code, Codex): catalog rows with current/default marks,
  per-model effort levels, explicit timing. NMSh adds provenance and keeps Enter as the only action.
- **Show the target of every file activity** (CC #21151): the panel lists paths with `+a -r` or `read`.
- **Plan only when the provider emits one**: task tools are off by default on 5.5-generation models.
- **Panels give way before the conversation does.** Right panel by default from 120 columns, on request from 72,
  bounded to 30–46 columns; below that the conversation is full width. Breakpoints follow Herdr and lazygit practice.
- **State before decoration.** No transcript parsing or network on the render path (status-line tools' CPU and 429
  storms); everything comes from events NMSh already receives.

## Next steps (not in this change)

- Left workspace sidebar (projects, shell sessions, managed targets, worktrees, PRs) with Herdr's state vocabulary
  (blocked / working / done-unseen / idle / unknown, worst-state roll-up) and selection ≠ preview ≠ activation.
- Per-turn diff source in the right panel from the provider's `structuredPatch` hunks already retained.
- MCP server status and session toggles in the panel (`mcp_status`, `mcp_toggle` are implemented in the adapter).
- Prompt-to-prompt navigation (`{` / `}`) in the agent transcript, matching Claude Code's transcript view.
