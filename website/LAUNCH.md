# v0.20 launch coverage and remaining gates

## Source checkpoint

This is the **v0.20 launch website**, not a v0.18 product site. The handbook and
technical references use public candidate commit
`15d776eeb242cda330bbe654efae7fbac744b58d`, the public onboarding checkpoint.
It includes stabilized Slice 3 at `825336393562a37cb5cdf9baf916e8d6d3bb4e6d`
plus production-wired Reactive Horizon. The pin is immutable rather than following
another agent's moving feature branch.
`src/data/launch.json` controls that baseline. Public releases and Homebrew availability
are independently recorded in `src/data/release.json`; no v0.20 publication is invented.

Read-only ancestry inspection, refreshed 2026-10-18, established that it includes:

| Source branch | Inspected commit |
| --- | --- |
| `release/v0.19.0` | `9e85a9100d1a377ccb3b270c99d98cbae0ff2605` |
| `stabilize/v0.19.0` | `1aeb05c0d569c06562e8fa9219eae3069686e0cd` |
| `release/v0.20.0` | `c71a42846da4a3832e578f3fb9c28f192510d08e` |
| `stabilize/v0.20.0` | `891ee5835b956952ae5c15e1929e8dab22908d7d` |
| `integration/post-v020-slice3` | `15cb52fef3e2f4397f67cb2a79fe2c9ca98c1feb` |
| `stabilize/post-v020-slice3` | `825336393562a37cb5cdf9baf916e8d6d3bb4e6d` |
| Public onboarding feature checkpoint | `15d776eeb242cda330bbe654efae7fbac744b58d` |

These are source checkpoints, not extra published releases or promises that every
proposal inside their historical documents is implemented. The user explicitly
includes cumulative integrated work in the intended launch scope; the final release
tag must be checked again rather than inferred from its name.

## Feature coverage inventory

“Integrated” below means inspected production code and corresponding regression
sources exist at the checkpoint. It does **not** mean this website task reran the
application suite or performed physical terminal acceptance. Recorded local
`verify:release` evidence is in `docs/development/slice-3-stabilization.md`; that
record identifies exact-head remote and physical checks separately. The onboarding
plan also records completed implementation checks and a benchmark cleanup failure
followed by a successful rerun. None establishes final released-tag physical acceptance.

| Capability | Integration and evidence at the checkpoint | Website coverage |
| --- | --- | --- |
| Persistent real zsh, Bash 4.4+, Fish; composer and semantic input | Integrated; `src/session/`, `src/shell/`, ShellAdapter architecture | Home, concepts, composer, completion, shells |
| Transcript, history, live sessions and resume | Integrated; runtime architecture, session interaction contracts | Transcript, sessions, architecture |
| Serial queue and input ownership | Integrated; `tests/queueControlsApp.test.ts`, `src/commands/slashCommands.ts` | Execution guide and command reference |
| Live timeline and queue settings | Integrated; `src/prompt/configuration.ts`: On, two recent/two upcoming, eight-second retention | Execution guide |
| Queued output folding | Integrated; `tests/queueOutputFolding.test.ts`; Inline default, optional Fold, reversible Ctrl+O | Execution and transcript guides |
| Queue summaries | Integrated; `tests/queueHistory.test.ts`, `tests/queueHistoryApp.test.ts`; fresh Recommended On, legacy omitted field Off | Execution guide; not executable restored work |
| Output selection and Copy Actions | Integrated Slice 3; `tests/outputSelectionApp.test.ts`, `tests/copyFolding.test.ts` | Transcript; bare `/copy` navigates, explicit latest/picker remain |
| Reviewed reports, Compare, pins, clips and paste review | Integrated; `src/ui/ReportReview.ts`, `src/ui/ComparePanel.ts`, `src/input/BatchReview.ts`, slash registry | Transcript, everyday usage, execution, command reference |
| Background tasks | Integrated; `tests/backgroundIntegration.test.ts`, `tests/backgroundSession.test.ts`, supervisor tests | Execution; separate PTY/output, no aliases/functions, service requirement |
| Managed Claude Code and native model/effort controls | Integrated beta; `tests/agentControlPlane.test.ts`, `src/agents/input/pickers.ts` | Integrations; requested versus observed state |
| Other agents and mods | Observation/inventory only; Codex adapter not frontend-wired; Claude plugin toggle gated | Integrations; no managed Codex/OpenCode parity claim |
| Worktrees and GitHub | Integrated; `tests/worktreeMutations.test.ts`, `tests/githubWorkspace.test.ts` | Integrations; staged navigation, non-forced removal, read-only GitHub |
| Workspace regions | Integrated experimental, Off by default; `tests/workspaceExperimental.test.ts` | Features and integrations; independent commands still work |
| Native modules and Context Packs | Integrated; `src/context/packs/builtin/`, context-module architecture | Context guide; more runtimes/build tools, no executable packs |
| Prompts, Theme Studio, Chroma and Theme Bridge | Integrated; prompt/theme ownership contracts | Prompts, themes, configuration, accessibility |
| Rerunnable Setup | Integrated; `src/setup/SetupCat.ts`, `tests/setupOrder.test.ts` | Setup guide; starting points versus full guided wizard |
| Reactive Horizon first run | Integrated into production app paths at public `15d776ee`; `tests/startupApp.test.ts`, `tests/startupEnding.test.ts` | Setup guide; four choices, reactive sky, transparency, real-composer ending and bounded host offer |
| Learn Mode | **Future proposal**, issue #398; not part of v0.20 code | Dedicated planned Learn page; isolation gates preserved |

