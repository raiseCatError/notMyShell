# Context Engine

Canonical architecture for the [#305 program](https://github.com/raiseCatError/notMyShell/issues/305)
and its focused issues (#316 kernel and fact model, #317 Surface Router and Rail,
#318 Context Packs, #319 project/runtime catalog, #320 DevOps/cloud/system/agent
context, #321 security, performance and QA). User-facing guide:
[Context Modules](../architecture/context-modules.md).

Status: v0.17.0 shipped the foundation (fact metadata, module routing, Context
Rail). The capability scheduler, first-party catalog, declarative packs, Status
Strip routing and agent context described here are on the development line
after v0.17.0 and unreleased.

## Vocabulary and ownership

| Concept | Responsibility |
| --- | --- |
| Capability | A named trusted operation NMSh core implements and audits (`src/context/capabilities/`) |
| Fact | One resolved value with provenance, collection time, freshness, trust, sensitivity, persistence policy and cost (`src/context/facts.ts`) |
| Context Engine | Demand, scheduling, cache, cancellation, timeouts and policy (`src/context/engine.ts`) |
| Module | Presentation and visibility behavior built from facts: native built-ins and pack modules (`src/context/modules.ts`, `declarative.ts`) |
| Context Pack | Installable **declarative** module data (`src/context/packs/`) |
| Surface Router | Where a module appears (`src/context/surfaceRouter.ts`) |
| Main Prompt / Right Context / Context Rail / Status Strip | Presentation surfaces |

```text
shell prompt marker (cwd, exit, job count, allowlisted environment)
  / editor demand (show-on-command words) / explicit refresh / command completion
  → ContextEngine.stage(scope) + demand(capability → fields)
  → scheduled capability resolution (core I/O only) → sanitized facts
  → commit (the new scope becomes visible together)
  → modules (native + declarative) → Surface Router
  → shared semantic segment painter → ScreenPlan regions
```

A module requests `runtime.node.active`, never `execute: node --version`. Core
owns executable identity, filesystem access, permitted environment fields,
timeouts, output limits, cancellation, concurrency, cache, sanitization and
network policy (there is none: no capability uses the network). Declarative packs
contain no shell, JavaScript, code-evaluating templates, includes, executable
paths, hooks or argv. An executable extension tier would need a real sandbox and
capability model; it is not part of this design and installing a pack never
implies it.

## Capabilities and facts

A capability (`defineCapability`) declares: id and title; what it **reads**
(shown verbatim in `/prompt` details and `nmsh packs inspect`); scope
(session, workspace, user, machine); family (metadata, probe, system, agent) and
cost; trust; sensitivity and persistence, with optional per-field policies; the
fields it can resolve; the environment variables it may see; cache lifetime,
optional refresh interval for time-based values, timeout and invalidation
events; and a deterministic synthetic preview (`PREVIEW_NOW`). `resolve()`
receives only its scope, the demanded fields, its declared environment and an
abort signal.

Facts carry `value`, `source` (capability and evidence), `collectedAt`,
`freshness`, `trust`, `sensitivity`, `persistence`, `resolution` (cost) and an
optional `fieldPolicy`. `sanitizeFactValue` is the single value boundary
(controls, bidi, prototype keys, functions and size); `projectFactValue` removes
fields a purpose may not see (`display` versus `snapshot`); `safeContextText` is
the single display boundary. Unknown collection time is unknown freshness, never
"fresh".

Persistence classes:

- `snapshot-safe`: may enter a command's prompt snapshot.
- `display-only`: live surfaces only; excluded from snapshots, journals and exports.
- `never-store`: excluded from every snapshot/journal path. Secret-class facts are
  excluded from presentation too, regardless of a contradictory persistence flag.

The legacy `PromptContext` (cwd, project, root, branch, Rich Git, marker-based
toolchains, Kubernetes, Docker, discovery inventory) is adapted into typed facts
(`promptFacts`) so providers, history and Rich Git keep working; engine facts win
where both exist (Kubernetes and Docker are engine-backed with the legacy readers
as fallback), and explicit metadata — including suppression — always wins.

### Shell-reported environment

Capabilities see the **live shell's** environment, not NMSh's launch
environment: each zsh, Bash and Fish prompt writes an `envsnapshot 1` block into
the private per-session knowledge file, ahead of the name list, with an allowlist
of non-secret values bounded per variable (`CONTEXT_ENV_VALUES`: `PATH`, AWS
profile/region/config paths, gcloud and Azure configuration, `KUBECONFIG`, Docker,
Terraform, Pulumi, Python environments, rustup, `JAVA_HOME`, version managers,
direnv) and presence-only entries for credential variables
(`CONTEXT_ENV_PRESENCE`). An older bootstrap without a snapshot falls back to
NMSh's launch environment through the same allowlist. The cache key includes
exactly the variables a capability declared (`environmentKey`), so switching
`AWS_PROFILE` re-resolves AWS and nothing else. Bash and Fish command
classification, typo correction and the install offer use the reported `PATH`
too.

### No execution for context

Versions come from install layouts and metadata, never from running a binary:
`node_version.h`, `GOROOT/VERSION`, the JDK `release` file, `pyvenv.cfg` and
versioned interpreter paths, rustup `settings.toml`. `resolveTrustedExecutable`
takes the first PATH match (absolute entries only) and refuses one inside the
current workspace (cwd and repository root, as given and as resolved, but never
the home directory or `/`), writable by others, or owned by another user; it
recognizes version-manager shims. Only fixed system tools at absolute paths are
spawned (`/usr/bin/vm_stat`, `/usr/bin/pmset`), and trusted Git for Git context.

## Scheduling, cache and performance

`ContextEngine`:

- `stage(scope)` → generation; `demand(map)` schedules missing, expired or
  invalidated values for the staged scope (work for the still-visible scope is
  kept while a stage is pending); `settle(ms)`; `commit(generation)` makes the
  new scope visible at once. The frontend settles for at most 150 ms, so a
  directory change never flashes an empty prompt.
- Entries are keyed by capability, scope base and environment key; demand
  narrows fields; an extra field triggers a follow-up resolution.
- Concurrency: four global, per family metadata 4, probe 2, system 2, agent 1;
  cheap work first; identical requests coalesce (never onto a cancelled task).
- Timeouts per capability; failures back off 5 s / 15 s / 60 s and keep the last
  value visible as stale. A capability's first resolution in an engine gets three
  times its timeout: cold module loading and every capability's first reads
  compete for the same I/O threads, and a timeout should stop a hung read, not a
  cold start.
- Cancellation on scope change; late results never commit; a disposed engine
  ignores everything.
- Freshness: TTL per capability with stale-while-revalidate; `invalidate('command')`
  after each command; refresh timers only for visible time-based facts.
- An LRU bound (256 entries) that never evicts current targets, visible keys or
  in-flight work.
- `facts()` is memoized until the earliest expiry.

Rendering never initiates collection. Hidden modules, surfaces that are not
shown and show-on-command modules without their command produce no demand
(`contextDemand`).

Benchmarks (`scripts/benchmarks.ts`, `context/*`) measure cold and warm
collection against a realistic workspace, twenty rapid directory changes,
rendering every module on every surface, hidden-module demand and Git context in
a ~3,000-file repository. `bench:smoke` (CI timing job) enforces generous p95
budgets: they catch gross regressions such as a synchronous probe, not noise.
Functional tests assert behavior (no I/O in render, no work for hidden modules,
caps, cancellation), not elapsed time.

## Modules and surfaces

Module definitions carry id, label, description, category, facts and fields,
priority, semantic role, icon (with provenance in `icons.ts`), condition
(`always`, `onCommand` with trigger words, `inRepository`), preferred and
supported surfaces and stale handling. Pack modules are `<packId>:<moduleId>`;
pack role names map onto existing prompt roles. Rendering of pack modules
(`declarativeSegments`) supports literal text, field values through a fixed
formatter set, joins, conditions over declared fields, age gates (`minAgeMs`,
`until`), emphasis thresholds and icon-or-label by glyph mode.

Choices: Auto, Main Prompt, Right Context, Context Rail, Status Strip (where a
module supports it) and Hidden. Saved `placement: left | right` is preserved; an
absent surface keeps it exactly. Explicit surface overrides legacy placement;
explicit Auto uses the definition's preference. Hidden suppresses presentation
**and** demand. No migration moves an existing module; first-party pack modules
are appended (only show-on-command cloud, infrastructure and agent modules start
visible).

**Status Strip routing** is implemented because it fits without changing the
strip's semantics: routed modules render through the same painter and join the
strip's existing items at a lower priority than every native strip item, so
CPU/memory/battery/branch items keep their room and modules drop first.

## Context Rail

New defaults: Auto, one content row, Vertical, Outside, Gap, Follow Main
direction/theme/style, Prompt Level divider, Priority overflow. Existing valid
saved Rail settings preserve their geometry, including legacy Attached spacing.
Modes: Off paints/reserves nothing; Auto reserves no row without visible routed
content; Always reserves the configured one or two rows even when empty. Auto
reserves the configured row count once content exists, so fitting does not cause
height jitter. On tiny screens the transcript/input win and the Rail may be clipped.

Vertical Rail attaches immediately above Bottom/Flow, and below the Top composer
group (after suggestions). Presentation controls can instead place a separate
Rail rectangle Right of Prompt; this never reroutes facts to Right Context. Right
Context retains its far-edge anchor and independent module routing. Flow, FOLLOW
and detached clipping rules are in
[context-rail-composition.md](context-rail-composition.md), which also defines
Relation, Direction, Integration, Spacing and Divider Anchor.

The Rail is Native module presentation. External providers and Prompt None
suppress it with settings retained. Fullscreen/raw passthrough, panels and idle
screens hide it with the rest of the frontend chrome. Fitting groups all segments
of a module; higher priority enters first; normal, then compact geometry, then
dropping lower-priority groups; at most the configured rows, never wrapping.

## Declarative Context Packs

Format `nmsh.context-pack/v1` (`schema.ts`): `id`, `version`, `name`,
`description`, `license`, `provenance` (author, source, notes), `compatibility`
(`contextApi`, NMSh range), `requires` (capability ids), `modules`, optional
`recommend`. The parser is strict (unknown keys are errors) and bounded: 64 KiB,
depth, counts and string lengths. Ids are validated; `nmsh.*` is reserved for
bundled packs. Every field reference must name a capability in `requires` and a
field that capability declares. Missing capabilities make a pack **unsupported**
as a whole; an incompatible context API or NMSh range makes it **incompatible**.

Lifecycle (`store.ts`): packs live under NMSh's config directory
(`context-packs/`), recorded in a manifest with their sha256. Install validates,
shows what the pack reads and adds, optionally checks `--sha256`, then stages and
renames atomically; reinstalling repairs a tampered copy. Load verifies the hash
(**integrity failed** otherwise), the parse and compatibility. States: enabled,
disabled, missing file, integrity failed, invalid, unsupported, incompatible.
Removal deletes the manifest entry and file and the pack's module entries.
Installed modules start hidden. A checksum proves pinned bytes, not author
trust; there is no registry, download or signature model yet — packs are local
files the user chooses.

Recommendations (`recommend.ts`) are deterministic: workspace file names and
extensions, executable presence, or an available fact, each producing a
sanitized reason. They never install, enable or select anything, and entering a
repository never does either.

First-party packs (`packs/builtin/*.json`, GPL-3.0-only, independent
implementations of documented formats) are loaded through the same parser:
project, environment, infrastructure, cloud, system, vcs and agents.

## Agent context

The Claude Code status-line interface is the only agent integration, because it
is an official structured interface. `nmsh agent-status setup|remove` edits
Claude Code's `settings.json` through the verified config-edit planner (exact
preview, sha256 precondition, ownership record of the exact inserted text,
exact removal; an existing custom status line is never replaced). The bridge
(`nmsh agent-status claude`) reads at most a bounded stdin, keeps an allowlisted
record (`agentStatus.ts`) in a private 0700 directory as a 0600 file written with
an exclusive temporary file and rename, tagged by `NMSH_SESSION_ID` (set by the
session service; in-process sessions use a private id), and prints a compact line
rendered by the same declarative modules. `agent.claude` reads only the current
session's record; values are display-only, private fields (session name, cost)
stay out of every snapshot. Absent or old reports show nothing or their age.

## Security and privacy invariants

Entering an untrusted directory must never itself execute repository-controlled
code through NMSh context discovery, contact the network, or expose secrets. The
real shell's explicitly user-configured startup/hooks remain a separate trust
boundary; NMSh adds no automatic trust.

Ordinary discovery never sources `.envrc`, startup files, themes or plugins;
executes project scripts, configuration-selected binaries or PATH discoveries;
runs kubeconfig `exec` plugins; calls cloud APIs or authenticates; reads
credential values; dumps the environment; or interprets project strings as
terminal controls. Metadata is hostile even when Git returned it.

Modules receive values, not filesystem traversal, `child_process`, `process.env`
or network objects. Only capabilities perform I/O. Native rendering and routing
are synchronous, pure consumers. A failure means unknown/unavailable context,
never permission to try another executable.

The trusted Git status service accepts only the existing contextual operations,
never PATH discoveries. It disables fsmonitor/hooks, ignores submodules, refuses
filter/include/worktree-config/partial-clone/promisor repositories for status,
and disables lazy fetching; branch/root may remain available and missing status
is never shown as clean.

External-provider segments lack fact provenance: if any fact cannot be
snapshotted, external snapshot presentation fails closed. Native segments are
filtered individually. No live Rail or Status Strip aggregate is persisted.

## Test and delivery gates

- Kernel: demand-only resolution, field demand, coalescing, caps, timeouts and
  the cold-start allowance, backoff, cancellation, staging, bounded cache,
  sanitization, environment keys, field projection (`contextKernel.test.ts`).
- Capabilities: every parser against real-shaped fixtures and refusal cases,
  sentinel executables that must never run (`contextCapabilities.test.ts`).
- Hostile workspace: a repository with fake executables on PATH, `.envrc`,
  hooks/fsmonitor, kubeconfig `exec`, malformed/huge/symlinked metadata,
  control/bidi/OSC payloads, hostile Git refs and malicious pack metadata:
  collection plus repeated rendering execute nothing, contact nothing and leak
  nothing (`contextHostileWorkspace.test.ts`).
- Packs: schema, integrity, lifecycle, CLI and recommendations
  (`contextPacks.test.ts`); agent context end to end (`agentContext.test.ts`);
  `/prompt` module management (`moduleManager.test.ts`).
- Real zsh, Bash and Fish report the environment snapshot
  (`shellContextEnvironment.test.ts`).
- Performance: `npm run bench:smoke` budgets; render-purity tests.

Automated tests never constitute physical terminal or multiplexer QA.
Continuation follows [the agent protocol](../development/context-engine-agent-protocol.md).
