# Claude agent UI execution ledger

Approved spec: [Managed Targets and agent UI](../design/claude-managed-targets-agent-ui.md), including the keyboard-first amendment.
Base: `fd08406d10efe4c76d01e1a0228525d859b31940`. Branch: `feature/claude-agent-ui`.

- Existing isolated worktree used throughout; parallel status-strip worktree/branch untouched.
- Baseline agent tests passed with required PTY access. Sandbox-only spawn EPERM was environmental.
- Initial bare-provider OAuth failure was traced to the wrong config namespace. User identified the working account2 profile; supported disposable probes succeeded without credential inspection. See [evidence and limitations](claude-agent-ui-evidence.md).
- Implemented additive target/adapters, private source spool, semantic projections, keyboard/input controllers, passive profile-aware inventory and unified manager. Localized top-level integration is included.
- Test-first foundation and review regressions cover permissions, state isolation, passive discovery, hostile metadata, queues, stale requests, long questions, full source and rejected-response retries.
- A single read-only reviewer was used as required by the review workflow. No implementation delegation.
- Initial canonical run exposed inherited NO_COLOR/empty COLORTERM fixture mismatches and command coverage expectations. Final verification uses TERM=xterm-256color, COLORTERM=truecolor and unset NO_COLOR; product NO_COLOR behavior remains explicitly tested.
- Bare interception, live attach, target-context correlation, Codex/OpenCode adapters, portable execution/activation and marketplace remain deferred. Read-only inventory and inert portable foundations are labeled accurately.
- Physical terminal QA remains pending. No merge, release, tag, version change or Homebrew work is authorized.

Verification fixture corrections: Theme Bridge uses a probe-owned tmux socket directory, and the provider fallback fixture supplies its own context instead of competing with shell bootstrap rendering. `NMSH_TEST_CONCURRENCY=1` is a validated optional resource limit for the unchanged full canonical suite and release checks. No assertions/timeouts were relaxed.

## Files changed

- `docs/design/claude-managed-targets-agent-ui.md`
- `docs/development-verification.md`
- `docs/development/claude-agent-ui-evidence.md`
- `docs/development/claude-agent-ui-progress.md`
- `scripts/probes/claude-managed.mjs`
- `scripts/test-selection.mjs`
- `scripts/test.mjs`
- `src/agents/input/controller.ts`
- `src/agents/input/surface.ts`
- `src/agents/mods/broker.ts`
- `src/agents/mods/claudeDiscovery.ts`
- `src/agents/mods/controller.ts`
- `src/agents/mods/inventory.ts`
- `src/agents/mods/model.ts`
- `src/agents/mods/view.ts`
- `src/agents/sessions/AgentViews.ts`
- `src/agents/sessions/claudeAdapter.ts`
- `src/agents/sessions/manager.ts`
- `src/agents/sessions/model.ts`
- `src/agents/targets/adapter.ts`
- `src/agents/targets/capabilities.ts`
- `src/agents/targets/commandRouting.ts`
- `src/agents/transcript/model.ts`
- `src/agents/transcript/projection.ts`
- `src/agents/transcript/store.ts`
- `src/agents/transcript/view.ts`
- `src/app/TerminalApp.ts`
- `src/ask/concepts.ts`
- `src/commands/slashCommands.ts`
- `tests/agentCommands.test.ts`
- `tests/agentInputOwner.test.ts`
- `tests/agentMods.test.ts`
- `tests/agentQuestions.test.ts`
- `tests/agentResume.test.ts`
- `tests/agentReviewRegressions.test.ts`
- `tests/agentSessions.test.ts`
- `tests/agentSource.test.ts`
- `tests/agentTranscriptModel.test.ts`
- `tests/autocomplete.test.ts`
- `tests/managedTargets.test.ts`
- `tests/shellFrameworks.test.ts`
- `tests/testSharding.test.ts`
- `tests/themeBridge.test.ts`

## Final automated verification

Passed affected agent/mod/input/command tests and the complete canonical suite. Passed `npm run verify:release` with `NO_COLOR` unset, `TERM=xterm-256color`, `COLORTERM=truecolor`, and `NMSH_TEST_CONCURRENCY=1`; this includes build, canonical tests, diff checks, benchmark typechecking and timing smoke. Initial parallel PTY timeouts and the isolated provider fixture race are not represented as successful runs. Assertions and timing budgets remain unchanged. Physical terminal QA remains pending.

## Reconciled onto master after #328

Rebased onto `master` `4f30ffd` (#328 merged). Conflicts: the settings-panel list (kept both #328's Status Strip studio and #329's mods panel) and `tests/themeBridge.test.ts` (kept master's equivalent, stronger tmux isolation instead of this branch's duplicate). Aligned with #328: the mods panel uses the shared Tab cycling helpers, and agent/mod display text uses the shared terminal-control scrubber. Physical terminal QA remains pending.

## Physical QA round: launcher, shelf, header, results

Physical QA confirmed managed Claude through account2. This round: one launcher for `/claude`, `/claude new` and `/ai` → Claude (profiles never bypassed), Up-to-shelf focus with a non-color focus marker, an NMSh-native provider header with the runtime model when reported, factual failure reasons instead of "Run failed: success", and opt-in import of simple Claude launch aliases. Real Claude 2.1.292 smoke after the change: two account2 turns with the model event, and the expired default namespace reading "Run failed: authentication failed." Physical terminal QA remains pending.