## Onboarding integration boundary

An earlier audit at local `4efac992` correctly found only pure sky modules and the
old modal. That finding was superseded during website work: public `15d776ee` now
contains the actual renderer, `/startup`, bounded clock, guided restyle, Vespyr
compositing and real-composer ending. The website was repinned after inspecting
those production callers and tests, not merely the specification. No other branch
or worktree was merged, modified or pushed by this task.

The unified pin also includes fresh Recommended defaults: Rich motion, Chat,
Grayscale history, Session title and automatic typed queue summaries On. Legacy
partial saved objects retain historical fallbacks. Minimal starts Two-line and
keeps a quiet Flow/Normal setup. Exact behavior is in the curated Setup guide;
the canonical QA snapshot can contain historical notes that need final reconciliation.

At the final read-only check, the active local onboarding branch had advanced to
`efc02de7ff8814fb32e60c117d2fe46b35843727`, beyond its public `15d776ee` remote.
These newer follow-ups are **not** silently documented as part of the current pin:

- `6f8e9993`: first-run welcome for every choice, extra Keep Existing provider choices.
- `4edc8379`: fixed wizard frame and editor-return behavior.
- `0a37de9f`: unified optional-tools review/install flow.
- `720a40c5`: expanded custom-color editor and presets.
- `43cbbfd6`: installation-specific amber update notice.
- `f2f6a2d9`: unified selection glyphs.

The current public pin welcomes genuine first-run Recommended only; other Apply
paths produce a receipt. Optional tools are not detected or installed by the
starting-point selector at this pin. Those are specific follow-up checks, not a
reason to call the already integrated Horizon experience a future proposal.

## Required before publication

- [ ] Follow the manual-only publishing and post-launch link sequence in `README.md`.
  Keep the legacy GitHub Pages workflow disabled. Do not activate homepage, default
  README or About links until both the production website and `/docs/` are reachable.
- [ ] Review the newer onboarding follow-ups above when they become public and join
  the final release candidate. Reconcile welcome behavior, provider choices, tools,
  color controls, update notices, frame behavior and defaults against actual code.
  Horizon itself is already documented from production integration at the current pin.
- [ ] Verify the final candidate includes the cumulative capabilities above. Refresh
  with `npm run sync:upstream -- --candidate <public-ref> --version 0.20.0`, then
  review all source, guide, configuration/default and platform differences.
- [ ] Obtain exact-build application CI/release evidence and required physical QA.
  Website tests are not a substitute. Do not run captures as part of website work.
- [ ] Verify a real public, non-draft, non-prerelease v0.20.0 release and immutable
  commit, then run `npm run sync:upstream -- --published v0.20.0`. This fails closed
  if that release does not exist. Review actual notes, date, tag and SHA.
- [ ] Independently check the Homebrew formula. Only claim v0.20 Homebrew installation
  if it really points to that tag. Otherwise keep the discrepancy and pinned source
  instructions visible. Verify runtime/shell requirements and upgrade behavior.
- [ ] Reconcile remaining candidate/follow-up notices and this inventory against the final tag.
  Run `npm run check:upstream`, `npm run verify` and `npm run build:launch`.
- [ ] Human review of desktop/mobile composition, tab favicon and social thumbnail;
  approve domain/Cloudflare configuration separately. No merge or deployment is
  authorized by a green build.

Candidate builds are intentionally `noindex` and omit released software-version
structured data. The publication build gate rejects them. After verified promotion,
the shared metadata removes that candidate safeguard automatically; the 404 remains
`noindex`. Public release history stays actual historical publication data throughout.
