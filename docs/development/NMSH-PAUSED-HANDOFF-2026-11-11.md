# NMSh paused handoff — 2026-11-11

**Status: development is paused by the owner.** Nothing in this program was merged, tagged, released or published.
Do not resume until the owner explicitly authorizes it.

Snapshot taken 2026-11-11 18:26–18:31 UTC. This document is docs-only. It is committed on branch
`integration/20261111`, on top of the integration candidate `f3d54dbf`, so it doesn't change any PR head. A copy is
kept at `/Volumes/T7Tmp/ai-dev/nq/evidence/NMSH-PAUSED-HANDOFF-2026-11-11.md`.

GitHub is the source of truth: `raiseCatError/notMyShell`, PRs #513, #514, #524 and #541–#547, issues #426 and #473.
Read `AGENTS.md` first. Every rule there still applies: PRs target `dev`, `Refs #N` for anything that needs a human
terminal test, no AI attribution, no version bump without release authorization, never merge to `master`, and automated
tests are not physical validation.

---

## 1. Repository state (snapshot)

| Ref | SHA | Notes |
|---|---|---|
| `origin/dev` | `c690de055daeb7b33ed8b5e302ef01133b3e55b4` | Its own push CI run **40512364215 is red**: a cross-profile live test that #513 fixes. Later "success" runs on dev are Dependabot-only. |
| `origin/master` | `bf9b532bd5a22b3f03e716c9c41e3fb33043dba0` | Released state. The latest release is v0.23.0; the next would be 0.24.0. |
| `integration/20261111` | candidate `f3d54dbfa70f6d46012de6683b07932e5e72021e`, plus this docs commit | See section 3. Pushed. No PR. Never merged. |

Hosted CI and runs: at the snapshot, no workflow run was queued or in progress. Pushing `integration/20261111` started
nothing, because CI runs only on push to `master`/`dev`, on PRs, and on manual dispatch.

## 2. PRs in this program (snapshot 18:27 UTC)

| PR | Branch @ head | State | CI on head | Depends on | Human test |
|---|---|---|---|---|---|
| #513 | `fix/host-profile-completion-sync` @ `a57568be` | ready (not draft) | green, normal PR run. Manual comprehensive run 40521955602 **failed** (macOS 3/3: input-ownership race fixed by #514) | — | no |
| #514 | `fix/input-ownership-race-20261028` @ `416bc51a` | draft | green, normal. Manual comprehensive run 40630147755 **failed** (macOS 1/3, `browserConsoleChrome.test.ts:106`, cause never logged; see #546) | — | yes |
| #541 | `fix/queue-mode-20261111` @ `a053031e` | draft, **stacked on #514** (merges `416bc51a`) | **red on every Tests shard, macOS and Ubuntu**, run 43068792027 (see §6.1, first fix on resume) | #514 | yes |
| #542 | `fix/startup-sessions-20261111` @ `b63cc3b1` | draft | green, run 43065468653 | — | yes |
| #543 | `feature/rex-program-status-20261111` @ `cece7ed9` | draft | red: only macOS 1/3 (`browserConsoleChrome.test.ts:106` Mermaid flake). Ubuntu and Node 22 green | — | yes (Rex app) |
| #544 | `feature/session-lifecycle-20261111` @ `c7a749e2` | draft, **stacked on #542** | green, run 43069026603 | #542 | yes |
| #545 | `fix/editor-dialog-long-path` @ `2ca4db39` | draft | red: only macOS 1/3, `typingAfterRead` zsh live test (dev code, intermittent). The owner asked for **no rerun** | — | yes |
| #546 | `test/mermaid-render-result-message` @ `f22c4ae4` | draft, test-only | green, run 43071749594 | — | no |
| #547 | `feature/ask-conversational-20261111` @ `32517f9c` | draft, **not in the candidate** (needs explicit approval) | red: macOS 3/3 (Mermaid flake) and Ubuntu 3/3 (`inputOwnership` waiting-read live test). Neither touched by #547 | — | yes |
| #524 | `feature/release-workflow-20261029` @ `a3541137` | draft | red: Ubuntu 3/3 `/resume shows LIVE and ARCHIVED; Kill Session…` (old run 40758414038) | — | requires a QA record before publishing |

