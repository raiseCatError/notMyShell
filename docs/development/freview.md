# freview — full repository review and hygiene audit

The cross-agent skill is [`.agents/skills/freview/SKILL.md`](../../.agents/skills/freview/SKILL.md), with its [evidence matrix](../../.agents/skills/freview/references/review-matrix.md). Ask any compatible coding agent: **“Use freview to audit the repository, all issues and PRs, branch ancestry, unverified implementation and release gates.”** This is an **on-demand, read-only audit**, not automatic maintenance or a nightly CI workflow.

## Local inspection

Run on a checkout:

```sh
node scripts/dev/freview.mjs --base origin/dev
node scripts/dev/freview.mjs --base origin/dev --json
```

Use `--base dev` if that is the only verified local ref. The script never fetches, installs packages or changes files. It reports exact HEAD and base SHA, divergence, local branches/upstreams, active worktrees, dirty state, whitespace checks, root npm manifest/lock alignment and community-file presence. It cannot inspect private worktrees remotely, verify user-visible behavior, or confirm GitHub CI; the **skill** handles remote reconciliation with linked evidence.

## Why a feature can be “done” and still be pending

Completion is a chain: **specified → coded → reachable → integrated → exact-head automated verified → physically accepted → released**. Record the exact point reached. A closed research issue does not promise runtime support; unchecked acceptance boxes are review leads, not conclusive proof of absent code. A successful local test does not make a failing GitHub check green. A candidate release is not a published GitHub Release. The report must expose scope and limitations.

## Dependency graph and network graph

GitHub's **Network** view is for Git history/fork topology. The **Dependency graph** under Insights → Dependency graph describes external package dependencies; it is not a graph of TypeScript imports or which app features are connected. NMSh's default branch already provides `package.json` and `package-lock.json`. After enabling the feature, allow for the initial processing period. If still blank, check access/security settings, default branch and parsing status before changing manifests. See [GitHub dependency graph documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/enable-dependency-graph).

## Complementary tools and inspiration

- [OpenSSF Scorecard](https://github.com/ossf/scorecard) checks repository security posture, not issue implementation completeness.
- [Repolinter](https://github.com/todogroup/repolinter) codifies policy for repository files and community conventions; not branch-to-acceptance reconciliation.
- [Claude-compatible codebase-review](https://github.com/amragl/codebase-review) surveys code quality and project hygiene; compare its design, but don't run external scripts automatically.
- [GitHub Community Standards](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories) recognizes public-project contribution documentation.

The skill has **no external npm/runtime dependencies** beyond the Node and Git already used by NMSh. It will not edit, delete, prune or merge anything as a side effect.
