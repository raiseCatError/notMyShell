# v0.22 ledger

Durable state of the v0.22 candidate (#431) so a later session can resume without rediscovering it. Design and
acceptance: [v0.22 design](../design/v022-daily-use.md). Automated results here are not physical-terminal validation.

## Baseline (verified 2026-10-18)

- `dev` = `a8b383c2` (v0.21 integrated, plus #425, #427, #428). `master` = `6af5cbab` (v0.20.0 line), an ancestor of
  `dev`. `release/v0.21.0` = `d9e08393` (`dev` at `433af8fd` plus the candidate commit).
- PR #430 (`dev` → `release/v0.21.0`) has merged: merge commit `86bb3a6c` (dated 22:02 IST), which contains `dev`
  `a8b383c2`. GitHub still reported it open when this session first checked. Draft PR #429 is the v0.21 release.
- **v0.22 PRs stay draft against `dev` until v0.21 ships**: a fix v0.21's QA needs lands on `dev` and reaches the
  release by another `dev` → release merge, which would carry anything v0.22 merged earlier. Nothing in v0.22
  touches `release/v0.21.0`, its QA evidence, `master` or publishing.
- Worktree: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022` (APFS volume `T7Tmp`, UUID
  `62D4E8A9-087C-4927-A62F-25BB88B7F1C7`); unfixed comparison worktree `…/v022-base` (detached at `a8b383c2`).
  Scratch and evidence: `/Volumes/T7Tmp/ai-dev/scratch/v022/`. Tests run with `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev`.

## Slices

| # | Slice | Issues | Branch / PR | State |
| --- | --- | --- | --- | --- |
| 0 | Design, ledger, NL proposal | #431, #432 | `docs/v022-design` / #435 (this ledger's PR) | Draft PR |
| R1 | Input ownership under load | #426 | `fix/v022-input-ownership-look` / #433 | Draft PR; redesigned after review (held keys never fall through on a timeout) |
| R3 | Type-ahead eaten after Ctrl+C or a slow prompt hook | #436 | `fix/v022-ctrlc-type-ahead` / #437, based on #433 | Draft PR; two mechanisms reproduced and fixed, the race family not declared solved; carries the combined #433 + #437 fix |
| T1 | Live tests wait for NMSh's journal, not screen text | — | `fix/v022-queue-live-sync` / #442 | Draft PR, test only; CI green |
| R2 | Fish keys after a handed-over read | #356 | — | Not reproduced (32/32 at 8×); left open, deferred |
| — | Fish 3.7 on Linux: output and markers from Fish sometimes lost | #443 | — | Seen 3 times in CI; not reproduced; cause unverified |
| U1 | `/view` → open in editor | #366 | `feature/v022-view-open-editor` / #434 | Draft PR |
| D1 | History browsing, one step per entry | #389 | `feature/v022-history-browse` / #438 | Draft PR (approved as D1) |
| D1b | `History n/N` on a free composer rule | #389 | `feature/v022-history-position` / #441, based on #438 | Draft PR |
| D3 | Choose a terminal editor | #366 | `feature/v022-editor-choice` / #439 | Draft PR (approved as D3) |
| D2 | Ask command suggestions, local model only | #432 | `feature/v022-ask-command-suggestions` / #440 | Draft PR (approved as D2); remote BYOK is a later PR after a security review |

## Decisions

- **Maintainer decisions (2026-10-18):** D1 (#389) approved, with the position indicator as a separate slice that uses
  an existing composer edge. D2 (#432) approved as optional: deterministic Ask stays the default, suggestions are Off
  by default, the local model comes first, remote Anthropic/OpenAI-compatible keys (by environment-variable name only)
  come later after a security review, consumer subscriptions are never API credentials, and suggestions are display
  only (Insert is deliberate, Enter runs). D3 (#366) approved: discover installed terminal editors, keep explicit
  preferences first, never install anything.
- **#426: held keys wait for the owner; a timeout is not a route.** The first version routed held text after 5 s and
  on a failed probe, so a password typed for a slow `read -s` or `sudo` could reach the shell as a command. Now:
  - After 5 s without an answer, NMSh looks once more. If it still cannot tell, the keys stay held and the composer
    says so: Ctrl+S sends them to the program, Tab shows them, Esc discards them.
  - Ctrl+C discards held keys, and the command ending routes them as typed.
  - A probe that fails or is unavailable counts as "cannot tell", never as "the shell".
  - Echo-off canonical input is a hidden request.

  12 adversarial regressions fail on the first version (`6958c277`).
- **#426: a runnable first sample is inconclusive.** One sample of a process on a CPU with nothing to compare no longer
  ends a look; when the shell holds its terminal the follow-up decides. Every other evidence path is unchanged.
- **macOS has no kernel read report.** `ps -o wchan` prints `-` for every process on macOS 27 (checked: zsh/bash
  `read`, `cat`, `sleep`, a busy loop, Python `select`, Node stdin), so the two-sample rule stays on macOS.
- **#436: two mechanisms, both reproduced and explained.**
  1. A late input request from the interrupted command arrived after Ctrl+C and took the next typed command as its
     answer. A request older than the stop is now ignored, but only while typing still counts as type-ahead (2 s);
     after that it is re-applied if it is still the latest state.
  2. A slow prompt hook (zsh `precmd`, Bash `PROMPT_COMMAND`, Fish `fish_prompt`) looked like the finished command
     reading input. Each shell now emits an authenticated `done` marker before its other hooks, and it ends the
     look.

  The first hypothesis (the shell's read swallowed the line) was wrong; temporary instrumentation found both, and was
  removed. The wider family of input-timing races is not declared solved.
- **D2: NMSh's label is its own and conservative.** A review found `echo $(rm -rf ~)` labelled "reads only".
  - "Reads only" now needs every part to be plainly read-only: no substitution, no wrapper (`env`, `xargs`…), no
    `find` action, and nothing the `/track` gate questions.
  - The note leads with NMSh's verdict and quotes the model, attributed. An explanation that mentions NMSh is
    rejected.
- **Every new setting is reachable from Setup.** The Setup coverage audit caught D2's and D3's new rows missing from
  Setup; both were added (D3 as a route to the editor chooser).
- **Paused/deferred issues stay as they are** (#330–#332, #337–#340, #333–#335, #341, #398, #399, #304, #296, #15).

## Verification notes

Full canonical `npm run verify` (local, macOS 27, T7 scratch), with the load average at the time:

| PR | Head | Result |
| --- | --- | --- |
| #433 | `e566a1e6` | 3,161 tests, 3,159 pass, 2 skipped, 0 failed |
| #437 | `9aae2f03` | 3,149 tests, 3,147 pass, 2 skipped, 0 failed |
| #437 | `83135298` | 6 live tests timed out at load 20–23; all 6 files 46/46 on rerun. A clean full run is pending |
| #434 | `5d81d93e` | 3,148 tests, 3,146 pass, 2 skipped, 0 failed (load 4–13) |
| #438 | `29d73a69` | 3,143 pass, 1 live timeout (load 9–20); 16/16 rerun at load 5 |
| #439 | `4ab9f44a` | 3 Setup coverage failures (fixed in `898fbc33`), 2 live timeouts (16/16 rerun); a fresh full run is pending |
| #437 | `83135298` (again) | 9 failures, none in #437's logic: 7 startup or teardown timeouts (including #437's own Bash slow-hook test, which stalled before the shell started), 1 frontend that did not exit, and the known #426 queued answer (this branch does not contain #433). Not clean evidence; a rerun is owed |
| #440 | `c1a30017` | not valid evidence: 113 failures under memory exhaustion (about 100 MB free, heavy swap), almost all startup timeouts plus starved benchmarks; a rerun is owed |
| #441 | `48f70e96` | pending; the new tests and nearby suites pass |
| #437 | `e2776680` (with #433) | combined: deterministic input suites 61/61, live `promptHookLive` 2/2 and `inputOwnershipLive` 6/6 (load 15–30, under 100 MB free); full run not repeated under memory pressure |
| #442 | `815ecc52` | `commandQueueLive` 19/19, `typingAfterRead` 3/3, forced-delay variants pass; CI green |

- **CI:**
  - #434, #437, #438, #439 and #440: green.
  - #433's latest run (`e566a1e6`) failed one Ubuntu Fish live test: a queued `printf` got `write: Interrupted
    system call`. The diff changes no signal or resize path, and the test types nothing that would be held. The
    failed jobs were rerun; the result is recorded on #433.
- **R1 live:** 4 copies of `tests/inputOwnershipLive.test.ts` in parallel. The unfixed baseline reproduced #426
  under memory pressure, both as a queued answer and as a drawn hidden reply.
- **CPU contention alone does not reproduce #426:** at load 64 a probe (`stty` + `ps`) took 10 ms p50 and 39 ms
  max. The slow looks came with 5–7 GB of swap.
- **#436:** reproduced 6/8 and 4/8 on `dev` with live runs, and deterministically with a slow prompt hook at load 3.
  `tests/ctrlCTypeAhead.test.ts` and `tests/promptHookLive.test.ts` (live zsh and Bash) fail before the fix.
- **R2 (#356):** Fish 4.9.3, 8 copies in parallel, four rounds: 32/32. A 16-copy run failed at startup in every
  copy (environmental).
- **Environment, not product:**
  - A Finder window on the T7 makes `LiveSandbox.dispose`'s `lsof +D` time out.
  - Spotlight indexing (`mds_stores`) and load above about 20 stall live-test startup on every build.
  - Live tests started while another full run is going time out waiting for the first prompt.

- **#441 CI (`48f70e96`)** failed two live tests. Both are explained; neither is caused by #441.
  - **macOS:** `inputOwnershipLive` zsh, the answer to a read queued: #426's signature, and #441's base does not contain #433. The same failure appears in CI on `feature/v021-themes` (`7d8e1529`) and `stabilize/v0.19.0` (`bcc8e760`).
  - **Ubuntu:** `commandQueueLive` never saw `Running cat`. A race in the test, reproduced on `a8b383c2` and on #441: its wait matched the queued command's text in the queue list before that command's prompt returned (53→83 ms on `dev`, 701→901 ms on #441), so `cat` was queued and the queue row replaced `Running cat`. Fixed in #442.
- **#442 found the same class of race in `typingAfterRead`** (macOS CI): the wait matched before NMSh's journal recorded the command (6/6 rounds on `dev`), reproduced with a read whose output comes 1 s late. #442 makes both tests wait for the journal record; CI green on `815ecc52`.
- **#437 CI on the combined head (`e2776680`)** failed `typingAfterRead` (the race #442 fixes) and Ubuntu Fish `inputOwnershipLive` (#443: Fish's reader marker never arrived; the typed answer stayed held, safely).
- **#443:** three Ubuntu Fish 3.7.0 failures where output or NMSh's markers from Fish never reached NMSh, one with `write: Interrupted system call`. Not reproduced with Fish 4.9.3 on macOS. Unverified hypothesis: `SIGWINCH` from NMSh's terminal resizes interrupting Fish 3.7 writes.

## Release candidate v0.22.0 (2026-10-19)

**Decision:** the maintainer changed the release strategy: ship the latest stable version, not every planned one.
v0.21.0 (#429, CI green, never physically tested) is superseded and never published; v0.22.0 ships its work. No v0.23
work exists (no branches, PRs or labels beyond planning), so v0.22 is the target. Feature freeze from here: only
correctness, security, packaging and release-blocking fixes.

**Integration:** `release/v0.22.0` = `dev` (`a8b383c2`) + #435, #433, #437, #442, #438, #441, #434, #439, #440 merged in
that order with merge commits, then the combined `/view` editor test (#434 with #439) and one release-metadata commit
(version 0.22.0, one `[0.22.0]` changelog section that says v0.21.0 was never published, status pointers, the
consolidated physical QA walkthrough, this runbook). It does not contain `release/v0.21.0`'s two commits: only
metadata (version 0.21.0, a `[0.21.0]` section), replaced here. Conflicts: the CHANGELOG for #439 and #440 (same rule as
the candidate) and `tests/typingAfterRead.test.ts` for #442 (taken from #442, which carries #437's held outcome). Its
tree differs from the green candidate `567cf533` only by the commits below plus #435's ledger commit.

**Security review of hidden input (#426, #433, #437, #442), 2026-10-19:**
- Boundary: NMSh routes typing while a command runs. A hidden reply must never be drawn, queued, written to the shell as
  a command, logged or kept in history; an ordinary next command must never be lost.
- Two paths still let a password run as a shell command on `567cf533`, both fixed in #437 (`6486d9c5`):
  1. After NMSh answered a hidden question, a look that still saw hidden input was attributed to that question for 1 s;
     if the command then ended, the held typing ran as the next command. A second question with no prompt that gave
     up first (a timed read) is indistinguishable, and a time window is no proof. Such typing now waits at the prompt,
     hidden, until the person shows it (Tab) or discards it (Esc, Ctrl+C). The window only separates a probable reply
     (discarded) from unconfirmed typing (held); it never lets typing run.
  2. A reply typed and entered before a question with no prompt existed is queued like any command (nothing asked
     yet). When the command then asks for hidden input, the entries queued while it ran wait for approval (an older
     service: the queue pauses). Live on `567cf533`, zsh and Bash: the second password of `read -rs a; sleep 3; read -rs
     b` ran and entered NMSh's journal; with the fix it never runs and is not in the shell's history file.
- Also: `NMSH_DEBUG_KEYS` never logs typing held at the prompt.
- Verified: consecutive prompt-less hidden questions; a second one reported while the reply is held (it gets it); an
  ordinary command after a hidden answer once echo is back (runs as type-ahead); a prompted `sudo` (unchanged); Ctrl+C
  and Esc while held; a look slower than the slow mark; a next command starting while typing is held; late looks;
  entries queued before the command or with Ctrl+Q during the question (left alone). Deterministic:
  `tests/inputOwnershipSecrets.test.ts` (10; 6 failed before the fix). Live: `tests/inputOwnershipSecretsLive.test.ts`.
- Remaining limits (documented in the changelog): a reply typed before a question with no prompt exists is drawn and
  queued; if that question gives up before NMSh sees it and the command succeeds, the entry runs. zsh's single
  `precmd` function and Fish's other `fish_postexec` handlers run before the done marker. An older session service
  routes typing as before. Holding happens only when a look actually saw hidden input; on an idle machine at human
  typing speed the prompted cases do not reach it.

**Release gate review of `ab5390a4` (2026-10-19, after CI was green):** the candidate was **not releasable**. Probes on
the exact candidate (deterministic fixture, then live zsh and Bash) found four more routes, all fixed in #437
(`6ebf3832`, live test `271e67bb`) with regressions that fail first:
1. Tab on held typing replayed every held key: a Ctrl+Q typed while held queued the revealed text, and an idle queue ran
   it at once (at the prompt, and while a command ran). Tab now replays only text and editing keys.
2. A password typed in the composer before the program printed its prompt (`sudo`) stayed the draft: hidden while asked,
   shown again after, one Enter from running. Live on `ab5390a4`: it ran and entered NMSh's journal. It now leaves the
   composer when the hidden question appears and is held at the prompt when the command ends; type-ahead typed right
   after Ctrl+C stays the next command (#436).
3. The same with its Enter: the Enter went to `sudo` as an empty answer and the password was drawn during the retry. An
   Enter held with such a draft is now dropped.
4. A visible reply queued before NMSh saw a line `read` (CI's first-attempt failure) ran after the command succeeded.
   The approval rule for entries queued while a command ran now covers every question NMSh sees.
- Checked and clean: typed input is never logged (the session backlog keeps output, executed command lines and prompts
  only; `NMSH_DEBUG_KEYS` skips running and held input); queue entries that never run leave no text (skipped entries are
  counted, summaries hold executed commands); composer drafts and session submissions stay in memory; held typing has no
  timer or later look that releases it.
- #443's consequence was re-assessed: a lost Fish 3 marker can make NMSh treat a running program as the idle shell, so
  what is typed for it would be drawn in the composer (by analysis; not observed). Markers are now written again once
  when a write fails (#445). Output loss remains documented.
- Remaining limits, worded in the changelog by case: a reply to a `read` NMSh has not seen yet, input entered before any
  question, hidden input, history, prompt hooks.

**Physical QA:** one consolidated walkthrough for the v0.22 build ([v0.22 physical QA](../testing/v022-physical-qa.md)),
replacing v0.21's (never run) and the per-PR passes.

## Integration plan (superseded: written for after v0.21 shipped)

**Order:** #435 → #433 → #437 → #442 → #438 → #441 → #434 → #439 → #440.
- **#437 now contains #433** (merged into it, `4556dfab`). Its combined fix (`e2776680`) settles held typing as typing for a command that ended when the shell says it is done, and keeps evidence of hidden input; see #437.
- **#441 is based on #438.** Retarget it to `dev` once #438 is in.
- **#442 goes early,** so that later CI runs are meaningful.
- **#439 after #434.** Then add the combined test kept in scratch (`zzViewChosenEditor`): `o` in `/view` composes the chosen terminal editor's command. It passes on the candidate.

**Candidate, built 2026-10-19:** `integration/v022-candidate` = `a8b383c2` plus the nine merges in that order. First head `56da3c56`; after #437's two follow-ups (merged in again), head `567cf533`, tree `2b23866e`. Pushed, with no PR.
- **Conflicts:** the CHANGELOG only, for #439 and #440. Rule: keep every line, and put the incoming bullets at the end of the section they belong to.
- **Verified on the candidate:**
  - type check: clean;
  - deterministic suites: 61/61 (input ownership, including the combined tests), 83/83 (history, indicator, Keep Awake, composer, viewer, editors) and 199/199 (Ask with its coverage audit, Setup, Settings, providers);
  - live: `promptHookLive` 2/2, `typingAfterRead` 3/3, `inputOwnershipLive` 6/6, `commandQueueLive` 19/19;
  - the combined `/view` editor check: passes.
- **First CI run** ([39196110708](https://github.com/raiseCatError/notMyShell/actions/runs/39196110708), `56da3c56`): all jobs green except Ubuntu shard 2. `typingAfterRead` zsh timed out waiting for the journal record of `echo NEXT-ahead3` after a `read -s`.
  - **Not a flake:** a regression in #437's combined fix. Type-ahead after answering a hidden question was discarded, because a look still saw the answered question.
  - **Fixed in #437 (`e391bcb0`);** the automated security review then found that grace unbounded (a second hidden question's reply could run), fixed in `807d3c03`.
  - Regression tests for all three cases; input suites 64/64.
- **Second CI run** ([39197269209](https://github.com/raiseCatError/notMyShell/actions/runs/39197269209), `567cf533`): **all green**. Every job passed: Detect, Quality, Node 22, Tests on macOS and Ubuntu (both shards), the Fedora subset, timing smoke on both, and Verify 22.x and 26.x.
- **Not run:** a full local `npm run verify`, since this 8 GB machine already panicked under memory pressure (see below).

**When v0.21 ships:**
1. Rebuild the candidate from the released `dev`. `[Unreleased]` becomes `[0.21.0]`, and v0.22's entries move into a new `[Unreleased]`.
2. Run `npm run verify` and `verify:release` on its head at reasonable memory (several GB free, no swap storm), CI, and physical QA passes 1–6.
3. Land the PRs in the same order, with the same resolutions.
4. Before announcing, confirm that `dev`'s tree equals the tested head's tree (`git rev-parse HEAD^{tree}`). Any difference means another pass.

**Separate, later slice: remote bring-your-own-key providers for Ask (#432).** These are Anthropic and OpenAI-compatible, configured by environment-variable name only, after a security and credential-handling review. They are not part of the combined pass above.

## Crash recovery (2026-10-19) and findings for the test-resource pass

The machine (8 GB) had a kernel panic: a watchdog timeout with compressed memory full, ten swapfiles and low swap. No v0.22 work was lost.
- **Recovered:**
  - every branch matched its remote;
  - the candidate was intact;
  - this ledger's edits were uncommitted but intact;
  - the scratch evidence was complete, with nothing written after the reboot;
  - no test of this workstream was running at the panic;
  - `git fsck --connectivity-only` found no missing objects.

Findings for the planned performance and test-resource pass:
- **Local full runs on 8 GB are not trustworthy beside other agents and Chrome.** Two of them in this session were wrecked by memory exhaustion (113 and 29 failures, almost all startup timeouts and starved benchmarks). Focused files, one at a time, plus CI gave clean results.
- **Running focused tests while a full run is going** starved both. Runs should be strictly sequential, and a full run should refuse to start below a memory threshold.
- **Live tests spawn a frontend, a session service and a shell each.** With the runner's concurrency on top, they are the main memory cost; a cap tied to free memory would help.
- **Screen-text waits are fragile under load.** The journal (`Frontend.completions`) is the deterministic signal; other screen-text waits should move to it.
- **Orphans:** processes from other worktrees' live sandboxes (two days old, reparented to `launchd`) were found before the panic, so interrupted runs can leave sandboxes behind. Sandbox teardown after a crash needs an owner-checked cleanup.
- **Storage:** all scratch, caches and worktrees were on the T7. The internal SSD was at 96%, which leaves little room for swap.

## Physical QA

Recorded in [v0.22 physical QA](../testing/v022-physical-qa.md): sitting A (Ghostty, zsh) and B1, B3 (Terminal.app,
Fish) on `68c1cbb7`; A12 failed (F04). Nine required passes were not run (the person running QA stopped repetitive
manual testing): B5, B8, B9, B10, C2, C7, C9, C10, D11. Retests R1–R4 cover what changed afterwards.

## Open risks

- v0.21 is superseded; the v0.22 PRs land through `release/v0.22.0` and stay draft until the release PR merges.
- #441 is based on #438 and must merge after it.
- #439 and #434 both use the host-actions bridge; whichever merges second picks up the other.
- #436 fixes two explained mechanisms; other timing races in input ownership may remain.
- #443 (Fish 3.7 on Linux, cause unknown) is open; a bounded CI loop investigates it.

## Stabilization after physical QA (2026-10-19)

Baseline verified first: `release/v0.22.0` = `68c1cbb7` locally and on origin, #444 draft and mergeable, the release
worktree clean. Scratch on `T7Tmp` (`62D4E8A9-087C-4927-A62F-25BB88B7F1C7`, verified mounted). Work in new worktrees
`…/v022-qafix`, `-426`, `-f03`, `-svc`, `v022-html`, `v022-integ`; `v022-qa` (the QA build of `68c1cbb7`) untouched.

| Finding | Kind | Root cause | Fix | Issue / PR |
| --- | --- | --- | --- | --- |
| F04 Ask suggestions | QA failure (A12) | Shell tasks were `unclear`, so Auto let the intent model read them; Qwen3 0.6B answered `files.list` (0.99999) and NMSh answered "list files"; suggestions only follow `unclear` | Shell tasks recognised (`unsupported`, never re-read by the model in Auto or Always); suggestions Off says where they are; a declining model says so | #446 / #447 |
| F02 Pasted NMSh commands | QA bug | Enter submits the composer as one unit: a block starting with `/` was one broken slash command, any other block went to the shell whole | A mixed block opens the reviewed list; One at a time offers each command unsent, next after success, Esc stops | #450 / #451 |
| F03 Queue during a wait | QA UX | Intentional (the question takes the rows), but the headline omitted the approval state and dropped the queue on narrow screens | `≡ 2 queued · 2 for approval`, headline shortened first, bare count last | #452 / #453 |
| F01 HTML in `/view` | Requested feature | — | Native, bounded, never-run HTML subset for HTML files and HTML in Markdown (`/view` only) | #454 / #455 |
| Markdown wrap | Bug found testing F01 | A word that fit only without the space was glued to the previous one | Next word starts the next row | in #455 |
| #426 residual | Security | A line typed before an unseen timed read ran as a command when the command succeeded (reproduced live, zsh/Bash/Fish) | A line not starting with a known command waits for approval | #426 / #448 |
| #426 older service | Clarity | A window never said an older service lacks the protections | Warning keyed on `input-look-result` | #456 |
| #443 Fish 3 markers | Reliability | Fish 3 drops an EINTR'd builtin write and prints the error; #445's single retry printed it and lost a marker interrupted twice | Fish 3 markers via `printf | cat` (cat ignores SIGWINCH, retries EINTR) | #443 / #449 |

Evidence:
- **F04** reproduced with the real model through the real Ask path (`/Volumes/T7Tmp/ai-dev/scratch/v022-qafix/probe-f04`).
  After the fix the QA request gets a suggestion; the model's command quality is low (`convert -density 100 -quality 100
  *png* webp`).
- **#426:** the live test fails first on zsh, Bash and Fish (the reply entered NMSh's journal); 7/7 after.
- **#443:** an LD_PRELOAD shim fails terminal writes with EINTR on CI's Ubuntu Fish 3.7.0. Markers survive 1, 2 and 50
  interruptions with no error shown; the same harness shows #445's helper losing a marker interrupted twice. The
  diagnostic loop on the new helper (run 39252443113): 60/60, 0 interrupted marker writes recorded (before #445: 3/30
  and 2/30 failures). Fish's own builtin output can still lose a write: documented, not fixed (the cause, resizing the
  PTY on layout changes, is the post-release fix).
- **Integration** (`integration/v022-stabilization`): #448, #449, #456, #447, #451, #453, then #455 last (revertible as
  one merge). One conflict, in `routeComposer`: #451's review first, then #448's enqueue rule.
- **PR CI:** all seven fix PRs green. #453's first macOS run failed `inputOwnershipLive` zsh (a waiting read's answer
  timed out); its change only affects the wait headline when entries are queued (none in that test), and the rerun
  passed: the known load race, recorded here, not hidden.
- **Verification on the integrated tree:** typecheck; 140 deterministic files 1,134 pass, 0 fail, 7 skipped;
  live 45/45 (secrets, ownership, prompt hooks, typing after read, queue, paste batch, queue conditions, viewer).
  Sequential, concurrency 1, memory 36–45% free.
- **Statuses:**
  - #436: the two mechanisms stay fixed; prompt-hook live tests pass. Remaining: zsh's single `precmd` and Fish's
    other `fish_postexec` handlers run before the done marker.
  - #356: not reproduced; no new evidence, left deferred.
  - #445: superseded on Fish 3 by #449; still the Fish 4 path.

Decisions and risks:
- F01 is included (opt-in to `/view`; agent replies unchanged), merged last so it can be reverted alone. A2 and C2 need
  R3.
- Ask suggestions now work as designed; their usefulness depends on the model. The release scope is unchanged (off by
  default, local model only), with the quality limit in Known limitations.
- Lesson: `git stash` does not take untracked files. One test file was swept into another branch's commit, amended
  out and force-pushed with a lease (#448, `31fab989` → `3d606e7a`); each branch now has its own worktree.
