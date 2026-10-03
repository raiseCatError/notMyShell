# v0.14 polish and customization acceptance

Tracking issue: [#291](https://github.com/raiseCatError/notMyShell/issues/291).
Package and lockfile remain **0.7.0**. The polish PRs are **open and
unmerged**. Physical QA is **pending** (see [v014-physical-qa.md](v014-physical-qa.md)).
No tag, release, force push or history rewrite was performed.

## Integration of the v0.13 stack into `dev`

The 49-PR development chain (#193 → … → #290) was verified before any
mutation. Every PR was open, non-draft and mergeable, every base was its
predecessor's head (#193 based on `dev`), and ancestry was linear. The #290
tree (`3b884a1`) passed the full local suite, build, typecheck, benchmark
typing, `git diff --check` and the leak checks. Its four CI lanes were green.

The stack was collapsed top-down with normal merge commits:
#290, #287, #286, #285, #283, #282, #280, #278, #277, #275, #273, #271, #269,
#268, #267, #266, #265, #264, #263, #262, #261, #260, #259, #258, #257, #256,
#255, #254, #183, #181, #182, #251, #250, #249, #248, #247, #246, #245, #244,
#241, #240, #239, #238, #237, #236, #235, #234, #233. There were no conflicts.
The collapsed #193 head (`75c0a59`) has a tree identical to #290's (`4b7ba6e`).
After macOS and Ubuntu on Node 22 and 26 passed, #193 merged into `dev` as
`401a95c1bca6b77328023f5f413f9d5e04dd0e26`.

Excluded and left untouched: #226 and #227 (dependency bumps), #270 (closed,
superseded), #288 (already merged docs snapshot) and #289 (closed, superseded).

## Polish stack (from `dev` 401a95c)

| Order | PR | Branch | Head |
| --- | --- | --- | --- |
| 1 | [#292](https://github.com/raiseCatError/notMyShell/pull/292) | `feature/v014-composer-zed` | `1a1b85032c397cfc659506ebdbbafaba46be423e` |
| 2 | [#293](https://github.com/raiseCatError/notMyShell/pull/293) | `feature/v014-prompt-chroma` | `1fdabd34ac477c32680dcf683db2d8a9bf01a97b` |
| 3 | [#294](https://github.com/raiseCatError/notMyShell/pull/294) | `feature/v014-panels-completion` | `34e1b7a8947a196e0c9cf7fe825a1e05e80912bc` |
| 4 | this PR | `docs/v014-polish-acceptance` | (this commit) |

CI (macOS and Ubuntu, Node 22 and 26) passed on #292 and #293. On #294 the
first Ubuntu Node 26 attempt stalled after the test runner reported
`completionV2.test.ts` and hit the 10-minute job timeout; no test had failed.
The same commit passed the other three lanes, and its re-run passed all four.
The stall was not reproduced and its cause is not identified; it is recorded
here rather than treated as resolved.

## What changed

- **Zed:** profile from `TERM_PROGRAM=zed`/`ZED_TERM` enabling SGR
  `?1000`/`?1006` wheel and click reporting with Shift selection. No movement
  tracking; truecolor from `COLORTERM`; hyperlinks opt-in. No window adapter,
  because Zed documents no API for opening a command in a new integrated
  terminal. `/appearance` says "Appearance is configured by Zed."
- **Composer history:** Up/Down recall over a bounded snapshot of the
  existing history index (privacy filters and deletions apply).
  Multiline-aware, the draft is restored, nothing runs until Enter, and
  menus and panels keep their keys.
- **Prompt:** seven styles (Powerline, Soft, Minimal, Outline, Breadcrumb,
  Compact, Ribbon) with per-style profiles, plus vibrance and twelve themes.
  See [prompt-customization.md](../architecture/prompt-customization.md).
- **Chroma v2:** eleven palettes, theme-aware Current Theme, influence,
  scope, five motions with speed, ramp and direction, a custom gradient
  editor, and `/chroma`. Live previews use the real renderer and the shared
  clock.
- **Effects:** confetti on real milestones (confirmed installs, `/update
  apply`, finished first-run tool setup). It waits for panels to close and
  is suppressed by Milestone effects Off, Reduced Motion or Effects Off.
  Manual `/effects` keeps sparkles and rain and adds confetti.
- **/transcript:** Output folding (the same root value as Config), with a preview.
- **/tools:** grouped categories, aligned status badges, a selection band, a
  muted description, and the shared footer.
- **Provider installs:** curated Homebrew formulas. Fastfetch, Macchina,
  Atuin, fzf, Television and zoxide work on macOS and on Linux with Homebrew;
  Deja (fixed tap) is macOS only. Neofetch is legacy and not installable.
  Zigfetch and Powerlevel10k have no curated install and get factual
  messages. Linux without Homebrew is told so; no distribution packages are
  guessed, and nothing uses sudo or install scripts. After a confirmed,
  re-detected install the provider is selected automatically.
- **Completion:** semantic identity and icons, `_`/`__` helper filtering, a
  ten-row viewport with a cue, a selection band, descriptions (alias and
  function bodies never printed; man-page NAME read from disk, never
  executed), and frecency ranking from eligible history.

## Config migration

All changes are additive. Powerline settings keep their fields. Missing style
profiles are seeded from the legacy gap/spacing, so upgraded Soft, Minimal
and Outline prompts render unchanged. Missing vibrance is Standard, which is
the identity. Chroma v2 fields default to the pre-v2 timing; influence is the
existing `intensity`, so 0.65 reads as Mixed. Original theme ids are
unchanged. Unknown fields survive saves, and the hardened unreadable-config
behavior is untouched.

## Local verification (top of stack)

On `34e1b7a`: canonical suite 963/963 plus the 8-test benchmark suite pass;
build, typecheck, benchmark-script typing and `git diff --check` pass. No NMSh
helper processes leaked, and the runner's owned temp root reported no
`nmsh-*` leftovers. Free disk at completion: about 12 GiB.

## Known limitations

- The one-line (inline) prompt layout shows the static Chroma frame; the
  animated treatment runs on the two-line prompt row and in previews.
- On hosts without mouse reporting (baseline, e.g. Terminal.app), a host
  setting that turns wheel scrolling into arrow keys makes the wheel walk
  command history.
- Zed OSC 8 hyperlinks and Shift-selection behavior are unverified pending
  physical QA.
- The native-suggestion 100k-history benchmark once measured p95 63.6 ms
  against its 60 ms ceiling under full-suite contention locally (untouched
  code); it passes alone and in CI.
