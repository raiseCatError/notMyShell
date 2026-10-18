# First-run onboarding design archive (October 2026)

The complete design exploration behind NMSh's first-run onboarding: three
directions, the reactive variant that was approved, the runnable prototypes
that produced every capture, the review pages, motion clips and benchmarks, and
the static modal they replaced. These are archived experiments kept for
reference and reuse. Nothing here is a production dependency, and nothing here
is compiled or tested with the product (`tsconfig.json` covers `src/` only).

![Approved direction: reactive Horizon](reference/approved-recommended.png)

## What was decided

| Direction | Status | Idea |
| --- | --- | --- |
| **Reactive Horizon** | **Approved for production, 2026-10-17** | A real Aurora sky above a luminous horizon where Vespyr stands; four starting points in one list, the highlighted one a powerline segment pointing at its details. The sky's mood follows the highlighted choice: vivid, calm night, spectrum, or gone for Keep Existing. |
| First Prompt's ending | **Approved, combined with Reactive Horizon** | After Apply, setup folds away into the real transcript and composer; a receipt line, and on a genuine first run with Recommended, the welcome. |
| Horizon (static sky) | Preserved alternative | Reactive Horizon without the mood changes. |
| Stage | Preserved alternative | One full page per starting point with a tall Aurora window as its lighting, paged with ←→. |
| First Prompt | Preserved alternative | No setup screen: a `/startup` card in the transcript, with the real composer previewing each choice live. |

The production design and its acceptance criteria are in
[`docs/design/first-run-startup.md`](../../first-run-startup.md).

## Where everything is

| What | Where |
| --- | --- |
| This folder (version-controlled) | Prototype source, review page source, tools, manifest, 13 reference images |
| Durable archive (T7 Shield, exFAT) | `/Volumes/T7 Shield/NMSh Design Archive/first-run-onboarding-2026-10-17/` — every capture, clip, page and log, the superseded implementation and a Git bundle |
| Original working directory (left intact) | `/Volumes/T7Tmp/ai-dev/qa/post-v020-preferences-onboarding/design-concepts/` |
| Published review (private) | https://claude.ai/artifact/JJ7YawnLpvXXDGaRCPRPUr |

The binaries stay out of Git because Git LFS is not set up for this
repository. [`MANIFEST.sha256`](MANIFEST.sha256) records the SHA-256 of every
file in the durable archive; [`INVENTORY.md`](INVENTORY.md) lists them by kind.

## Provenance

- Repository `raiseCatError/notMyShell`, branch `feature/post-v020-preferences-onboarding`.
- The prototypes import NMSh's own modules (the Aurora engine, `CellGrid`,
  Vespyr's pixels, the prompt renderer, theme chrome, `TerminalRenderer`,
  `KeyDecoder`) as they were at commit
  `13a47f8798df3d74c8b887426f6cdd794e20af5a`, the commit the review was made from.
- Captures: VHS 0.12 (xterm.js in headless Chrome), JetBrainsMono Nerd Font Mono
  18 px, line height 1.15, the NMSh demo theme (`#15141c` background). Stills
  use `--freeze 4200`; clips are real key presses at 24 fps.
- Benchmarks (`captures/bench.jsonl` in the durable archive): the production
  `TerminalRenderer`'s row diffing, 120 frames per case.
- Review and approval: 2026-10-17.

## Run the prototypes

They run against a checkout pinned at the provenance commit, so later product
changes cannot alter them. Prepare it once (a detached worktree under the T7's
disposable worktree root; `npm ci` runs through `t7run`, so caches stay on the T7):

```sh
t7run bash docs/design/archive/first-run-onboarding-2026-10/tools/prepare-pinned-checkout.sh
```

Then, in a real terminal:

```sh
cd docs/design/archive/first-run-onboarding-2026-10/prototypes
t7run bash run.sh --concept horizon --reactive   # the approved direction
t7run bash run.sh --concept horizon              # static sky
t7run bash run.sh --concept stage
t7run bash run.sh --concept prompt               # First Prompt
t7run bash run.sh --concept sky                  # Aurora mood comparison
```

Keys: each direction's own arrows, `1`–`4`, `Enter`, `Esc`, `A` Aurora on,
subtle or off; prototype extras `T` next theme, `R` Reduced Motion, `q` quit.
Flags: `--backdrop subtle|off`, `--theme ocean`, `--nocolor --safe`,
`--case starship|multi|custom` (Keep Existing evidence), `--screen
review|confirm|customize|welcome|quiet|kept|left`, `--choice 1-4`, `--layout
twoLine|oneLine`, `--reduced`, `--frame --cols N --rows N --time MS` (print one
frame and exit). Keep Existing evidence is a fixed fictional sample; the
prototypes read nothing from the machine and write no configuration.

To point at another checkout (for example a clone of the archived bundle), set
`NMSH_SRC=/path/to/checkout` with its `node_modules` installed.

## Re-capture and rebuild

```sh
cd docs/design/archive/first-run-onboarding-2026-10/prototypes
t7run node capture.mjs horizon             # every still for a direction (horizon, stage, prompt, reactive)
t7run node capture.mjs reactive --clip     # its motion clip
t7run node build-embedded.mjs horizon,stage,prompt,reactive   # self-contained review page
```

Captures go to the run's T7 scratch directory (or `CAPTURE_DIR`); the
self-contained page reads `review.html` and `captures/` from the durable archive
(or `REVIEW_ROOT`). `review.html` itself shows its images when opened beside a
`captures/` folder, as it is in the durable archive.

## Differences from the original working copy

Only path handling changed; every other file is byte-identical:

- `proto/src.ts` loads the NMSh modules from `NMSH_SRC` instead of absolute
  paths into the feature worktree.
- `run.sh` defaults `NMSH_SRC` to the pinned checkout and checks it is prepared.
- `capture.mjs` writes to T7 scratch or `CAPTURE_DIR`, and passes `NMSH_SRC` into VHS.
- `build-embedded.mjs` reads from the durable archive or `REVIEW_ROOT` and writes to T7 scratch.

With a still sky (`--reduced`), the archived copy renders frames identical byte
for byte to the original for the nine states checked; animated frames depend on
the moment they are sampled.

## Check the durable archive

```sh
bash docs/design/archive/first-run-onboarding-2026-10/tools/verify-t7-archive.sh
```

It re-hashes every file against `MANIFEST.sha256` and changes nothing. macOS
stores each file's `com.apple.provenance` attribute in an AppleDouble `._` file
on exFAT; those are filesystem metadata and are not in the manifest. Finder's
`.DS_Store` was not copied.

## The superseded implementation

The static centered modal and the earlier animated introduction it replaced
remain in Git history at `13a47f8`. The durable archive also keeps:

- `superseded/source-13a47f8/` — the onboarding source, tests, preview script
  and docs exactly as they were at that commit;
- `superseded/static-modal-captures/` — that modal's renderer captures and the
  script that produced them;
- `superseded/notMyShell-13a47f8.bundle` — the repository history up to that
  commit (`git clone notMyShell-13a47f8.bundle`), independent of any remote.

`tools/create-t7-archive.sh` is the record of how the durable archive was built.
