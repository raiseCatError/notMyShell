# Release workflow

How a release is checked, packaged and published by `.github/workflows/release.yml` and `scripts/release/`. The
merge, tag and tap steps keep the shape of the [v0.22 runbook](v022-release-runbook.md); this workflow makes the
checkable parts repeatable. **Publishing needs the maintainer's go-ahead** and an approval of the `nmsh-production`
environment.

NMSh is released as source: an annotated tag `vX.Y.Z` on the `master` merge commit and a GitHub Release carrying the
source archive and checksums. `package.json` is `private` (no npm publish). The Homebrew tap formula builds from the
tag archive with `npm ci` and the node-pty native addon, so **no standalone or portable binaries are offered**.

## Pieces

| Script | What it does |
|---|---|
| `prepare.mjs` | Rules and checks: version consistency, refs, QA gate, duplicates, build, typecheck, `test:fast`, `npm audit --omit=dev`. Writes `provenance.json` and `release-notes.md`, prints a BLOCKERS list. |
| `package.mjs` | `git archive` of the exact commit into `nmsh-X.Y.Z-source.tar.gz` (prefix `notMyShell-X.Y.Z/`), then `SHA256SUMS`. The same commit gives the same bytes. |
| `verify-artifact.mjs` | Verifies `SHA256SUMS`, extracts into an isolated directory, mimics the formula (`npm ci`, `npm run build`, `npm prune --omit=dev`), runs `nmsh --version` and a node-pty spawn, all with a private `HOME`/`XDG_*`. |
| `check-ci.mjs` | Publish gate: `Verify (22.x)` and `Verify (26.x)` succeeded on the exact commit, plus a successful `workflow_dispatch` CI run (Fedora and the timing smokes run only on dispatch). |
| `publish.mjs` | Annotated tag at the commit, DRAFT release, assets, re-download and verify, then publish. |
| `homebrew.mjs` | Rewrites `url` and `sha256` only in the tap formula; optionally opens the tap PR. |
| `lib.mjs` | The pure rules; tested in `tests/releaseWorkflow.test.ts`. |

The physical QA gate is a machine-readable file, `docs/releases/vX.Y.Z-qa.json`:

```json
{"version": "0.24.0", "rows": [
  {"id": "ghostty-first-run", "status": "pass"},
  {"id": "kitty-graphics", "status": "waived", "reason": "no Kitty on the QA machine; maintainer accepted"}
]}
```

Every row must be `pass`, or `waived` with a reason. `fail`, `pending` or a missing file blocks. A `pending` row is only a warning for
`candidate`, not for `publish`. The release notes state the QA result and any waivers. The prose record stays in
`docs/testing/`.

## Modes

- **dry-run** (default; also what a pull request touching the release files runs): reports every blocker and
  continues. Exit code 0 unless the script itself breaks. Nothing is created.
- **candidate**: like a dry run, but exits non-zero on hard blockers. An `Unreleased`/candidate changelog heading
  and `pending` QA rows are warnings.
- **publish**: any blocker stops it. Needs the commit to be `master`'s head, the confirmation `publish vX.Y.Z`, a dated
  changelog section, a complete QA file, passing checks and the CI gate.

## Run it

Locally (scratch on the T7; this only reads GitHub):

```sh
t7run node scripts/release/prepare.mjs --version X.Y.Z --mode dry-run --out "$T7_RUN_DIR/rel"
t7run node scripts/release/package.mjs --version X.Y.Z --out "$T7_RUN_DIR/rel"
t7run node scripts/release/verify-artifact.mjs --version X.Y.Z --dir "$T7_RUN_DIR/rel"
```

`prepare` needs a clean tree with `HEAD` at the commit. `--skip-checks` and `--offline` exist for dry runs only.

In GitHub: **Actions → Release → Run workflow** from `master`, with `version`, `commit` (empty = the ref's head;
publishing needs `master`'s head), `mode` and, to publish, `confirmation` = `publish vX.Y.Z`. The `prepare` job
checks, packages and verifies; the `publish` job (only for `mode=publish` on `master`) waits for the `nmsh-production`
approval, then re-checks duplicates, tags, drafts, uploads, re-downloads, verifies and publishes. The `homebrew` job
builds the formula from GitHub's tag archive and opens the tap PR `nmsh X.Y.Z` only if the `HOMEBREW_TAP_TOKEN`
secret exists; otherwise it uploads the `nmsh-formula` artifact and says what to do. It never merges and never
publishes bottles. The tap's own `tests.yml` runs on that PR, and the maintainer dispatches the tap's `publish.yml`.

Order for a release: finish the release PR into `master` (see the runbook), dispatch CI on its merge commit, run this
workflow as a dry run, fix blockers, then publish. The website sync PR and the manual **Publish NMSh website** run stay
separate and are not triggered here.

## Failure recovery

**CI fails or is missing.** `check-ci` names the missing check. Fix on the release branch, merge, dispatch CI on the
new `master` head and rerun. Nothing was created.

**Packaging or `prepare` fails.** Nothing public exists. Read `logs/` in the uploaded `nmsh-release` artifact (or the
local `--out` directory), fix, rerun. A `provenance.json` for another commit is refused by `package.mjs`; rerun
`prepare` for this commit.

**An asset cannot be verified.** If `verify-artifact` fails, it is before publishing: fix and rerun. If `publish`
reports the re-downloaded assets do not verify, the release is still a **draft**: nothing is public. Rerun the
workflow; it resumes the draft and uploads with `--clobber`. If it keeps failing, delete the draft in the GitHub UI
and rerun; keep the tag.

**The GitHub Release fails partway.** The tag may exist and a draft may be left. A tag that was pushed is **never
moved or deleted** (Homebrew, GitHub's archive and users may have it). Rerunning with the same version and commit
resumes: a tag at the same commit with no release or only a draft is reused. If the tag is at a different commit,
the workflow refuses; fix forward with the next patch version. Only when the tag points at the wrong commit and nothing
(release, tap, website) has consumed it may the maintainer delete it by hand, as in the runbook's rollback section.

**The Homebrew PR fails.** The release is already public. Rerun only the `homebrew` job, or use the `nmsh-formula`
artifact by hand. If branch `nmsh-X.Y.Z` already exists without a PR, open the PR from it (or delete the branch and
rerun). If the tap's `tests.yml` fails, fix the formula in the tap PR; `homebrew.mjs` only changes `url` and `sha256`.

**The release already exists.** `prepare` and `publish` refuse with `release-exists`. This is correct: never overwrite a
published release. To fix its text, `gh release edit`; to fix its contents, publish the next patch version.

**A local install fails after switching.** Source install: `npm ci && npm run build` in the checkout, then check
`nmsh --version`. Homebrew: `brew update && brew upgrade raiseCatError/tap/nmsh`, then `brew reinstall` if the
native addon is stale. To go back, use the runbook's rollback (`gh release edit vPREVIOUS --latest`, prerelease flag on
the bad one, revert the tap PR).

## Known limits

- A tarball build reports `build unknown`; it has no Git history. The tag archive Homebrew uses is GitHub's own and
  is not byte-identical to the attached archive; its checksum is computed after tagging.
- `npm audit` findings are reported in `provenance.json` and the logs but do not block by themselves.
- The workflow's `uses:` are pinned to commit SHAs, matching `website-deploy.yml`.
