# v0.11 cumulative development acceptance

v0.11 is an unmerged development stack above frozen #266, not a release. Package
and lockfile remain 0.7.0. Physical terminal QA is explicitly deferred.

Milestone [#11](https://github.com/raiseCatError/notMyShell/milestone/11) contains
only #52, #75, #73 and #17. All remain open. The frozen base is
`d3e77f703fcd8af71fffc0feba1275e590984cbe` (`docs/v010-final-acceptance`).

## Runtime results

[#267](https://github.com/raiseCatError/notMyShell/pull/267) extends the existing
CompletionSource pipeline with a lazy persistent configured-zsh helper. A hidden
zpty loads trusted HOME startup files once per generation. Its own widget invokes
completion knowledge and captures bounded compadd records; foreign ZLE/fzf-tab UI
never owns the NMSh editor. Existing candidates retain values, displays,
descriptions, groups, prefix/suffix data, replacement range and context provenance.
NMSh renders/inserts; Tab never submits a command. Explicit unquoted home paths
retain expansion, while quoted/escaped tildes remain literal.

Startup/query deadlines are 1500/300 ms, output/candidates 1 MiB/4096. Buffer,
cursor, cwd and frontend generations reject stale results. Helper expiry is
60 seconds, with invalidation after managed prompts/cwd changes; no stat tree runs
per keystroke. Cancellation, expiry, timeout and failures restart the helper;
failures use a five-second cooldown and native fallback. Middle-buffer legacy
fallback is suppressed when no safe replacement protocol exists. Shell-side
deadlines and explicit inner process-group cleanup survive frontend death.
No history is recorded by helpers. Configuration is executable trusted user code
and can cause external effects; isolation does not sandbox it. Config is never
sourced inside frontend JavaScript. See [completion design](../design/configured-completion.md).

Native fzf-tab support remains **unsupported**. The optional existing fzf picker
can select among NMSh structured candidates, with native menu fallback when fzf is
missing. This is useful interoperability, not fzf-tab widget parity.

[#268](https://github.com/raiseCatError/notMyShell/pull/268) captures name-only
alias/function metadata at real managed-shell prompt boundaries. Complete/partial
snapshots distinguish absence from truncation. Semantic generations cancel stale
classification; live names feed highlighting, completion and inspector without
executing definitions. Latest metadata survives journal acknowledgement and
reattachment. Complete snapshots reveal builtin/executable commands underneath
removed configured aliases; partial snapshots retain conservative positive knowledge.
Live positive names survive classifier failure. No bodies/environment values are
transported. See [native intelligence design](../design/native-shell-intelligence.md).

The bounded lexical layer improves reserved words, assignments, redirects,
parameter/command/arithmetic expansions, quotes/escapes/globbing, pipelines,
background operators and common compound boundaries. It remains a pragmatic
lexical layer, not a complete zsh parser. Failure presentation relabels the existing
lifecycle row only with matching diagnostic/status evidence. Exit 127 alone does
not claim command-not-found. Raw PTY diagnostics, journals, `/copy` and correction
remain authoritative and unchanged.

## Research decisions

[#73](https://github.com/raiseCatError/notMyShell/issues/73) stays research-only.
The closed module-ID schema and migration/editing UX require an agreed model
before custom modules are persisted. No implementation child was created. A future
static-first model should reuse current placement/rendering/snapshot paths.
Command-backed sources would require explicit argv configuration, detached bounded
execution, sanitized output, asynchronous caching, generation cancellation and
bounded concurrency. Proposed limits are research values, not runtime promises.
No shell-string mode or custom command runtime was added.
See [prompt-module research](../design/custom-prompt-modules-v011-research.md).

[#17](https://github.com/raiseCatError/notMyShell/issues/17) inventories zsh
assumptions across startup, PTY, hooks, cwd/environment/status, signals, history,
completion, metadata, semantics, prompt suppression and restore. Current provider,
lifecycle and transport contracts already isolate consumers; no small generic
extraction improves current behavior enough to justify a child. A future backend
surface must emerge from another shell's demonstrated behavior. No multi-shell
support or generic runtime adapter was added.
See [ShellAdapter research](../architecture/shell-adapter-v011-research.md).

## Hardening and verification

Hardening disposes hung/dead semantic helpers, bounds pending classification,
prevents uncached-result redraw loops, preserves home-path completion semantics
and keeps native helper descendants in their owned group. Automated fixtures
cover abrupt frontend death, timeouts, cancellation, real large capture, live names,
partial snapshots, acknowledged reattach, malformed records, stale results and
existing picker/passthrough/copy/journal/presentation behavior.

A final job-control teardown identified an early completion helper orphan whose
argv matched the configured helper. Native capture also recorded its inner PID
only after an initialization command. Cancellation could kill either parent before
inner PID registration. Both zpty
parents now record PID from their own table before querying, retain a table-based
cleanup fallback, and receive at most 100 ms cancellation grace before forced
termination. The configured trap is installed before spawning. A delayed inner-shell
fixture deterministically covers pre-initialization cancellation; this failure was
fixed as a lifecycle defect rather than rerun as an unexplained flake.
Review also reproduced a TERM-ignoring descendant surviving its parent's close;
the close path now kills the remaining owned group, with a separate regression.

The updated #268 Node 26 dispatch passed all assertions (828 passed, eight optional
tests skipped) but failed the suite-root check with one managed-shell ZDOTDIR.
Its Node 22 job passed. The root was removed by the runner after reporting, so its
exact origin is unknown; no unexplained retry was used to erase this failure.
Investigation separately confirmed that a transient removal error discarded the
owned path permanently and that synchronous PTY spawn failure leaked the bootstrap
root. Hardening now signals before removal, uses bounded retries, retains the path
for exit-event retry on failure, and cleans a failed spawn. A red/green fault-injection
regression and an isolated spawn-failure fixture verify those fixes. These defects
are confirmed; attributing the historical CI artifact to them would be an inference.

A real nested-fixture readiness race was reproduced: terminal exit text can be
observed before the frontend's paste-restoration sequence. The harness now awaits
frontend ownership before making the unchanged restoration assertions. Earlier CI
failures and resource/host-load timing misses were not treated as unexplained green
reruns. Native helper cleanup failures were fixed in code. Under heavy host load,
cold helpers can miss their budget and gracefully fall back; timings below are
informational, not physical terminal certification or guaranteed budgets.

Final published-code profiling on Node 26.8.1, darwin arm64, 8 GiB memory:

| Work | Median ms | p95 ms |
| --- | ---: | ---: |
| Live name snapshot, 4096 (20) | 1.07 | 1.30 |
| Filter 500 candidates (20) | 0.10 | 0.24 |
| Parse 4096 configured records (20) | 4.07 | 7.38 |
| Cold configured startup/query (5) | 511.19 | 621.48 |
| Warm configured query (20) | 15.19 | 19.93 |
| Filesystem completion (20) | 17.38 | 33.87 |
| Queued cancellation (20) | 0.02 | 0.08 |
| In-flight cancellation (5) | 13.61 | 15.63 |
| Large-query budget/failure return (5; **0 complete**) | 303.49 | 306.88 |
| Native fallback (5) | 186.94 | 396.69 |
| Edit/layout/highlight 10 operations (20) | 24.19 | 47.43 |

In-flight cancellation includes a controlled 10 ms fixture delay. In this final
run all five large queries hit their 300 ms budget and returned fallback; these
timings are **not successful 4096-candidate throughput**. A previous prepared run
completed all five samples with 4096 records, zero fallback and 198.65/210.38 ms
median/p95. Preparation runs outside timed queries. The real large fixture with
a 2000 ms test budget verifies the 4096 cap independently. Production keeps its
300 ms budget and asynchronous fallback rather than extending it to force parity
under load. Earlier samples reached ~1075 ms cold p95. Benchmarks remain
informational and reproducible through `npm run bench`; no physical validation or
guaranteed latency is implied.

## Review order and automated evidence

Each new PR targets its immediate predecessor; none is merged.

| Order | PR / branch | Published head | Node 22/26 dispatch |
| --- | --- | --- | --- |
| Frozen base | [#266](https://github.com/raiseCatError/notMyShell/pull/266), `docs/v010-final-acceptance` | `d3e77f703fcd8af71fffc0feba1275e590984cbe` | [36932297398](https://github.com/raiseCatError/notMyShell/actions/runs/36932297398) |
| Configured completion | [#267](https://github.com/raiseCatError/notMyShell/pull/267), `feature/v011-configured-completion` | `0df8cd6772d18793ea0f0744c2fdc7ec70a61692` | [36944128030](https://github.com/raiseCatError/notMyShell/actions/runs/36944128030) |
| Native intelligence | [#268](https://github.com/raiseCatError/notMyShell/pull/268), `feature/v011-shell-intelligence-parity` | `f63f2f3cba3229ad2c8c106a1ca900bd7d8d5e54` | [36948391400](https://github.com/raiseCatError/notMyShell/actions/runs/36948391400) |
| Hardening | [#269](https://github.com/raiseCatError/notMyShell/pull/269), `feature/v011-shell-hardening` | `1f092745bc5daf60fd4b0a524b6318aa6e9e6638` | [36949433308](https://github.com/raiseCatError/notMyShell/actions/runs/36949433308) |
| Final acceptance | This docs PR, `docs/v011-final-acceptance` | Exact head in PR verification comment | Exact-head dispatch in PR verification comment |

Local runtime verification passed **844/844** serial tests (144.16 seconds),
`npm run build`, `npm run typecheck`, `git diff --check` and benchmark-script typing.
The initial #52 focused/full checkpoints passed 823 tests; #75 passed 836 before
the readiness-only fixture update. Later cumulative checks include every change.
Managed-shell cleanup added two further tests after the 842-test checkpoint. The updated hardening and final
acceptance heads receive full-suite runs and Node 22/26 dispatches;
its PR verification comment records the exact SHA and outcomes, including any
failure, rather than embedding a self-referential commit hash here.

The test runner checks semantic, managed-shell, configured-completion and native
capture roots before deleting its private suite root. Post-hardening process
inspection found no test/completion/semantic helpers or suite roots. Private logs
remain ordinary files. Versions are still 0.7.0. Existing unrelated untracked
`.serena/` was preserved; tracked changes are committed through this PR.

Preflight verified free space, fetched origin, #266's open/unmerged branch/SHA,
worktrees/status, stale helpers/private roots and package/lockfile versions.
After the user revoked the old preferred margin, the only disk checkpoint gate
was less than 1 GiB. Checks continued around full suites/builds; recent available
space was 4,120,000 KiB. No ENOSPC or unrelated-data cleanup occurred. Final free
space and temp/process checks are recorded in the acceptance PR comment.
Project access failed once for missing `read:project`; no board update is claimed.
Issue comments and the unmerged PRs are the durable work record.

## Limits and deferred work

Live-only compdefs/function bodies and managed-shell PATH/environment changes are
not replicated into completion helpers. Completion prefix/suffix callbacks and
arbitrary ZLE state mutation are outside v1. Complex/nested/multiline replacement
contexts use conservative fallback; middle-buffer native insertion is intentionally
unavailable. Explicit `~/` is supported; named-directory/user tilde expansion is
not claimed as completion parity. Name snapshots are capped at 4096 names/64 KiB/128 code points and a
safe Unicode transport alphabet; partial snapshots cannot prove every removal.
Shell failure labels cover safely matched simple diagnostics. Heredocs, wrappers
and complete shell grammar remain outside semantic parsing.

Custom prompt modules and multi-shell runtime support remain future design work.
Linux, Windows/ConPTY, Chroma effects and frontend/TUI landscape research were not
started. [Additive physical QA](v011-physical-qa.md) contains only v0.11 checks for
configured completion, alias/function/syntax/failure behavior and relevant host
ownership restoration. No physical validation has been claimed. Next: review the
stack in order, perform the deferred physical checklist, then decide integration
separately. No merge or release is authorized by this acceptance record.
