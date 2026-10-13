# Managed Claude evidence and implementation boundaries

Base: `fd08406d10efe4c76d01e1a0228525d859b31940`. Branch: `feature/claude-agent-ui`.

## Real installed provider evidence

On 2026-10-07, Claude Code **2.1.292** was exercised in probe-owned disposable workspaces through the working `claude-account2` launch namespace. That alias sets `CLAUDE_CONFIG_DIR` and calls the real installed Claude executable. NMSh did not source the alias file, change HOME, read tokens, copy credentials, or modify user projects. Bare Claude previously failed OAuth refresh in a different config namespace; that failure does not establish unsupported capabilities. Account1 was not probed.

The reproducible harness is `scripts/probes/claude-managed.mjs`. Supply the real executable via `NMSH_PROBE_CLAUDE` and the desired provider-owned config directory via `CLAUDE_CONFIG_DIR`. Default basic cases disable existing customizations using empty setting sources, strict empty MCP configuration and safe mode. Each case has a time and model budget. The native-plugin case loads only a probe-owned plugin and hook. Workspaces are removed at completion. Runtime logs remain local temporary evidence, not repository artifacts containing personal paths.

| Case | Observed evidence | Verdict |
|---|---|---|
| Conversation | stream-json init/session UUID, assistant text, success result | Proven |
| Two turns | Exact first-turn nonce recalled in second turn | Proven |
| Read | Tool call with file_path and successful text result | Proven |
| Edit | can_use_tool request; explicit host allow; successful result; fixture changed | Proven |
| Bash | printf command and successful result | Proven |
| Explicit deny | Bash write request denied; error tool result; denied file absent | Proven |
| AskUserQuestion | questions/options/multiSelect input; response via updatedInput.answers; chosen red acknowledged | Proven, distinct from permission approval |
| Interrupt | control acknowledgement, interrupted result, successful AFTER-INTERRUPT turn in same process | Proven |
| Resume | New process with exact provider session UUID recalls original nonce | Proven; not live attach |
| Lifecycle | Init, per-turn results, control response and process exit | Proven |
| Native coexistence | Owned SessionStart hook writes hook-ran; hook_started/hook_response events; successful model conversation | Proven for this fixture |
| Existing plugin inventory | Ten passive installation records; user/project scope, versions, installation paths, enabled and projectEnabled fields | Proven listing, not execution/trust |
| Enabled state | Listed installations enabled=true while projectEnabled=false in disposable workspace | Installation and effective project state differ |
| External provenance | Pre-existing provider records discoverable; NMSh did not install them | Installer identity unknown without ownership evidence |
| Status line | Existing NMSh collector retained | Correct managed-target context correlation unproven |
| Live attach/subagents | Not exercised through a supported structured control interface | Unknown |
| Codex/OpenCode | No real provider prototype in this branch | Unprobed |

The same native plugin id appeared in user and multiple project installation records. Foreign-project records are excluded from the current project's inventory. No disabled installation fixture was created in user config; disabled parsing is tested, whereas the real listing proved effective project-disabled facts. Marketplace suffixes and install paths are factual references, not proof of original package provenance, signatures or safety.

Headless NMSh presentation does not reproduce native plugin panels, menus or status-line UI. Behavioral hooks can still execute inside Claude, as the owned SessionStart fixture proves. Other native extensions were inventoried passively, never activated by discovery. Broader native UI behavior and hook kinds remain unproven.

