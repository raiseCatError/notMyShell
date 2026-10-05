# Context Engine

Canonical architecture for the [#305 program](https://github.com/raiseCatError/notMyShell/issues/305).
Status: first architectural proof, awaiting review; no packs or executable extension system shipped.
Audited base: `6adfe8524da79f071de886f5a3f97bd49074bc60` on
`feature/305-shared-discovery-foundation` (2026-10-05).

## Vocabulary and ownership

| Concept | Responsibility |
| --- | --- |
| Capability | A named trusted operation NMSh knows how to perform safely |
| Fact | One resolved contextual value with provenance, collection time, freshness, trust, sensitivity and persistence policy |
| Module | Presentation and visibility behavior built from facts |
| Context Pack | An installable **declarative** collection of modules |
| Context Engine | Capability resolution, facts, cache, policy and provenance |
| Surface Router | Determines where a module's contextual presentation appears |
| Context Rail | Contextual frontend surface attached to the composer |
| Main Prompt | Stable identity/navigation context |
| Right Context | Low-attention prompt-adjacent state |
| Status Strip | Persistent low-attention state; module routing is deferred |

```text
shell lifecycle / editor demand / explicit refresh
  → trusted core capability services → resolved facts
  → existing ContextModule definitions + user config
  → Surface Router → Main Prompt / Right Context / Context Rail
  → shared semantic segment painter → ScreenPlan regions
```

A pack requests `runtime.node.version`, never `execute: node --version`.
Core owns executable identity, filesystem access, permitted environment fields,
timeouts, output limits, cancellation, concurrency, cache, sanitization and network policy.
Declarative packs contain no shell, JavaScript, templates that evaluate code,
includes, executable paths, hooks or arbitrary argv. A future executable extension
tier would be separate and require a real sandbox/capability model. It is not part
of this implementation or implicitly authorized by installing a pack.

## Audit of the accepted foundation

- `ShellContext.ts` supplies `PromptContext`, Git, marker-based toolchains and
  root information asynchronously. `TerminalApp.refreshContext` rejects old cwd
  generations and resolves path abbreviations outside rendering.
- `configuration.ts` has a fixed, sound `ContextModuleId` registry with fields,
  demand, visibility, conditions, order, left/right placement and explicit colors.
  Evolve this registry; do not introduce an unrelated module framework.
- `prompt.ts` turns context into semantic segments; `powerline.ts` paints all
  Native styles and fits widths. Rich Git already has state roles, protected
  semantic colors, geometry, previews and archival fidelity. Keep those intact.
- `commandContext.ts` reads Kubernetes/Docker metadata and caches it. The accepted
  base's `get()` initiates work from `promptContext()` on render. This proof must
  split explicit demand refresh from read-only access. Readers use a 256 KiB limit, at most 16 explicit kubeconfig paths,
  non-symlink regular files (leaf symlinks and special files are refused); Kubernetes authentication `exec` entries are never run.
- `localDiscovery.ts` is the shared inventory: normalized PATH/home cache,
  coalesced requests, TTL, key cap, direct directories and bounded entry counts.
  `discoveredTools` is opt-in. Rendering consumes its snapshot, never scans.
  Detection is evidence, not permission to execute a discovered binary.
- The accepted base invokes `git` by PATH. This proof uses fixed OS Git, with a
  validated Homebrew Cellar installation preferred on macOS (Apple's Git is an
  xcrun shim). It supplies a narrow environment, disables global/system config,
  fsmonitor and hooks, and fails status closed on local filters, includes or
  worktree config. Root/branch are still available; unsafe/unknown status is
  omitted rather than fabricated as clean. Repositories using those config
  features lose Rich Git status until a safe capability policy is implemented.
  No project filter or hook is run merely to learn status.
- `/prompt` has Main Prompt, Rich Git and Chroma views, module ordering,
  visibility, placement and deterministic showcases. Extend it with a Rail view.
- Semantic themes, custom theme library, family accents, vibrance, Neutral text,
  Chroma, UI chrome and safe glyphs are existing systems. Reuse them.
- `ScreenPlan` owns render, hit test, viewport, cursor and PTY geometry. Status,
  notices, find and Keep Awake are frontend regions. Rail is another region,
  never a transcript line. Top/Bottom/Flow already have distinct geometry.
- Native submission snapshots store left/right semantic segments; session
  journals and `/copy` consume transcript state. Do not snapshot the live Rail.
- ShellSession and service sessions preserve real shell state across zsh, Bash
  and Fish. Raw/fullscreen passthrough suspends frontend drawing and receives
  the full terminal size. Rail follows that existing suspension.
- #304 owns appearance import, Theme Bridge and host cooperation. Its latest
  implementation comment reports #315 unmerged/unreleased, with physical QA
  pending. This program consumes the appearance/discovery foundation; it does
  not redo #304 or make a host enhancement mandatory.

## Security and privacy invariants

Entering an untrusted directory must never itself execute repository-controlled
code through NMSh context discovery. The real shell's explicitly user-configured
startup/hooks remain a separate trust boundary; NMSh must not add automatic trust.

Ordinary discovery never sources `.envrc`, startup files, themes or plugins;
executes project scripts, configuration-selected binaries or arbitrary PATH
discoveries; contacts the network; broadly inspects secrets; or interprets project
strings as terminal controls. Metadata is hostile even when Git returned it.

Modules receive values, not filesystem traversal, `child_process`, `process.env`
or network objects. Only trusted core services may perform I/O. Native rendering
and routing are synchronous, pure consumers. Background capability failure means
unknown/unavailable context, never permission to try arbitrary executables.

Every final fact-derived segment passes one display boundary that bounds input length before processing, neutralizes terminal
controls and bidi formatting controls, and limits terminal-cell width. Keep raw
identity/path data separate from display text; never use sanitized display text
as a filesystem path and never interpolate fact text into shell commands.

Facts carry `value`, `source`, `collectedAt`, `freshness`, `trust`, `sensitivity`,
`persistence`, and resolution cost (`cheap` or `bounded-async`). Unknown collection
time is represented as unknown freshness, not falsely labelled fresh.

Persistence classes:

- `snapshot-safe`: permitted in a future semantic command snapshot.
- `display-only`: permitted on live surfaces but excluded from snapshots.
- `never-store`: excluded from all snapshot/journal paths. Secret-class facts are
  excluded from presentation too, regardless of a contradictory persistence flag.

The trusted Git status service accepts only the existing contextual operations,
never PATH discoveries. It disables fsmonitor/hooks, ignores submodules, refuses
filter/include/worktree-config/partial-clone/promisor repositories for status,
and disables lazy fetching. This deliberately sacrifices status detail for those
repositories; branch/root may remain available. It never traverses submodules to
validate their executable settings. Broader Git support needs a separate audited
collector design.

Live value refresh preserves previously established sensitivity/persistence.
External-provider segments lack fact provenance: if any fact cannot be
snapshotted, external snapshot presentation fails closed; policy-filtered
metadata may remain. Native segments are filtered individually.

No live Rail aggregate is persisted. Existing prompt snapshots keep their current
shape and behavior for ordinary legacy context, with policy filtering before new
fact-backed segments enter snapshots. Future metadata captures only relevant,
policy-allowed facts. Live context is not automatically persisted presentation.

## First proof and evolution path

Adapt existing `PromptContext` into typed facts. Retain the legacy fields for
provider and history compatibility. Fact-backed modules read a restricted
projection of their declared inputs; no renderer resolves a fact. Explicit fact
metadata wins over legacy values, including a fact that must be suppressed.
The adapter is an evolution seam, not a second filesystem cache.

Extend each existing definition with stable id, required fact/capability ids,
priority, supported/preferred surfaces, icon semantics and a bounded width policy.
Visibility conditions, user order and explicit colors remain in current config.
Do not invent a general-purpose expression language or field SDK in this proof.

The first named capabilities describe existing collectors only. A registry entry
does not confer authority to run anything; future capability implementations must
declare exact policy and be audited in core. A general async scheduler, dynamic
capability installation and complete legacy fact migration are later work.

Rich Git remains the existing semantic renderer. It can eventually consume
`workspace.git.status` facts with field demand and provenance. Its state segments
stay grouped as one module for Rail priority fitting. Do not rewrite its glyphs,
colors or historical representation in this slice.

## Placement and migration

Choices: Auto, Main Prompt, Right Context, Context Rail, Hidden. Status Strip is
an architectural destination only; expose it after real module presentation exists.

Keep legacy `placement: left | right`. An absent new surface preserves that
placement exactly (absent placement still means left). Explicit surface overrides
legacy placement; explicit Auto uses the definition's preference. Hidden suppresses
presentation and resolution demand, without discarding the visibility condition.
No migration turns an existing module into Auto or Rail. Existing saved order,
conditions, colors and left/right segments remain authoritative.

Auto preferences are core definition data: identity and Git stay Main Prompt,
low-attention shell/inventory prefer Right Context, command contexts prefer Rail.
Auto does not bounce modules between surfaces under width pressure in this proof.
Each surface applies bounded fitting independently.

## Context Rail

New defaults: Auto, one content row, Vertical, Outside, Gap, Follow Main
direction/theme/style, Prompt Level divider, Priority overflow. Existing valid
saved Rail settings preserve their geometry, including legacy Attached spacing.
Modes: Off paints/reserves nothing; Auto reserves no row without visible routed
content; Always reserves the configured one or two rows even when empty. Auto
reserves the configured row count once content exists, so fitting does not cause
height jitter. On tiny screens the transcript/input win and the Rail may be clipped.

Vertical Rail attaches immediately above Bottom/Flow, and below the Top
composer group (after suggestions). Presentation controls can instead place a
separate Rail rectangle Right of Prompt; this never reroutes facts to Right
Context. Right Context retains its far-edge anchor and independent module routing.
The composer remains anchored in docked layouts. Horizontal composition
reserves editor cells through the same measured layout used by cursor and hit testing.

Flow ordinarily consumes view space above its composer. Empty/short Flow may
shift downward only by missing visible composition height. This includes actual
content rows, explicitly configured spacing and a relocated horizontal outer edge; Rows
still means one/two content rows. Off and empty Auto add no height. Growing
transcript restores the normal anchor. Vertical Flow never falls below the input.
FOLLOW uses actual visible transcript capacity, preserving newest output.
Detached clipping never changes reserved PTY capacity or resets to FOLLOW.

The canonical presentation refinement is [context-rail-composition.md](context-rail-composition.md).
It defines independent Relation, Direction, Integration, Spacing and Divider
Anchor settings, deterministic constraints, shared live/preview projection and
config defaults preserving earlier geometry. Facts, demand, collection, routing,
provenance and transcript policy are unchanged by this refinement.

The Rail is Native module presentation. External providers and Prompt None do not
gain a second prompt; their Rail is suppressed, with settings retained for returning
to Native. Fullscreen/raw passthrough, panels and idle screens own their screens
normally and hide Rail along with other frontend chrome.

`/prompt` Rail controls: Mode, Rows, Relation, Direction, Integration, Spacing,
Divider Anchor, Theme (Follow Main / Choose theme), Style
(Follow Main / Soft / Minimal / Compact), Overflow (Priority). Choosing theme uses
the existing bundled/theme-library palette resolution, including custom theme ids.
Theme/style changes are pure mappings; never trigger probes. Explicit module
colors, semantic Git states, NO_COLOR and safe glyph modes remain authoritative.
Share the segment painter and existing style profiles. Arbitrary content row
counts, second Chroma settings and dashboard widgets remain deferred.

Fitting groups all segments of a module. Higher-priority modules enter first;
ties use saved order. Try normal then existing compact padding/gap geometry before
dropping lower-priority modules. At extreme widths compact/truncate the highest
priority group through the existing fitter. At most configured rows; never arbitrary
wrapping. This proof uses static priorities, not a new priority configuration UI.

Show-on-command remains deterministic token matching over editor text. Lifecycle
and editor updates request needed cached metadata outside rendering; rendering
applies visibility again, so a late result cannot display after its trigger vanishes.
No periodic Rail timer or extra inventory scan is introduced.

## Declarative pack direction

A future bounded local pack manifest contains schema version, stable pack id and
version, provenance/license, required named capabilities and declarative module
records. Records reference registered facts, bounded literal labels, existing
semantic roles/icons, supported conditions, surface preferences and width policy.
They contain no code, user-selected executable path, arbitrary argv, templates,
includes or network URLs evaluated during rendering. Schema evolution and unknown
capabilities fail gracefully rather than falling through to shell evaluation.

Registry/recommendation is separate from rendering and resolution. Recommendations
explain proven local evidence and never install, enable a module or select a
provider automatically. Built-in packs ship their runtime data with NMSh. A future
explicit download flow pins pack id/version and exact content hash, verifies
integrity before activation, records source and license, and stages atomic installs
and removal. A checksum proves pinned bytes, not author trust; publisher/signature
and trust-root decisions still require review under #318. No registry transport or
networking is implemented in the first proof, and ordinary context rendering never
needs upstream availability. Preserve GPL-3.0-only and file-level provenance/notices
for any adapted implementation, test, generated data or icon.

## First-proof implementation sequence

1. Preserve the standalone approved Tools checkpoint and branch from its exact head.
2. Establish the canonical design, continuation protocol and #316–#321 dependencies.
3. Test old configs, surface choices and ordinary prompt/snapshot fidelity; extend
   existing configuration and definitions without default relocation.
4. Test hostile displays and persistence; add resolved-fact adapters and pure routing.
5. Test Rail modes, geometry and overflow; share the semantic painter and ScreenPlan.
6. Test collector isolation, fake executables, unsafe Git config, bounded/symlink
   metadata and late command results; move demand outside rendering.
7. Extend `/prompt`, test theme/glyph/color behavior, run focused/canonical checks,
   reproduce base failures and measure pure rendering. Keep the review tree uncommitted.

## Cache and performance direction

Keep the shared local discovery cache; do not clone it. Cwd generation prevents
old asynchronous completion from replacing current workspace facts. Command
metadata keeps a five-second cache refreshed on explicit demand events. Cheap
shell/editor facts are projected from memory. Disabled/hidden command modules do
not request readers. Renderer work is bounded by the small fixed registry and
sanitized values; Rail fitting is bounded by ten modules and two rows.

Future capability cache keys include session, canonical workspace, selected
non-secret environment fields, trusted executable identity and requested fields.
Invalidation: cwd/session change, command completion, settings change, explicit
refresh and capability TTL. Core must cap concurrency, coalesce requests, cancel
stale generations, bound every read/probe and disclose stale/unknown states.
Network capabilities, if approved later, always resolve asynchronously with visible
policy and never enter the ordinary synchronous render path.

Measure pure warm rendering separately from cold collection and shared-discovery
cost. Do not enforce flaky elapsed-time assertions in functional tests. A budget for
expanded catalogs requires evidence on slower machines before setting a hard limit.

## Test and delivery gates

Use hostile temporary workspaces containing fake executables, executable-looking
`.envrc`/theme/scripts, Git hooks/fsmonitor configuration, huge/malformed metadata,
symlinks and kubeconfig `exec`. Assert no sentinel execution, no network and no
secret presentation/persistence during collection plus repeated rendering. Expand
these fixtures as each new parser/capability ships; do not write future pack parsers now.

Validate migration/default fidelity, both legacy placements, all Rail modes/rows,
Top/Bottom/Flow, width/priority, NO_COLOR/safe glyphs, follow/chosen themes,
show-on-command, pure render reads, inventory reuse, Rich Git and `/tools` regressions.
Run focused checks, build/typecheck, verify:fast and the canonical suite. Reproduce
failures against an untouched accepted base before classifying them as base/environment.
Automated tests never constitute physical Ghostty or terminal/mux QA.

This branch stays uncommitted for the requested review. Do not merge, publish,
release, bump version, regenerate media or touch the separate showreel worktree.
Continuation follows [the agent protocol](../development/context-engine-agent-protocol.md).
