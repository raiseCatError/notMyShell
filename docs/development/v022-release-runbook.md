# v0.22.0 release runbook

The exact steps from the v0.22 release candidate to a published v0.22.0, following the v0.20.0 release (PR #392,
tag `v0.20.0` on its merge commit, Homebrew tap PR #3, website sync). State and evidence are in the
[ledger](v022-ledger.md). **Nothing here runs without the maintainer's go-ahead after physical QA.** Tagging, the
GitHub release, the tap and the website deploy are public and hard to undo.

v0.22.0 is the release that ships the unpublished v0.21.0 candidate (#429). **Never tag, publish or merge v0.21.0**: #429
is closed as superseded once the v0.22.0 release PR is merged (it is never merged for bookkeeping), and the changelog
has no `[0.21.0]` section. The previous published release, and the rollback target, is v0.20.0.

## How a release moves

`dev` + the v0.22 PRs, merged in dependency order with merge commits (#435, #433, #437, #442, #438, #441, #434, #439,
#440) → `release/v0.22.0` (one release-metadata commit) → PR into `master`, merged with a regular merge commit →
annotated tag `v0.22.0` on that merge commit → GitHub release (no uploaded assets; the source archive is GitHub's tag
archive) → Homebrew tap PR (source formula: `url` and `sha256` of the tag archive) → website sync PR into `master` →
manual **Publish NMSh website** dispatch, approved in the `nmsh-production` environment. No npm package is published
(`package.json` is `private`). `master` needs the `Verify (22.x)` and `Verify (26.x)` checks; the old GitHub Pages
deploy (`deploy.yml`) is disabled.

## 0. Before starting

- The physical QA results table has a recorded result for every row on the candidate build (or the maintainer has
  decided, in writing, which rows a release may go without, as v0.20 did).
- Dispatched CI is green on the **exact** head of `release/v0.22.0`. Code changes need the full dispatch: Fedora and
  both timing smokes run only on dispatch and push.
- `npm run verify:release` has run on that head locally, and any failure is explained by evidence.

```sh
git fetch origin
RC=$(git rev-parse origin/release/v0.22.0)
gh run list --workflow CI --commit "$RC" --json event,conclusion,url   # a workflow_dispatch run, success
```

## 1. Final release commit (on `release/v0.22.0`)

1. `CHANGELOG.md`: `## [0.22.0] - Unreleased (release candidate)` becomes `## [0.22.0] - YYYY-MM-DD` (the
   publication date); remove the candidate sentence; keep Compatibility, Upgrade notes and Known limitations accurate
   to the QA results. Link references at the bottom: `[Unreleased]: …/compare/v0.22.0...HEAD` and
   `[0.22.0]: …/compare/v0.20.0...v0.22.0` (the candidate links `…/compare/v0.20.0...release/v0.22.0`).
2. `docs/testing/v022-physical-qa.md`: the recorded results and the release decision.
3. README, ROADMAP, AGENTS, SECURITY, CONTRIBUTING and `llms.txt`: v0.22.0 is the current stable release.
4. Commit, push, dispatch CI on the new head and wait for it:

```sh
gh workflow run CI --ref release/v0.22.0
FINAL=$(git rev-parse origin/release/v0.22.0)
gh run list --workflow CI --commit "$FINAL" --json event,conclusion,url
```

## 2. Merge into `master`

```sh
gh pr ready <release PR>
gh pr merge <release PR> --merge            # a regular merge commit, as #392
git fetch origin
MERGE=$(git rev-parse origin/master)
test "$(git rev-parse "$MERGE^{tree}")" = "$(git rev-parse "$FINAL^{tree}")" && echo "tree matches the verified commit"
```

## 3. Tag and GitHub release

```sh
git tag -a v0.22.0 -m "v0.22.0 — <title>" "$MERGE"
git push origin v0.22.0
gh release create v0.22.0 --verify-tag --latest --title "v0.22.0 — <title>" --notes-file <notes.md>
```

The release body becomes the website's release page at the next sync. Write it from the changelog section (a shorter
summary is fine) and link to the full CHANGELOG.

## 4. Verify the published source

In a shell started with `t7run zsh` (so `$T7_RUN_DIR` is a scratch directory on the T7):

```sh
mkdir -p "$T7_RUN_DIR/v022-archive" && cd "$T7_RUN_DIR/v022-archive"
curl -fsSL -o v0.22.0.tar.gz https://github.com/raiseCatError/notMyShell/archive/refs/tags/v0.22.0.tar.gz
shasum -a 256 v0.22.0.tar.gz                                   # the tap's sha256
tar -xOzf v0.22.0.tar.gz notMyShell-0.22.0/package.json | grep '"version"'   # "0.22.0"
mkdir src && tar -xzf v0.22.0.tar.gz -C src && cd src/notMyShell-0.22.0
npm ci && npm run build && node dist/index.js --version        # notMyShell 0.22.0, build <MERGE short sha>
```

## 5. Homebrew tap (`raiseCatError/homebrew-tap`)

The scheduled `brew bump` failed daily from 2026-10-13 to 10-17 (`depends_on "python"`); v0.20.0 was a manual PR (#3).
Do the same unless an autobump PR for 0.22.0 has already appeared and is correct:

1. Branch `nmsh-0.22.0`; in `Formula/nmsh.rb` set `url` to `…/archive/refs/tags/v0.22.0.tar.gz` and `sha256` to the
   value from step 4. Nothing else needs changing: every file v0.22 reads at runtime is in `dist`, and the formula's
   install list is unchanged since v0.20.
2. Open the PR; `tests.yml` (`brew test-bot`) must pass on macOS and Linux; merge (source-only formula, no bottles).
3. Locally: `brew update && brew upgrade raiseCatError/tap/nmsh && nmsh --version`.

## 6. Website

After the tap PR is merged (the sync records the tap's version, and the deploy checks it again):

```sh
cd website && npm ci
npm run sync:upstream -- --published v0.22.0 --version 0.22.0
npm test && npm run check && npm run build:launch && npm run test:browser
```

Open a PR into `master` with the result. Once it is merged, dispatch **Publish NMSh website** from `master` with the
confirmation `nmsh.raisecaterror.com`, approve the `nmsh-production` deployment, and check the live site.

## 7. After the release

- Close #429 with a comment pointing to the v0.22.0 release (its work is in it; never merge it). Delete nothing.
- The v0.22 PRs: once `dev` = `master`, each PR whose base is `dev` shows as merged; retarget #437 and #441 to `dev`
  first (their bases are #433's and #438's branches) so they do too.

- Smoke on the published build: a Homebrew install (`nmsh --version`, start in Ghostty, run a command, `/view
  README.md`, `/track df -h`, `/track stop`, `exit`) and a source install's `/update` (offers v0.22.0 as the latest
  stable release).
- Bring `dev` to `master`: `git switch dev && git pull --ff-only origin dev && git merge --ff-only origin/master &&
  git push origin dev` (`master` = `dev` after v0.20 too).
- Close the issues whose acceptance is met, with the physical results; keep partial ones open with the remaining
  scope (ledger, "Issues and PRs").

## Rollback

- **Before the tag:** nothing is public yet. A bad merge into `master` is reverted through a PR.
- **A bad release after publication:** fix forward with v0.22.1. A pushed tag may already be cached by Homebrew,
  GitHub's archive and users, so do not move or recreate it. Meanwhile:
  - `gh release edit v0.20.0 --latest` makes `/update` (it reads `releases/latest`) offer v0.20.0 again.
  - Mark v0.22.0 as a prerelease (`gh release edit v0.22.0 --prerelease`) so it is no longer offered.
  - Revert the tap PR (formula back to the v0.20.0 `url` and `sha256`) through a tap PR.
  - Website: revert its sync PR on `master` and dispatch the publish again (approval required), or roll the Pages
    project back to its previous deployment.
- **The tag points at the wrong commit and nothing has consumed it yet** (no release, tap or sync): delete it
  (`git push --delete origin v0.22.0`) and tag the verified merge commit. Otherwise fix forward.
