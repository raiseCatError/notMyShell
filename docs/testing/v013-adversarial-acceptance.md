# v0.13 adversarial hardening acceptance

This continues issue [#284](https://github.com/raiseCatError/notMyShell/issues/284) after the independent adversarial review of [post-QA acceptance](v013-post-qa-acceptance.md). The implementation and this final acceptance PR remain **open and unmerged**. Physical QA is **deferred**, not passed. Package and lockfile remain **0.7.0**. No merge, tag, release, force push or history rewrite occurred.

## Verified starting point and review order

Origin was fetched before work. These published heads were verified and left untouched:

| PR | Branch | Head |
| --- | --- | --- |
| #283 | `docs/v013-cumulative-acceptance` | `e325bb30628b120837c28dd10d569e85ec7b0a12` |
| #285 | `fix/v013-post-qa-hardening` | `ae45bbeca692950fd71f7f6d3dd1db867739fda9` |
| #286 | `docs/v013-post-qa-acceptance` | `4f90c13421c874b6aee79e122ce0eef8bd78d5f3` |

Final review order:
[#278](https://github.com/raiseCatError/notMyShell/pull/278) →
[#280](https://github.com/raiseCatError/notMyShell/pull/280) →
[#282](https://github.com/raiseCatError/notMyShell/pull/282) →
[#283](https://github.com/raiseCatError/notMyShell/pull/283) →
[#285](https://github.com/raiseCatError/notMyShell/pull/285) →
[#286](https://github.com/raiseCatError/notMyShell/pull/286) →
[#287](https://github.com/raiseCatError/notMyShell/pull/287) → this final acceptance PR.

Implementation: `fix/v013-adversarial-hardening`, head `39923fcf58c0fb52e07511104b45ac552899158d`, based directly on #286. Final docs: `docs/v013-adversarial-acceptance`, based directly on that implementation head. Issue #284 stays open; this unmerged work is not Done or Needs Human Test after integration.

## Disposition

| Review finding | Result and regression evidence |
| --- | --- |
| Early passthrough loses startup ownership | Fixed. Early less/vim against SIGINT-ignoring startup retain the notice and Ctrl+C recovery, with session/process cleanup. Startup recovery precedes raw passthrough routing, including reattach; heuristic passthrough starts at preexec after readiness. Normal post-ready passthrough remains covered by real PTY/tmux fixtures. |
| Oversized/cumulative startup input silently disappears | Fixed. The queue counts UTF-8 bytes and rejects an entire write that would exceed 65,536 bytes, retaining already accepted input. Exact boundary, boundary+1, cumulative writes, eventual readiness and abort are covered. Rejection identifies composer submission versus raw write; frontend awaitingExec/running state recovers, the rejected command stays in history, an empty composer restores it, and newer drafts survive asynchronous replies. Rejected raw input is restored or retained as a visible interaction. |
| Kitty state survives on main screen | Fixed. Renderer observes bytes actually forwarded to the physical terminal, including restored app modes. It tracks outstanding child pushes independently per screen, pops main entries on main, then alternate entries on alternate, and restores NMSh there. No global flattening. Byte tests seed host stacks on both screens and cover child screen switches, abnormal return, suspended exit and final exit to the outer shell. Real tmux mode reconciliation remains covered. |
| Competing stale preset recovery breaks exclusion | Fixed. Lock acquisition still atomically hard-links a private PID file. Recoverers atomically claim `presets.json.lock.recovery` using mkdir, then re-read ownership inside that exclusive guard before removing a dead owner's lock. A recoverer that observed stale ownership before a competitor acquired the lock now sees the live owner and refuses it. The deterministic A/B/C interleaving pauses A after stale inspection and B inside mutation; C cannot acquire while B writes. Ordinary concurrency, dead recovery, live/reused PID refusal and malformed/out-of-range ownership remain covered. |
| Mixed-version service bypasses startup safety | Fixed through capability negotiation without a protocol bump; see below. Tests use frozen real #283 service/shell/protocol/frontend implementations, not only decoder assertions. |
| Clipboard EPIPE/descendant leak | Fixed. Stream errors reject even when backend exit is zero; success requires successful stdin finish and zero exit. Failed/timed-out backend process groups are killed, including ordinary descendants. Successful selection owners survive. Tests observe descendant PIDs and explicitly clean their own successful owner. Backend selection is unchanged. |
| Startup tail claims 2 KiB but counts characters | Fixed. Sanitized tail is at most 2,048 UTF-8 bytes, raw retention at most 16,384 UTF-8 bytes; suffix trimming never splits a code point. Multibyte regression added. |
| Weak test assertions | Strengthened: explicit queue-rejection assertions, submitted held command survives reattach and executes exactly once, local mise file fact itself changes on edit, descendant-PID clipboard assertions, real mixed-version exchange, inherited main/alternate keyboard state. Notification/effects foreground fixtures now establish initial shell readiness. |
| Ubuntu BACK-FROM-LESS flake | The original failure was not conclusively proven harmless. The test previously sent q and immediately submitted the next command. It now waits for the less completion journal and a returned composer before submitting. Ten consecutive real-tmux runs passed locally, including runs alongside the full suite; there are no sleep increases or retries. |

## Protocol compatibility

The existing v2 decoder validates known fields, ignores additive fields, and contains unknown live message types. The new `welcome.startupSafety = 1` advertises pre-ready isolation, startup state reporting and explicit bounded rejection. New frontends check it **before sending create or attach**. Optional input `submission` metadata and `input-rejected` replies preserve frontend recovery semantics.

- **New frontend / new service:** startup state is reported, accepted input is held until readiness, overflow is explicitly rejected and composer state recovers.
- **New frontend / old service:** create/attach are refused before ownership or input transfer, even if the old session happens to be ready. Administrative listing/termination remain available. New-session connection may safely fall back in-process with a factual notice; attach has no fallback. End old live sessions intentionally and let the service exit before reconnecting to start the updated service; no existing session is automatically terminated for upgrade.
- **Old frontend / new service:** additive fields are ignored and normal commands remain compatible. The new shell holds input through startup, including detach/reattach. Legacy frontends cannot display the new startup notice or rejection UI; update the frontend to obtain that presentation.

The legacy-service test establishes a real blocked read, verifies refusal leaves its detached session untouched, and then demonstrates that a legacy client can answer that same read. The reverse-version test submits before readiness, reattaches and observes exactly one execution after the gate opens.

## Automated verification

Local environment: macOS, Node **26.8.1**, `TERM=xterm-256color`, `COLORTERM=truecolor`, with `NO_COLOR` and `FORCE_COLOR` cleared.

- Full canonical suite: **918 passed, zero failed** (910 runtime tests plus 8 ranking tests).
- Build, source typecheck, benchmark-script typing and `git diff --check`: passed.
- Ten consecutive real-tmux less ownership runs: passed.
- Owned temporary-root lifecycle check: no leaked semantic/zsh/completion/capture directories; test-owned roots removed. LiveSandbox also checks sessions, services and open process references before deletion.
- Final helper/test process scan: zero matches.
- Regression proof: unfixed #286 TerminalApp loses the startup notice for early less; unfixed #286 SocketSessionClient accepts the real legacy service. Queue rejection, stale interleaving, clipboard EPIPE and inherited Kitty stack regressions were also observed failing before their fixes.
- Independent focused review found an asynchronous rejection that erased a newer draft. A real socket test reproduced it; the fix preserves both inputs and the follow-up review found no remaining material concern.

An initial run inherited `NO_COLOR=1` and failed presentation expectations; two foreground fixtures also lacked initial readiness. The environment/fixtures were corrected and the final canonical run above passed. No physical validation is inferred from these automated runs.

The first implementation CI attempt passed macOS Node 26 and both Ubuntu jobs. macOS Node 22 failed the unchanged `native fuzzy filtering preserves nested path capture context and cached insertion ranges` test: its candidate was absent after about 1.62 s, consistent with the capture helper's existing 1.5 s deadline under load. The exact cause is not proven. Twenty unchanged local repetitions passed (Node 26); only the failed CI job was rerun at the same implementation SHA. This is a recorded residual timing risk, not a silently discarded failure; no unrelated completion code, sleep or timeout was changed.

Implementation CI: [run 37045796065](https://github.com/raiseCatError/notMyShell/actions/runs/37045796065).

| Platform | Node 22 | Node 26 |
| --- | --- | --- |
| macOS | Passed (attempt 2) | Passed |
| Ubuntu 24.04 | Passed | Passed |

## Remaining limits and physical handoff

- Recovery guards intentionally fail closed if a recoverer crashes while holding one. The error names both paths. Stop all NMSh preset writers and inspect them before manual removal. A reused live PID also requires inspection; it is never presumed dead.
- Kitty cleanup preserves inherited entries still present. A child that over-pops, resets terminal state, or causes the terminal's bounded stack to evict inherited entries can destroy state itself. This change does not reconstruct unknown entries that the child already destroyed. [Kitty specifies independent bounded screen stacks and oldest-entry eviction](https://sw.kovidgoyal.net/kitty/keyboard-protocol/).
- Clipboard failure cleanup covers descendants remaining in the isolated process group. A backend that deliberately creates a separate session escapes group cleanup. Real Wayland/X11 clipboard ownership remains untested.
- The composer is visible during the initial notice delay. Pre-ready submitted commands remain held; the notice stops Enter and offers abort, not an answer to hidden startup prompts.
- The original Ubuntu less failure is dispositioned by an ownership barrier and repeated regression evidence, not a claim that every timing failure is harmless.

**Physical QA remains pending.** In Ghostty/Kitty/Terminal.app, try blocked `.zshrc` startup with early less/vim and ignored SIGINT; verify visible notice and Ctrl+C exit, no surviving session, then normal less/vim after readiness. Check raw keyboard/paste/mouse/resize and selection after an app dies on both main and alternate screens. On Linux desktops, test real wl-copy/xclip/xsel success and bounded failure. Follow the broader [v0.13 physical QA checklist](v013-physical-qa.md). Never close #284 based on CI alone.

For the early-startup check, build the reviewed stack, then use a disposable HOME/config/runtime in the physical terminal (the command below is a handoff, not a test performed here):

```sh
npm run build
qa_root="$(mktemp -d /tmp/nmsh-physical-XXXXXX)"
mkdir -p "$qa_root/home" "$qa_root/config/nmsh" "$qa_root/runtime"
chmod 700 "$qa_root/runtime"
printf '%s\n' '{"onboardingComplete":true,"glyphChoiceComplete":true,"updateChecks":false}' > "$qa_root/config/nmsh/config.json"
printf '%s\n' 'if [[ -t 0 ]]; then trap "" INT; read -k1 "?STARTUP-BLOCKED> "; fi' > "$qa_root/home/.zshrc"
env HOME="$qa_root/home" XDG_CONFIG_HOME="$qa_root/config" NMSH_RUNTIME_DIR="$qa_root/runtime" node dist/index.js
```

Immediately submit `less`, then repeat with `vim` using a fresh launch. The notice must appear after 1.5 s; typed q must not answer the hidden read; Ctrl+C must exit with startup-aborted feedback and end the session. Confirm no live session remains before removing the disposable root. Use a clean disposable `.zshrc` for post-ready less/vim and the broader physical tests. Do not use a recursively managed NMSh terminal for this check.

Final disk check: **3.05 GiB free**; continue only while free disk is at least 1 GiB. `.serena/` and existing worktrees were preserved.
