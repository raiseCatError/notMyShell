# freview — review matrix and audit decisions

Use targeted levels. Never run cleanup or expensive verification solely to gather hygiene facts.

## Evidence tiers

- **Tier 0, fast/read-only:** `node scripts/dev/freview.mjs`, `git status --porcelain=v2 --branch`, `git worktree list --porcelain`, `git log --graph --decorate --oneline -n 40`; repository files; GitHub issue, PR, release and check-run metadata. Pagination is mandatory for “full” coverage; if it cannot be completed, label the sample.
- **Tier 1, targeted:** `git merge-base --is-ancestor`, `git rev-list --left-right --count BASE...HEAD`, `git diff BASE...HEAD --name-status`, per-PR files, tests, configuration routing, feature flags, GitHub reviews and CI jobs. Preserve the exact accepted source SHA.
- **Tier 2, explicit acceptance:** focused tests, source/PTY behavior repro, cross-shell tests, dispatch CI, security review, human physical Ghostty/Terminal.app QA. Execute only when the user and host resources permit. No automatic heavy full-suite runs.

## Status/evidence table

| Issue and acceptance item | Expected behavior | Branch/SHA and source location | Test and OS | Exact-head CI | Physical QA | Actual status | Missing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #ID: one item | observable contract | SHA:path:line or not located | test / skipped / none | pass/fail/not run | passed/pending/N/A | isolated/integrated/etc | next gate |

For every item distinguish **source code exists**, **user can reach it**, **correct operation tested**, **release integrated**, **physically accepted**, **publicly published**. Stronger sources supersede stale tracker language, but contradictions must still be recorded.

## Branch/history hygiene

1. Record default, dev, candidates, tags and local remote-tracking references with exact SHAs and timestamps. A source worktree may exist outside the checkout. Inspect `git worktree list --porcelain` before diagnosing stale branches.
2. Identify divergent branches by ahead/behind; check whether accepted commits are ancestors of the intended integration target. For squash/cherry-pick cases compare equivalent patches/final trees. Do not infer a feature is absent solely from non-ancestry.
3. Check dirty state, untracked files, missing upstream, shallow clones, wrong PR base, active worktree collisions, obsolete release candidate heads, PR required checks, skipped platforms and unresolved reviews. **No `git fetch --prune`, `git clean`, force-push, deletion or migration.**
4. Look for duplicate independent work (same functionality on different active branches) and explicitly nominate an integration owner and dependency order; never merge them autonomously.
5. Physical QA and manual release approvals must stay open even when automated CI is green.

## Implemented vs marked complete

- Audit high-impact *closed* issues and milestone checklists for “research completed” vs “product implemented”; independently inspect source and later PR evidence before proposing issue-state corrections.
- Audit high-impact *open* issues for stale “not yet implemented” text that newer commits supersede.
- For each behavior, trace CLI parser and help → route/controller → authority/state → optional service/protocol → persistence → UI/clipboard → tests and negative cases. A module tested in isolation does not establish production wiring.
- Verify default-off vs default-on, old settings migrations, deprecated aliases, NO_COLOR/Safe/narrow, raw output and secret handling, keyboard focus, interrupted readers and detachment where relevant.
- Preserve exact release status; a merged candidate isn't necessarily a tag/published release. Avoid hardcoded historical test counts and outdated issue language.

## Community, dependencies and security

- Confirm README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, SECURITY, issue/PR templates and ACCESSIBILITY.md on the **default branch**. A community profile usually won't detect a file present only on an unmerged branch.
- Confirm npm `package.json` and `package-lock.json` root declared ranges, and GitHub Dependency graph parsing from default branch. Check Advanced Security settings and initial processing wait; look under Insights → Dependency graph → Dependencies. The Network graph is branches/forks, not dependencies. Don't regenerate the lockfile just for an empty graph.
- Check Dependabot configuration and open security alerts when authorized; use OpenSSF Scorecard for security posture only. No scan can certify acceptance criteria or complete secret redaction.
- Accessibility: text independent of color, Safe/NO_COLOR, keyboard/focus/cancel behavior, reduced motion, small widths, alternate screen, physical host conflicts and limitations of terminal screen readers. Don't claim WCAG certification without a real assessment.
- Review unsafe ownership, uncontrolled PTY input, raw-copy contamination, archive restoration, plugin execution, stale approvals and redaction acceptance. Include only safe examples, never real credentials.

## Report outline

1. Scope: date/time, tool access, GitHub pagination coverage, local worktrees observed/not observed, SHA per ref.
2. Summary: P0 defects or red release gates; P1 missing integration/security; P2 docs/tracker drift; research/deferred distinct.
3. Feature matrix: untouched, partial, implemented isolated, candidate, automated verified, physical verified, released.
4. Issue/PR reconciliation with exact citations, conflicting claims and strongest evidence.
5. Graph, branch ancestry, worktree ownership, active PRs and CI; no cleanup.
6. Dependencies/community/accessibility/license, document accuracy and unsupported platform claims.
7. Minimum next actions and explicit “not tested / not observable”.

## NMSh constraints

Keep NMSh a frontend on a persistent real PTY shell with zsh/Bash/Fish; maintain raw copy, input ownership, stale-review refusal and release-branch isolation. Track Fish 3.7 typeahead, Ghostty/Terminal.app QA, and withheld v0.19/v0.20 releases as gates, not retroactively passed tasks. The separate smooth-scrolling research is intentionally deferred from production until performance evidence justifies it.