**Merge order (only after the owner's single approval):**
#513 → #514 → #541 → #543 → #542 → #544 → (#546, test-only, optional) → (#545, independent, after its human test).
Use merge commits. Before each merge, check that the next PR's head still equals the SHA above. Add the
`needs-human-test` label and a testing handoff on #426 and #473. Never merge to `master`. #547 and #524 are separate decisions.

Other open PRs **outside this program**, left untouched:
- the appearance/backup stack #515–#522 and #525–#536 (stacked drafts from 2026-10-28/29)
- #523 (an earlier Mermaid-reason test, now overlapping #546; reconcile on resume)
- #483 (arcade batch 2)
- Dependabot #471, #538, #539, #540

## 3. Integration candidate

`integration/20261111` @ `f3d54dbf`, built from `origin/dev` `c690de05` by merging in order:

| Order | Component | SHA | Resolution |
|---|---|---|---|
| 1 | #513 | `a57568be` | clean |
| 2 | #541 (contains #514 `416bc51a`) | `a053031e` | clean (#514 already merged into #541 with a verified resolution, commit `aa2231bd`) |
| 3 | #543 | `cece7ed9` | CHANGELOG: keep both entries |
| 4 | #542 | `b63cc3b1` | CHANGELOG: keep both |
| 5 | #544 | `c7a749e2` | CHANGELOG: keep both. `src/setup/SetupCat.ts`: keep #544's two lifecycle rows plus #541's `commandQueue` note |
| 6 | #546 | `f22c4ae4` | clean (test-only; included so a comprehensive run records the Mermaid failure code) |

- `npm run build` passed on `f3d54dbf`.
- **No full local verify, normal CI or comprehensive CI has run on the candidate yet.**
- It inherits #541's red live tests (§6.1). Rebuild it after fixing them.

## 4. What is done vs. unverified

**Done (implemented, unit/fixture-tested, pushed):**
- **#541 queue composer.** This replaced the earlier standing "Queue Mode", plus an owner-side hold for late-detected
  readers (`QueueDispatcher.onInputRequest`), cancellation of unfinished zsh/Bash lines (PS2 marker), and accurate
  program names ("the command" for compound lines). Fixture suites passed 274/274. Live composer tests passed on zsh,
  Bash and Fish (Fish on rerun). The live race test passed at 0 and 300 ms.
- **#542 picker.** Distinct Resume, New and Kill; counted confirmations; the kill reports only what the service proved.
- **#543 Rex.** Host semantics (OSC 7 and OSC 133), the host named "Rex", OSC 7501 status in NMSh's own record. No status
  inside tmux, screen or Zellij. The record is cleared on an abnormal exit.
- **#544 lifecycle policy** (§8).
- **#545 / #546** (§9).
- **#547 `/ask`** (§10).

**Unverified or partial:**
- **#541 is red on CI** because #514's live tests weren't updated for the naming change (§6.1).
- There is no full local verify on the combined tree, and no comprehensive CI run on it.
- No physical terminal QA anywhere (Rex, Ghostty, Terminal.app).
- Fish unfinished lines: an unclosed quote leaves Fish waiting and absorbs later input until Ctrl+C. This is pre-existing
  on dev and not fixed. A possible approach is a Fish Enter binding using `commandline --is-valid`.
- #547: only llama.cpp was run for real. Its performance numbers were taken under varying load and should be re-measured.

## 5. Queue and input-ownership safety (read before touching #514 or #541)

- **Plain Enter keeps #514's rule.** An echoing terminal is no evidence that a program reads. A line NMSh can't place is
  held unseen ("Can't tell whether … is reading your typing") until Ctrl+S (send), Tab (show), Esc (discard) or
  Ctrl+Q (review for queue).
- **The standing "Queue Mode" was removed on purpose.** On macOS nothing reports that a program reads with no prompt, so
  no setting can make Enter safely mean "queue" for every command. The setting `queue.queueMode` and `/queue mode` are gone.
- **Queue composer.** Ctrl+Q on an empty line while a command runs opens it **for that command only**. Each Enter queues
  the line as typed, without approval, until Esc, a second Ctrl+Q, or the end of that command.
  - Its first key is looked at like the normal composer's: hidden input closes it and holds the typing unseen.
  - An input request reported while it's empty closes it.
  - A line already begun in it stays a queued command.
- **Owner-side hold.** When the running command is first reported asking for input, the session service holds every
  entry queued since that command was submitted, and hides their text for hidden input. This happens before any dispatch.
- **Undetected-reader limitation (cannot be removed on macOS).** A reader NMSh never sees before it ends, such as a
  prompt-less external reader or a timed read that gives up within about a second: a line typed for it into the queue
  composer runs afterwards as a command, exactly as a Ctrl+Q line always has. A secret typed with echo on into the
  composer is shown and queued.
- Tests: `queueComposer.test.ts`, `queueComposerLive.test.ts`, `queueComposerRaceLive.test.ts` (#514's controlled race
  fixture, byte-identical copies), `queueReplyHold.test.ts`, `incompleteSubmission.test.ts`.

## 6. Test and CI failures

### 6.1 #541 red on all shards — FIRST thing to fix on resume
Run 43068792027 on `a053031e`. Logs: `/Volumes/T7Tmp/ai-dev/nq/evidence/ci-snapshot/pr541-*.txt`.

The failing tests are #514's live tests in:
- `tests/inputOwnershipRaceLive.test.ts` (lines 30, 33)
- `tests/inputOwnershipSecretsLive.test.ts` (lines 49, 148)
- `tests/inputOwnershipLive.test.ts` (line 142)

They wait for "Can't tell whether **read**/**sleep**/**for** is reading your typing" on compound lines (for example
`read -r QA_RACE; printf …`). Since #541, compound lines are named "the command". The CI screens show "Can't tell whether
the command is reading your typing" in three shards, so the hold works and the expectations are stale. Fix: update those
regexes the same way the fixture tests were updated in commit `aa2231bd`. Then rerun those files on zsh, Bash and Fish
before pushing.

`tests/typingAfterRead.test.ts` ("keys typed the moment a read finishes") also failed in that run. It is **intermittent
on unchanged dev code too** (it failed on #545's CI), so treat it separately.

The `arcadeAll` "disposed game" item is a ⚠ known-failure (todo) entry, not a failure.

### 6.2 Local failures that also happen on pristine dev on this Mac
All of these pass on hosted CI. Evidence: `/Volumes/T7Tmp/ai-dev/nq/evidence/preexisting-failures/HANDOFF.md`.

| Test | Cause | Status |
|---|---|---|
| `muxInterop` GNU screen | no `LANG` in the desktop app's environment | environmental |
| `shellIntelligence` alias refresh | no `LANG` | environmental |
| `tmpdirHygiene` | test root of 32 characters or more (`/Volumes/T7Tmp/ai-dev/nq` gives 34) | environmental |
| `textEditor` "Esc with unsaved changes" | the long root exposed a real bug | **fixed in #545** |
| configured-completion 4096 bound; "attached session refuses a second frontend" | seen by the lifecycle session on pristine dev under load | not investigated |

**A clean local gate needs:** `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev LANG=en_US.UTF-8`, and load under about 10.

### 6.3 Intermittent hosted CI failures (pre-existing; not caused by these PRs)
- **`browserConsoleChrome.test.ts:106` (Mermaid render, macOS 1/3):** runs 40630147755 and 43064876487, and on #547.
  The code has never been recorded; #546 makes it print.
- **`typingAfterRead` zsh "keys typed the moment a read finishes":** #545 run 43067973683 and #541.
- **Ubuntu `inputOwnershipLive` "a waiting read gets the answer…":** #547.
- **Earlier Ubuntu failures** on 2026-11-11 before about 17:00 UTC were an apt mirror DNS outage
  (`Temporary failure resolving 'azure.archive.ubuntu.com'`). No NMSh test ran in them.

### 6.4 Local full-suite timeouts
Full suites run in parallel (load average 25–68) produced many "timed out waiting for /zsh|bash|fish/" failures with
`outputBytes: 0`. The NMSh frontend's module load alone measured 12–21 s at that load, against a 20 s startup budget.
This is **not proven** to be the only cause. Re-run on a quiet machine before drawing conclusions.

## 7. Rex (#543) and physical QA
- **Checked:** Rex Beta 0.1.0-preview.14 by scripted CLI only, with isolated sessions that were killed afterwards. The
  owner's Rex session `humming-grotto` was never touched. Rex's block API showed `working`, `blocked permission`,
  `blocked auth` and `error`, with no secret in scrollback. Resize used `rex block call resize`. #544 verified with real
  Rex that a pane close or `rex kill` only detaches.
- **Not checked:** physical keys in Rex (whether Rex takes Ctrl+Q or Ctrl+S), how Rex's UI presents the status, and
  `xterm-rex` terminfo (not installed).
- **Physical QA still required:**
  - Queue composer (§5) in Rex, Ghostty and Terminal.app.
  - zsh `echo "Finished!"` gets cancelled and explained.
  - Picker and lifecycle steps (#542 and #544 bodies).
  - #545 editor dialog with a long path.
  - #547 Ask streaming, Esc and Copy.
  - #514's Ghostty/Zed checklist.
  - v0.22's waived QA (#473).

## 8. Session picker, cleanup and idle policy (#542 + #544)

| Situation | Result | Automatic? |
|---|---|---|
| Window close, detach, frontend crash, Rex pane close or Rex quit | detach only; the shell keeps running | never ends |
| Detached, **never ran a command**, past the grace period (default 10 min; Off, 10, 30 or 60 min) | ended after re-verifying, right before, that it is detached, unused, unprotected, idle and has no child processes | **yes (new default)** |
| Used, idle, detached for over a day | tagged "cleanup suggested"; **I** reviews, **E** ends all eligible | needs confirmation |
| Idle expiry (Off by default; 1, 3 or 7 days) | ended after the same re-verification | only if turned on |
| Attached, running, full-screen, in startup, waiting, queued, tasks, jobs or child processes | never ended by a timer | protected |
| Protected (**P**) | never ended by cleanup or **E**; **X** still works after confirmation | protected |
| **X** End Selected / **E** End All Eligible | lists exact targets; the service re-checks each by id and keeps any that changed | confirmation |
| Explicit end of a shell ignoring SIGHUP | SIGKILL after 3 s, only if the pid is still the service's own child | part of the confirmed end |
| Session service crash or SIGKILL | shells end; the next launch archives each with a "service stopped" note; no auto-restart | — |
| Sessions from older services or windows with no stated policy | never ended by a timer | — |

Transcripts are always kept. **Risks:**
- the 10-minute default for unused sessions;
- shell helpers (gitstatusd) count as children, so those sessions are never cleaned;
- the 3 s SIGKILL can cut slow exit hooks short;
- settings reach the service at its next hello.

Settings: Config → Sessions → *Clean up unused sessions* and *End idle sessions*.

## 9. #545 and #546
- **#545** shortens an editor dialog's file path from the left so "has unsaved changes." stays visible. It has a
  regression test. Human check: in an 80-column Ghostty or Terminal.app, `/edit` a long-path file, type, press Esc.
- **#546** makes the Mermaid assertion print its result code on failure. It is test-only and green.

## 10. `/ask` (#547) — kept out of the candidate
- **Before:** Ask only mapped requests onto NMSh capabilities, and the 0.6B intent model misrouted questions (for example
  arithmetic became "This session runs Fish").
- **After:** questions Ask can't place, and follow-ups, are answered by the local model through a new `answer` task in
  the existing model service.
  - Streaming: llama.cpp and LM Studio over SSE, Ollama over NDJSON.
  - Qwen3 non-thinking by default; an optional "Think it through" pass.
  - At most 6 history turns, in memory only, per Ask.
  - Model text is sanitized, and nothing generated is executable.
  - Terminal context is sent only on request, redacted and bounded.
  - Routing stays deterministic and the model never routes. Actions keep their confirmations, and command suggestions
    stay Copy/Insert only.
- **Real Qwen3-0.6B-Q8_0 on an M2 8 GB:** 48 of 49 routes as expected.
  - Good: short facts, rewrites, translations, and admitting it has no access.
  - Wrong: "capital of Australia" → Sydney; "is 91 prime" inconsistent; git stash explained wrongly; 9.11 vs 9.9 wrong
    when thinking.
  - Performance: cold first text 3.6–4.7 s, warm 0.25–0.9 s, 30–50 tok/s when quiet, about 840 MB steady and
    1.1 GB peak, cancel about 1 ms.
  - The numbers were taken at varying load; re-measure them.
- **Tests:** 174/174 focused, with a fake runtime or stub model (these prove plumbing, not quality).
- **Handoff and evidence:** `/Volumes/T7Tmp/ai-dev/ask-eval-20261111/HANDOFF.md`. Worktree:
  `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/ask-conversational-20261111`, which is clean.

## 11. Storage, scratch and worktrees

- **Policy:** scratch, temp files, test output and disposable worktrees go on `/Volumes/T7Tmp/ai-dev`. Run
  `t7run --check` first, and never fall back to `/tmp` or internal storage. See `~/.config/ai-storage/policy.md`.
- **Scratch and evidence:**
  - `/Volumes/T7Tmp/ai-dev/nq/` (runner `run.mjs`, PR bodies, `integration-plan.md`)
  - `/Volumes/T7Tmp/ai-dev/nq/evidence/` (`queue/`, `ci-snapshot/`, `preexisting-failures/`, `session-lifecycle/`,
    the worktree table `worktrees-table.md`)
  - `/Volumes/T7Tmp/ai-dev/nq-lifecycle/`
  - `/Volumes/T7Tmp/ai-dev/ask-eval-20261111/`
- **This program's worktrees (clean, pushed):**
  - `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/`: `queue-input-20261111` (#541), `rex-status-20261111` (#543),
    `startup-sessions-20261111` (old #542 head `4aeb8486`, superseded), `integration-20261111`,
    `ask-conversational-20261111` (#547).
- **Internal-disk worktrees (against the T7 policy, created by the desktop app):**
  `/Users/jaisukka/Projects/notMyShell/.claude/worktrees/preexisting-failures-524892` (about 199 MB) and
  `…/session-lifecycle-6d30f1` (about 200 MB, including `node_modules` from `npm ci`). Both are clean and fully pushed
  (their branches are #546 and #544). **Not removed.** Removing them is the owner's decision:
  `git worktree remove <path>` after checking that `git status` is clean.
- **Uncommitted or unpushed work outside this program (not touched, at risk):**

  | Worktree | Branch | State |
  |---|---|---|
  | main checkout `/Users/jaisukka/Projects/notMyShell` | `feature/status-strip-2` | 3 modified files (`.serena/project.yml`, `package.json`, `package-lock.json`) and **1 unpushed commit** `7916f2e1` |
  | `/Users/jaisukka/Projects/notMyShell-showreel` | — | 184 dirty paths, no upstream |
  | `notMyShell-runtimes` | — | 1 dirty |
  | `T7Tmp/.../appearance-welcome-20261028` | — | 1 dirty |
  | `T7Tmp/.../website-links` | — | 1 dirty |
  | `T7Tmp/.../v022-harden-base` | — | 3 dirty |
  | `T7Tmp/.../v022-smoke` | — | 13 unpushed |
  | `T7Tmp/.../v024-console` | — | 1 unpushed |

  The full table is in `/Volumes/T7Tmp/ai-dev/nq/evidence/worktrees-table.md`.

## 12. Background processes
- **Stopped** (SIGTERM, after verifying each one's command line and working directory were inside the lifecycle
  session's T7 test roots): orphaned test session services 11197 and 11204 (`src/sessionService.ts` from the
  `session-lifecycle-6d30f1` worktree), their esbuild helpers 11210 and 11214, and their test shells 11275 and 11278.
- **Could NOT be stopped:** PID **13177** `/bin/zsh -i`, an orphaned test shell from the lifecycle session's dev
  comparison run. Its working directory is
  `/Volumes/T7Tmp/ai-dev/nq-lifecycle/cmp-dev/nt-vwzTwe/nmsh-live-TQgpQf/h`, and it ignores SIGTERM. Sending SIGHUP or
  SIGKILL was blocked by the agent's permission check, so it is left for the owner: first confirm with
  `lsof -a -p 13177 -d cwd`, then run `kill -HUP 13177` (or `kill -9 13177`).
- **Not agent-owned, left running:** the owner's Rex server processes and any real NMSh sessions.
- No model server (llama-server, Ollama) was left running. No CI runs are in progress.
- Agent sessions: the failures, lifecycle and `/ask` sessions are all idle, each with a handoff.

## 13. What to do FIRST when development resumes
1. With the owner's authorization, read `AGENTS.md`, this file, and the descriptions of #541–#547.
2. Run `t7run --check`; mount T7 if needed.
3. Fix §6.1 on #541: update the stale "Can't tell whether read/sleep/for" expectations in the three live files to
   "the command" for compound lines. Change nothing else.
4. Rebuild the candidate (§3) from the then-current `origin/dev` with the exact PR heads.
5. Run the full local gate once, sequentially and on a quiet machine.
6. Push the candidate, and dispatch **one** comprehensive CI run on its exact SHA.
7. Run the scripted Rex check, then hand over the physical QA list.
8. Ask the owner for one integration approval.

## 14. Exact commands to resume safely
```bash
t7run --check
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/queue-input-20261111 && git fetch origin && git status && git log --oneline -1
grep -nE "Can.t tell whether" tests/inputOwnershipRaceLive.test.ts tests/inputOwnershipSecretsLive.test.ts tests/inputOwnershipLive.test.ts
uptime
NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev LANG=en_US.UTF-8 t7run node /Volumes/T7Tmp/ai-dev/nq/run.mjs . tests/inputOwnershipRaceLive.test.ts tests/inputOwnershipSecretsLive.test.ts tests/inputOwnershipLive.test.ts tests/queueComposer.test.ts tests/queueComposerLive.test.ts tests/queueComposerRaceLive.test.ts
git -C /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/integration-20261111 fetch origin
git -C /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/integration-20261111 worktree add -b integration/<date> /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/integration-<date> origin/dev
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/integration-<date> && git merge --no-ff --no-edit <#513 head>   # then each head in §3 order, one merge at a time
NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev LANG=en_US.UTF-8 t7run npm run verify > /Volumes/T7Tmp/ai-dev/nq/evidence/candidate-verify.txt 2>&1
gh workflow run CI --ref integration/<date>
```

Notes:
- Before the `uptime` step, edit the three live files, commit and push.
- Run the focused live tests only when load is under about 10.
- Build the new candidate on a **new** branch and worktree. Don't reset `integration/20261111`: it holds this handoff.
- Merge the candidate heads in the order of §3, keeping both CHANGELOG entries and both `SetupCat` rows.
- `gh workflow run` dispatches the comprehensive run; dispatch it once only, and read failed logs before any rerun.

**Order:** focused tests → candidate build → one full local verify (only one suite on the machine) → normal CI on
every PR head → one comprehensive dispatch on the candidate SHA → scripted Rex check → physical QA by the owner →
single approval → merges in the §2 order.

## Instructions for a Fresh Claude Session

> You are resuming NMSh (`raiseCatError/notMyShell`) after a deliberate pause. Do nothing until the owner explicitly
> authorizes resumption.
>
> Then read `AGENTS.md`, and `docs/development/NMSH-PAUSED-HANDOFF-2026-11-11.md` on branch `integration/20261111`.
> Reconstruct the state from GitHub, not memory:
> - `gh pr view` for #513, #514, #541, #542, #543, #544, #545, #546, #547 and #524;
> - `git fetch origin`;
> - compare each PR head with the SHAs in §2 of the handoff. If any moved, find out why before trusting anything.
>
> Rules:
> - Work only on `/Volumes/T7Tmp/ai-dev`: run `t7run --check`, put worktrees in `/Volumes/T7Tmp/ai-dev/worktrees/`, and
>   never use `/tmp` or internal storage.
> - Run one full test suite at a time, at load under about 10, with `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev
>   LANG=en_US.UTF-8`. Keep every failure log, and don't blame timeouts on load without evidence.
> - Never kill the owner's real NMSh or Rex sessions. Never merge, tag, release or bump the version without the owner's
>   single approval of an exact pinned candidate.
> - No AI attribution in commits or PRs. Use `Refs #N` where a human test is needed.
> - Do not reintroduce a standing "Enter queues" mode: plain Enter must keep #514's rule (§5).
>
> First task: fix the stale live-test expectations on #541 (§6.1), verify them focused, push. Then follow §13 to build
> and verify the pinned candidate. Report exact SHAs, test results, CI run IDs, and the physical QA still needed.
> `/ask` (#547) stays out of the candidate unless the owner approves it.
