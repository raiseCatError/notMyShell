# v0.10 development acceptance (unmerged)

Milestone #10, **Terminal Hosts & Compatibility**, is development-complete as an
unmerged review stack, subject to the exact-head CI gate recorded on the final
PR. This is not a shipped release. Package, lockfile and current release stay
**0.7.0**. Physical terminal and actual-tool QA remains pending; relevant issues
stay open. No v0.11 work, merges, tags or releases are included.

## Review order and scope

Frozen foundation: #258 → #259 capabilities → #260 baseline → #261 integration
→ #262 profiles (`ae66506ab4aecf509414a75841943160ffc044fc`). The continuation is
[#263 OSC 8](https://github.com/raiseCatError/notMyShell/pull/263) →
[#264 compatibility](https://github.com/raiseCatError/notMyShell/pull/264) →
[#265 hardening](https://github.com/raiseCatError/notMyShell/pull/265) → this acceptance/docs PR. Every PR targets its immediate
predecessor. The lower foundation was neither reimplemented nor modified.

- **Capabilities and baseline:** frontend-owned plain values, conservative unknown
  host, keyboard-only Terminal.app, explicit color/hyperlink override precedence,
  one shared bounded keyboard/synchronized-output query batch. No capability state
  is injected into the persistent shell or journal.
- **Ghostty integration:** optional keyboard/configuration/appearance operations
  remain isolated under host adapters and explicit user actions. Core presentation
  consumes capabilities rather than host names. Startup fastfetch suppression,
  NMSh-owned editor and detached semantic helpers remain intact.
- **iTerm2, Kitty, WezTerm:** passive profiles provide documented hints; keyboard
  and synchronized output depend on probe evidence where applicable. No graphics
  bytes or new host preference writes are introduced.
- **Attach/reattach:** each frontend refreshes capabilities. The creating shell's
  cwd/environment/state persists. Foreground interactive programs retain query and
  input ownership; host context changes do not mutate shell environment.
- **OSC 8 (#150):** URL recognition, existing explicit paths from owning command cwd,
  repository-gated numeric GitHub references and preserved original program links.
  Generated decoration uses copied cells. Allowed generated schemes are http,
  https and local file; controls/credentials/remote file authorities are rejected.
  Wrapped rows and sticky truncation close links; capability-off output is plain.
- **Preview (#151):** [research decision](https://github.com/raiseCatError/notMyShell/issues/151#issuecomment-5941207557)
  is research-only. Kitty placement IDs, iTerm inline images, Sixel, symbols and
  optional Chafa were evaluated. Current text renderer lacks owned image lifecycle
  across scroll/resize/close/clear/passthrough/reattach. No implementation child,
  graphics subsystem, decoder dependency or network fetching was added. Preferred
  future v1 is one explicitly requested local-image panel with strict bounds and
  native → Unicode/text → metadata fallback.
- **Compatibility (#14):** repeatable finite/noisy/streaming/canonical/raw/alternate-
  screen/agent/nested-PTY fixtures; full stored ownership, folding, LIVE, resize,
  signals, keyboard/mouse/paste handoff and restoration. Optional tmux/GNU screen
  coverage remains skippable in CI. Local tmux 3.7c passed actual-client mouse-on
  detach/reattach and pane resize. Physical selection is not certified.
- **Embedded hosts (#15):** [research findings](https://github.com/raiseCatError/notMyShell/issues/15#issuecomment-5941320913)
  recommend a generic manual pass for Supacode/similar hosts. Worktree cwd, opaque
  environment ownership, app shortcut interception, nested agent UI and process
  persistence remain separate layers. No reproduced vendor-specific gap warranted
  a defensive child issue or dedicated adapter.
- **Hardening:** ordered, bounded, independent main/alternate keyboard stacks;
  incomplete-only mode carry, reset isolation, counted pops and correct default
  flags; synchronous probe listener cleanup. A preset test now waits for command
  completion before `/resume`; owned-process timeout diagnostics improve handoff.

Detailed records: [host architecture](../architecture/terminal-host.md),
[compatibility matrix](v010-compatibility.md), [cumulative audit and performance](v010-hardening.md),
and [additive physical QA](v010-physical-qa.md).

## Automated evidence and retries

The final cumulative suite contains **810 tests**. Canonical build, typecheck,
full suite and diff check are required. Benchmark-script typing uses TypeScript
6's explicit `--ignoreConfig` when source files are specified on the command line.
Node 22 and 26 are checked through workflow_dispatch because normal PR CI filters
do not trigger for these feature-branch bases. Exact run/head evidence belongs
on the PRs; a green predecessor is not a substitute for final-head CI.

Local test environment had inherited `NO_COLOR=1`; the first run failed color
snapshots. Later full runs removed that override. Default concurrency twice hit
the baseline sandbox teardown timeout, and one bounded-concurrency run did too.
Passing bounded-concurrency retries are reported explicitly. Another run exposed
a preset-test race: PID output arrived before completion, so `/resume` was rejected.
The test now waits for completion. Another four-worker run failed the existing native-completion fixture and suggestion-ranking latency ceiling (p95 66.9 ms against 60 ms); assertions were kept intact and the unchanged head was rerun serially. None of these runs is physical validation.

Final checks also cover process leaks, private temp roots, version consistency and
clean tracked status. Existing unrelated untracked `.serena/` was preserved.
Resource preflight started around 5.3 GiB free; headroom was checked periodically,
and no unrelated user data was deleted. See the final PR/handoff for final disk.
Project access was attempted once; the token lacked `read:project`, so no board
transition is claimed. Issues/PRs/comments remain the durable work record.

## Performance and limitations

URL-heavy benchmark, local Node 26.8.1 / macOS arm64: 1000 lines first recognition
p50 **5.40 ms**, p95 **9.10 ms**; cached access p50 **0.06 ms**, p95 **0.11 ms**.
This excludes terminal writes, wrapping and filesystem checks. No extra startup
query was added. Prior checkpoint values (not freshly remeasured) were about
80–83 ms for the probe batch and 0.145 μs/call for capability resolution.

Recognition is bounded to 8192 columns/code units and 16 candidates per source
line; weak revision/cwd caches avoid rescanning unchanged history. Repository
cache is bounded to 128 cwd entries. Existing wrapping still traverses history.
Synchronous path checks have bounded count, but mounted filesystem latency is
unbounded externally. Missing-file/repository cache results are not retroactively
refreshed for unchanged rows. Ambiguous paths (including spaces/shell expansion),
stack-trace locations, arbitrary hashtags and uncertain repositories remain plain.
Program link metadata is retained only for bounded, control-free OSC payloads.

Actual Supacode/agent accounts, all GUI hosts and real zoxide/Atuin configurations
were not newly evaluated. tmux key/selection behavior remains configuration and
host dependent; Ctrl+J is the multiline fallback. Cross-host shell environment
staleness is intentional persistent-shell behavior, documented separately from
fresh frontend capabilities. Graphics previews remain deferred by research.

## Human next steps

Review the stack in order without merging under this authorization. Run only the
additive checklist on available terminal hosts; installing every host is not
required. Validate URL/file/GitHub/program links, narrow wrapping/selection,
compatibility categories, tmux mouse and detach/reattach, fresh attachment modes,
and nested keyboard restoration. Optional embedded-host checks remain pending.
Record actual pass/fail evidence before closing human-validation issues. Any
later merge, version bump or release requires separate authorization.
