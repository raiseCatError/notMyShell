# Adversarial hardening implementation plan

**Goal:** Resolve the adversarial blockers in issue #284 above #286.
**Architecture:** Preserve persistent zsh and detached helpers. Keep startup ownership until readiness; explicitly reject bounded queue overflow. Negotiate startup safety through an additive v2 welcome capability. Track only child keyboard stack entries on each physical screen. Serialize abandoned preset lock recovery.
**Constraints:** No merge, history rewrite, release, tag, dependency additions or version bump. Package/lockfile remain 0.7.0. Physical QA deferred. Preserve .serena and worktrees. Stop disk-heavy work below 1 GiB.

- [x] Startup: reproduce early less/vim against SIGINT-ignoring startup; prevent pre-ready passthrough; preserve recovery before/after notice and post-ready passthrough.
- [x] Queue/tail: pin exact 64 KiB UTF-8 boundary, overflow rejection, cumulative writes, eventual readiness and abort; propagate rejection to composer; cap sanitized tail at 2048 UTF-8 bytes.
- [x] Protocol: optional startupSafety capability; reject create/attach before sending either request when missing, retain list/kill administration; real old/new service and frontend exchanges.
- [x] Kitty: observe actual forwarded bytes and restored modes, track independent main/alternate child pushes, pop each on its own screen before returning to NMSh; preserve pre-existing host stacks and normal leave.
- [x] Presets: atomic recovery directory serializes recovery; re-read owner inside guard; never recover guard blindly. Deterministic competing recoverers with writer paused in mutation; retain dead/live/malformed/reused PID cases.
- [x] Clipboard: stdin failure rejects even with zero exit; isolated process group killed only on failure/timeout; assert descendant cleanup and successful owner survival.
- [x] Test quality: held submitted command survives reattach exactly once; isolate local mise marker mutation; wait on less journal completion and composer ownership.
- [x] Verification: focused red/green tests, complete macOS suite with TERM=xterm-256color/COLORTERM=truecolor, build/typecheck/benchmark typing/diff check, process/temp leak checks, repeated tmux test. Push implementation and open PR above #286, await all four CI gates.
- [x] Final acceptance: document disposition, evidence and pending physical QA on separate branch/PR above implementation; keep both open/unmerged.

Review focus: asynchronous service rejection; readiness prompt must not complete queued command; each screen has independent stack; competing recovery cannot displace live owner; legacy service must not receive create/attach from new frontend.

Evidence: 918 local tests passed with TERM=xterm-256color, COLORTERM=truecolor, NO_COLOR/FORCE_COLOR cleared. Ten real-tmux ownership repetitions passed, including runs alongside the suite. Startup ownership, missing capability, queue overflow, stale recovery and Kitty regressions were observed failing on unfixed code. Independent review found delayed rejection overwriting a newer draft; a real socket regression reproduced it and now passes. Rejection source metadata prevents raw writes from clearing a submitted command; newer drafts survive and rejected input remains recoverable. Build, source/benchmark typing and diff checks passed; final refreshed verification and CI recorded in acceptance docs.

Ruling: an abandoned recovery guard fails closed with both paths in the error. Automatic read-then-remove recovery of the guard would recreate the original ownership race. End all NMSh writers before manual guard removal.
Ruling: protocol remains v2. Unknown startup semantics refuse create/attach before either request; administrative list/kill remain possible. Fresh-session creation falls back in-process with a factual notice.

Integration evidence: implementation PR #287 remains open/unmerged at 39923fcf58c0fb52e07511104b45ac552899158d. All four CI jobs passed (run 37045796065); macOS Node 22 required a failed-job rerun after an unchanged native-completion deadline miss. Final acceptance records that residual risk. Final docs branch is docs/v013-adversarial-acceptance, above the implementation commit. Physical QA remains deferred; issue #284 remains open.

Resumed continuation: fetched origin and verified #287 2a4ca48 / #289 fd16ac9 with 4.77 GiB available. Deterministic real-service reattach probe demonstrated raw=false/listening=false at visible restored-mode handoff. Fix a8937c677268735cc5291d13d12eba11eebaabc3 enables raw mode/listener before renderer entry/handoff. Fresh 918-test canonical suite, exact Node22.23.2 ten repetitions, build/typecheck/benchmark typing/diff and process/temp lifecycle checks pass. Fresh docs branch docs/v013-adversarial-final-acceptance is based directly on this implementation, preserving #289 and #288 history. Final exact-head CI evidence is recorded in acceptance and PR descriptions.

Final implementation CI run 37067891722: all four macOS/Ubuntu Node22/26 jobs passed on the first attempt at a8937c677268735cc5291d13d12eba11eebaabc3. Final docs remains an open PR above that exact head; no merge is authorized.
