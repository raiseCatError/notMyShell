# Development verification

## Local feedback

- During implementation: focused affected tests via `node --import=tsx --test tests/<file>.test.ts`, or `npm run verify:fast`.
- Before pushing a coherent checkpoint: `npm run verify`.
- Release-sensitive work: `npm run verify:release`.

`verify:fast` builds and checks a curated core subset (editor, key decoding,
highlighting, protocol framing, completion model, path display, Linux helpers,
and test selection) plus `git diff --check`. It is not a full-suite gate.
`verify` builds, runs canonical `npm test`, and checks diffs. `verify:release`
adds `typecheck:bench` and `bench:smoke`. No aggregate recompiles the same source
twice. The test runner caps default file workers at four (or the lower Node default
on small runners), since each PTY worker also owns helper processes. Explicit
Node `--test-concurrency` arguments override the cap. Assertions and budgets
remain unchanged. Local commands reuse node_modules. Clean CI/release environments use
`npm ci`; setup-node caches npm downloads, never node_modules.

## Canonical suite and sharding

The only shard interface is `npm test -- --shard=1/2` (or `2/2`). No arguments
still runs every recursively discovered `tests/**/*.test.ts` file. File selection
lives in `scripts/test-selection.mjs`; its tests verify deterministic assignment,
exact union, no overlap, invalid-input rejection, and curated-list existence.
Runtime files are partitioned as whole files by deterministic greedy scheduling.
Rounded measured weights for slow files balance PTY work; ordinary/new files
default to one. Reprofile weights only when actual shard imbalance warrants it. `suggestionRanking.test.ts` runs
separately after runtime files, only in shard one, preserving uncontested latency
measurement. New files automatically enter the canonical suite and a shard.

The fast, Node 22 and Fedora lists are explicit, reviewed subsets. They do not
replace the full canonical suite. Node 22 covers build identity/version, actual
built/source startup launch paths, real zsh/Fish/Bash session adapters, service
compatibility, wire protocols, Linux helpers and host profiles. Long detached
session scenarios run fully on Node 26 on both macOS and Ubuntu.

## CI gates

Code PRs run quality on Ubuntu/Node 26, two macOS/Node 26 shards, two Ubuntu/Node
26 shards, and curated Ubuntu/Node 22 compatibility. Each shard builds because
built-launcher tests otherwise skip on a clean checkout. Each integration shard
and smoke job checks helper-process leaks, including after a test failure.
Existing hard latency assertions remain in the canonical tests.

Timing smoke runs on macOS and Ubuntu/Node 26 on dev/master pushes and manual
workflow dispatch. These measure platform-dependent shell/configuration startup
as well as bounded completion, composer and transcript samples. Fedora 42 runs
its existing portability subset on those same events. Benchmarks remain
informational regression evidence, not new timing thresholds.

Documentation-only PRs (`*.md` or `docs/**`, including deleted files) skip costly
jobs at runtime. The workflow always starts and completes its aggregate `CI`
check; detection failures fail closed. `Verify (22.x)` and `Verify (26.x)` remain
aggregate aliases for the existing master ruleset. All applicable gates must
succeed; skipped required code or release gates cannot pass the aggregate.
Concurrency remains workflow + ref, cancelling superseded runs of the same PR
or branch independently.

## Exact release commit

Before tagging v0.17.0, run `verify:release` locally and require a successful
manual CI dispatch on the exact candidate commit (or its dev/master push run).
The SHA must match the release commit: both complete Node 26 platform suites,
Node 22 runtime compatibility, Fedora subset, both platform timing smokes,
build correctness, benchmark typechecking and diff checks must be green.
An ordinary PR run does not supply Fedora or benchmark release evidence.
Automated checks do not substitute for physical terminal validation.

## Measurements

Baseline: v0.16 dev run 37219429715 completed in 5m02s. Slowest job was
Ubuntu/Node 22, 4m59s, of which tests took 4m07s. The four OS/Node legs each ran
the full suite, two identical source compilations and timing smoke.
v0.17 PR run 37223805076 completed in 5m09s; slowest was macOS/Node 22, 4m57s.
It also ran Fedora on every PR.

After: two full-suite equivalents per code PR (one per OS), distributed over
four parallel shards, plus curated Node 22 compatibility. Dev/manual runs add
Fedora and platform timing evidence in parallel. Measured local and Actions
results are recorded after validation; runner timing varies and 2–3 minutes is
a target rather than a correctness gate.

Local profiling uses the unchanged canonical runner on macOS arm64/Node 26.8.1
with real PTY/process access and the inherited `NO_COLOR=1` removed for existing
presentation fixtures. It passed in 82.9s, including the four new selection
regression cases. The fast aggregate passed in about 4s (63 tests). Measured
test work used for shard weights totals 225.7s versus 220.8s; these sums are not
wall times because files execute concurrently.

Local final verification: `verify:fast` 2.1s; `verify` passed, and the subsequent
`verify:release` passed its nested canonical gate (1,514 tests, zero skips),
benchmark-script typecheck and timing smoke in 169.0s. Canonical test processes
in that release run took 158.4s combined. The Node 22 curated list passed on the
available Node 26 runtime in 33.9s; actual Node 22 validation is delegated to CI.
Final shard runs passed in 52.2s and 79.9s with four workers. Every shard and release run retains
all assertions and budgets. Higher local fan-out exposed intermittent existing
completion, resume-browser latency and terminal-mode timing failures; focused
reruns and final bounded-worker verification passed without assertion changes.
