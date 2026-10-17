# v0.20 launch coverage and remaining gates

## Source checkpoint

This is the **v0.20 launch website**, not a v0.18 product site. The handbook and
technical references use public candidate commit
`825336393562a37cb5cdf9baf916e8d6d3bb4e6d` (`stabilize/post-v020-slice3`).
`src/data/launch.json` controls that baseline. Public releases and Homebrew availability
are independently recorded in `src/data/release.json`; no v0.20 publication is invented.

Read-only ancestry inspection on 2026-10-17 established that the checkpoint includes:

| Source branch | Inspected commit |
| --- | --- |
| `release/v0.19.0` | `9e85a9100d1a377ccb3b270c99d98cbae0ff2605` |
| `stabilize/v0.19.0` | `1aeb05c0d569c06562e8fa9219eae3069686e0cd` |
| `release/v0.20.0` | `c71a42846da4a3832e578f3fb9c28f192510d08e` |
| `stabilize/v0.20.0` | `891ee5835b956952ae5c15e1929e8dab22908d7d` |
| `integration/post-v020-slice3` | `15cb52fef3e2f4397f67cb2a79fe2c9ca98c1feb` |

These are source checkpoints, not extra published releases or promises that every
proposal inside their historical documents is implemented. The user explicitly
includes cumulative integrated work in the intended launch scope; the final release
tag must be checked again rather than inferred from its name.

## Feature coverage inventory

“Integrated” below means inspected production code and corresponding regression
sources exist at the checkpoint. It does **not** mean this website task reran the
application suite or performed physical terminal acceptance. Recorded local
`verify:release` evidence is in `docs/development/slice-3-stabilization.md`; that
record still identifies final exact-head remote and physical checks as outstanding.

| Capability | Integration and evidence at the checkpoint | Website coverage |
| --- | --- | --- |
| Persistent real zsh, Bash 4.4+, Fish; composer and semantic input | Integrated; `src/session/`, `src/shell/`, ShellAdapter architecture | Home, concepts, composer, completion, shells |
| Transcript, history, live sessions and resume | Integrated; runtime architecture, session interaction contracts | Transcript, sessions, architecture |
| Serial queue and input ownership | Integrated; `tests/queueControlsApp.test.ts`, `src/commands/slashCommands.ts` | Execution guide and command reference |
| Live timeline and queue settings | Integrated; `src/prompt/configuration.ts`: On, two recent/two upcoming, eight-second retention | Execution guide |
| Queued output folding | Integrated; `tests/queueOutputFolding.test.ts`; Inline default, optional Fold, reversible Ctrl+O | Execution and transcript guides |
| Queue summaries | Integrated; `tests/queueHistory.test.ts`, `tests/queueHistoryApp.test.ts`; automatic saving Off | Execution guide; not executable restored work |
| Output selection and Copy Actions | Integrated Slice 3; `tests/outputSelectionApp.test.ts`, `tests/copyFolding.test.ts` | Transcript; bare `/copy` navigates, explicit latest/picker remain |
| Reviewed reports, Compare, pins, clips and paste review | Integrated; `src/ui/ReportReview.ts`, `src/ui/ComparePanel.ts`, `src/input/BatchReview.ts`, slash registry | Transcript, everyday usage, execution, command reference |
| Background tasks | Integrated; `tests/backgroundIntegration.test.ts`, `tests/backgroundSession.test.ts`, supervisor tests | Execution; separate PTY/output, no aliases/functions, service requirement |
| Managed Claude Code and native model/effort controls | Integrated beta; `tests/agentControlPlane.test.ts`, `src/agents/input/pickers.ts` | Integrations; requested versus observed state |
| Other agents and mods | Observation/inventory only; Codex adapter not frontend-wired; Claude plugin toggle gated | Integrations; no managed Codex/OpenCode parity claim |
| Worktrees and GitHub | Integrated; `tests/worktreeMutations.test.ts`, `tests/githubWorkspace.test.ts` | Integrations; staged navigation, non-forced removal, read-only GitHub |
| Workspace regions | Integrated experimental, Off by default; `tests/workspaceExperimental.test.ts` | Features and integrations; independent commands still work |
| Native modules and Context Packs | Integrated; `src/context/packs/builtin/`, context-module architecture | Context guide; more runtimes/build tools, no executable packs |
| Prompts, Theme Studio, Chroma and Theme Bridge | Integrated; prompt/theme ownership contracts | Prompts, themes, configuration, accessibility |
| Rerunnable Setup | Integrated at the checkpoint; `src/setup/SetupCat.ts`, `tests/setupOrder.test.ts` | Setup guide; current full wizard and review/apply only |
| Reactive Horizon first run | **Not integrated into this checkpoint**; see below | Central status and Setup integration note; no invented controls |
| Learn Mode | **Future proposal**, issue #398; not part of v0.20 code | Dedicated planned Learn page; isolation gates preserved |

## Onboarding integration boundary

The active separate onboarding branch was inspected read-only at local commit
`4efac9925ee75fc5a0df1c5eb6387a352ae2ef68`. Its public remote was still
`13a47f8798df3d74c8b887426f6cdd794e20af5a`. Neither was merged or modified here.

At that local checkpoint, the four starting points and read-only Keep Existing
detector are wired into the existing static modal. Aurora moods, the sky renderer
and transparent Vespyr compositor have pure modules/tests, but no production sky
caller. Horizon layout, `/startup`, bounded runtime animation clock and ending into
the real composer are not yet integrated. Applying setup still immediately closes
the old modal. The branch's startup plan leaves these as Tasks 6 onward.

Its new defaults differ from the public baseline, including transcript style,
terminal title and automatic summary saving. Do not copy those defaults into current
guides until the final integration is inspectable. The product-facing site describes
integrated features confidently and keeps this uncertainty in a small status area,
not “coming soon” labels on every feature.

## Required before publication

- [ ] Inspect the final public integrated onboarding commit and verify Horizon,
  selection-reactive Aurora, Vespyr transparency, ending, controls and defaults.
  Replace the Setup integration note with the actual first-run flow; remove the
  temporary onboarding notice in Releases/Roadmap and machine-readable navigation.
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
- [ ] Reconcile remaining launch notices and this inventory against the final tag.
  Run `npm run check:upstream`, `npm run verify` and `npm run build:launch`.
- [ ] Human review of desktop/mobile composition, tab favicon and social thumbnail;
  approve domain/Cloudflare configuration separately. No merge or deployment is
  authorized by a green build.

Candidate builds are intentionally `noindex` and omit released software-version
structured data. The publication build gate rejects them. After verified promotion,
the shared metadata removes that candidate safeguard automatically; the 404 remains
`noindex`. Public release history stays actual historical publication data throughout.
