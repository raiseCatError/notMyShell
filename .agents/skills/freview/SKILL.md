---
name: freview
description: Read-only full-repository review. Audit Git branch ancestry and worktrees, GitHub issues and PRs against actual implementations, exact-commit CI, release gates, community files, dependency graph, history hygiene, and falsely completed or untouched work.
---

# freview — Full Repository Review

This skill performs an evidence-first **read-only** audit. Never infer completion from a checkbox, label, commit subject, green test, PR description or an agent report alone. Never silently edit, fetch, merge, checkout, rebase, prune, delete, push, or update issues/PRs. Preserve active agents, branch ownership, uncommitted work and protected releases.

## Procedure

1. Inspect `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md`, the applicable release/QA ledger and branch policy **at the target ref**. Identify owner/repo, current UTC time, default branch, normal development base, candidate release branches, tag/release lineage and what requires physical validation. Do not confuse GitHub default branch with active development branch.
2. Record exact SHAs, upstreams and observation times. Detect local availability and active worktrees. **If you have only GitHub access, say so**; never invent observations about a user's Mac worktree or uncommitted local edits.
3. With local execution, run `node scripts/dev/freview.mjs --base origin/dev` (or the actual verified base; `--json` for machine-readable facts). It is a no-network, no-dependency, read-only snapshot. Do not fetch automatically; missing ref means partial coverage.
4. Obtain all pages of open issues, open PRs, recently closed issues, branches, tags, releases and relevant check runs. Record API/search pagination limits, permissions and unavailable resources. For each prioritized item, inspect bodies, material comments, review threads, current head SHA, base SHA, merge status, linked issues and exact-SHA CI. Do not silently equate the first twenty results with full inventory.
5. Compare **stable/released**, **candidate/integration**, and **isolated/in-progress** source views, each with exact refs and SHA. Local changes matter only if actually accessible. Work from high-risk contradictions first; read targeted source, tests and diffs rather than indiscriminate files.
6. Reconcile issue acceptance criteria one item at a time: expected user behavior → parser/route → implementation owner → service/protocol/persistence → rendering/configuration → test → exact-head CI → human QA → release reachability. Mark missing evidence, negative/edge cases, backwards compatibility and feature flags.
7. Run bounded hygiene checks: dirty and untracked state, branch graph and ancestry, PR target/drift, protected refs, CI skipped/failed gates, dependency lock alignment, community docs and accessibility, security reporting, cleanup artifacts, documentation accuracy, release/tag/changelog consistency. For complete guidance use [review matrix](references/review-matrix.md).
8. Produce the report and **stop**. Do not make fixes or change GitHub status without a separate explicit user instruction.

## Status vocabulary — never use only Done

- **Proposed/research only**: there is no verified accepted runtime implementation.
- **Untouched (scoped)**: searched relevant refs/source and found no implementation; record the inspected scope, not universal absence.
- **Partially implemented**: some acceptance behavior exists, other items are missing or blocked.
- **Implemented in isolated branch**: committed code exists, not integrated.
- **Integrated candidate**: included in an unreleased target branch; not automatically shipped.
- **Automated verified**: named tests/jobs at exact SHA, with OS and passes/failures/skips. A failing required CI shard means aggregate CI is **red**, even when suspected flaky.
- **Physical QA passed**: actually performed by the maintainer on the named host, not inferred from automated PTYs or SVG previews.
- **Released**: reachable commit in published tag/GitHub release with actual date.
- **Deliberately deferred**: documented decision not to ship or implement yet.
- **Unknown/unverifiable**: missing source, tests or permissions explicitly listed.

A closed research ticket does not certify runtime functionality. Unchecked boxes are review leads, **not proof of missing code**. Open issue descriptions can be stale relative to newer PRs. Git ancestry matters, but squashed/cherry-picked work can require patch/tree inspection rather than simple `merge-base` conclusions.

## Evidence and risk controls

For each high-priority claim link issue → PR → commit → reachable branch → source path/behavior → regression test → exact-SHA CI → physical QA → release/tag. State direct observation separately from an agent's report. Verify the actual invocation/wiring: a standalone adapter, unused module or feature behind a disabled flag is not publicly usable.

Review branches using `git merge-base --is-ancestor`, `git rev-list --left-right --count`, `git worktree list --porcelain`, `git log --graph` and exact diff paths. Classify safe *candidates* for later cleanup, never delete them automatically. A merged branch can still be an active worktree or needed audit record.

Respect local T7 Shield policies for controlled scratch/build/test artifacts; verify physical mount and fail closed. Do not run comprehensive `npm ci`, release verification, security scanning, Git integrity traversal or expensive benchmarking merely for a review. Never expose secrets, full private environment dumps or command histories. Use read-only APIs; don't post comments or edit GitHub state.

GitHub's **Network** graph concerns forks/branches; its **Dependency graph** concerns third-party package manifests, not source imports. Neither confirms feature completeness.

## Report contract

Dated and source-linked: repository/ref coverage and limitations; P0/P1/P2 concrete findings; acceptance and implementation matrix; untouched/partial/isolated/integrated/released distinctions; branch/PR ancestry and hygiene; CI, security and physical QA gates; community/accessibility and dependency graph; misleading closed/open issue statuses; minimal non-destructive next actions; **Not tested / Not observable** section. Never declare the repository entirely clean with incomplete coverage.