The permission experiment first showed that `--permission-prompts host` alone did not deliver the needed requests. The installed official Claude Agent SDK and the live probe justified `--permission-prompt-tool stdio` plus an initialize control handshake before user messages. The adapter now uses that handshake, with bounded startup queues and explicit initialization failure. The [official SDK user-input documentation](https://platform.claude.com/docs/en/agent-sdk/user-input) describes AskUserQuestion's supported answers path; documentation guided the probe rather than replacing runtime evidence.

A separate live check exercised the actual implemented `ClaudeSession` adapter for two turns and exact `PRODUCT-NONCE-581` recall, using the same isolated launch namespace and disabled user customizations. Permission/question/interrupt/resume evidence comes from the reproducible protocol harness; their controller integration is proven by automated tests, not physical terminal interaction.

## Wired product behavior

- Existing AgentSessions remains the supervisor; AgentSession retains stable target identity, named launch profile, separate access level/capability facts, semantic source and provider session identity.
- `/ai`, `/claude`, `/claude new`, target/profile picker and supported resume use that same supervisor. Codex commands route symmetrically but launch reports that its supported adapter is unavailable.
- `/mods`, `/extensions`, `/claude mods` and `/codex mods` open one inventory/controller with provider filters. Portable descriptors, provider-native entries and declarative Context Packs remain distinct runtime/security classes.
- Inventory refresh occurs on open or explicit refresh; local search performs no provider I/O. Profile namespaces, project scope, enabled/unknown state and security provenance are shown. Discovery never imports mod JavaScript or runs hook declarations.
- Agent-message draft is separate from shell composer text/cursor/selection. Transcript keys require explicit focus and empty shell composer. Questions and approvals have separate owners and response paths.
- Transcript source is recoverable for the target lifetime via private storage (1 MiB hot source cache, 8 MiB individual event/frame, 64 MiB lifetime source and 100,000 semantic objects); projections expose only source-backed levels. Visible/full copy strips terminal controls. Oversize or lifetime boundaries visibly mark incomplete content.
- Existing shelf handles multiple target records; completed tool activity clears. No new status collector is created.
- `/nmsh raw claude [args]` and `/nmsh raw codex [args]` hand off to the real shell/native path. Ordinary bare provider commands and user-local wrappers retain shell semantics.

## Named launch profiles

NMSh resolves the real Claude executable rather than executing user shell aliases in its adapter. To use separate accounts, add non-secret `agentProfiles` records to NMSh's existing config JSON. On macOS the default is `~/Library/Application Support/notMyShell/config.json`; an explicit XDG_CONFIG_HOME uses `$XDG_CONFIG_HOME/nmsh/config.json`. Preserve the rest of the existing config. Example (replace paths with the actual absolute provider config directories):

```json
"agentProfiles": [
  {"name": "account1", "harness": "claude", "label": "Claude account 1", "configDir": "/absolute/path/.claude-account1"},
  {"name": "account2", "harness": "claude", "label": "Claude account 2", "configDir": "/absolute/path/.claude-account2"}
]
```

Restart NMSh after your config edit. `/ai account2` starts that named profile. With several profiles, `/claude` or `/claude new` opens a keyboard profile picker when a launch is needed. Each target keeps its profile for resume; native inventory keys include profile identity. No account names are hardcoded, no alias files are sourced, and NMSh never writes your provider authentication/config merely to discover it. For your raw wrapper invocation, type its normal shell command directly; the generic raw escape uses whichever alias/CLI your shell resolves for `claude` or `codex`.

## Foundation only and deliberate deferrals

The portable descriptor, target-scoped instance/state model and deny-default broker are implemented and tested with an inert fixture. There is **no running product portable-mod loader or enabled Context Meter**. Broker aggregation requires an explicit grant and is test/foundation-only. Provider inventory is host-owned; it is not given to target-local portable instances.

The manager is read-only for installation/activation. No new enable/disable/apply or remote-install flow is advertised. Existing Context Pack configuration remains its own supported workflow. Executable portable code, marketplace, default cross-target access, filesystem/network/process/secrets capabilities and programmatic mod approval are intentionally unsupported.

Managed does not grant every capability. `conversation.read`, `message.send`, `tool.observe` and human-only `tool.approve` acquire observed target evidence; session.status derives from NMSh lifecycle. task.cancel and context.status facts remain conservative unknowns. Live attach remains unavailable. No shared integration is deferred: localized TerminalApp and slash-registry wiring is included; the parallel status-strip branch was untouched.

NMSh protects its input routing, bounded source/model state and passive discovery/display boundary. It cannot sandbox arbitrary native code running inside Claude or contain the provider's own privileges. A separate Node process would not establish a security sandbox; no such claim or arbitrary portable execution loader is made.

## Physical terminal handoff

Automated tests are not physical QA. In Ghostty and another available host (Terminal.app, Kitty, WezTerm or VS Code), check:

1. Preserve a `git stat` shell draft with cursor/selection, enter a managed target via the existing focus path, send an independent message, return with Esc, and verify exact restoration.
2. With an empty composer, explicitly focus transcript via Tab/Ctrl+O from agent input; navigate Up/Down, zoom Left/Right and 1–5, copy c/C, return via Esc. Check feedback never appears in history/copy.
3. Request a harmless permission in a disposable project; Shift+Tab or `/approval` opens review. Enter, digits, paste and scrolling must not approve. Only the displayed explicit Ctrl+O allow or Ctrl+C deny responds.
4. Request a question; Shift+Tab opens choices. Arrows select, Tab toggles multi-select, typing enters Other, Enter answers; it never becomes an approval.
5. Open `/mods` and `/extensions`; use Tab/Shift+Tab, P filter, `/` search, Enter details, arrows/pages scroll, Esc back and R refresh. Repeat provider shortcuts and narrow windows at 30/40/50/80/120/200 columns, Safe glyphs and NO_COLOR.
6. Check multiple targets, attention, elapsed state, resize, follow/detached shell history and raw provider passthrough. Native raw CLI arguments and wrapper aliases must retain normal shell behavior.

Hosts may consume keys before NMSh receives them; NMSh cannot remap unseen keys. Slash-command access and displayed keyboard fallbacks remain the supported routes.
