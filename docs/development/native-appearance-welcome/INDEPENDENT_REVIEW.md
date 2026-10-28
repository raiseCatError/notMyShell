# Independent Slice1 source review

Reviewer: separate fresh-context agent appearance_safety_review; read-only; no tests run by reviewer. Scope is the uncommitted safe host appearance slice on a7bbfb33, not the entire Shader/Welcome program.

Initial important findings: Ghostty global include-queue precedence; unresolved theme defaults; staging window for concurrent edits; large blur display crash; host R intercepting Motion replay; valid named background rejected; raw background terminal-control injection. Additional notes: group-writable paths and residual pathname races.

All findings were checked against code/source and pinned with failing behavioral regressions. Fixes: root+global queue order; simulated post-write effective configuration/refusal on shadowing; unknown theme-derived values; post-fsync expected snapshot check; group/world-writable refusal; clamped display and preserved high numeric blur; scoped host shortcuts; bounded named colors and control validation/sanitation. Tests include real concurrent file edit during staging and a controlled ledger rename failure restoring host+fragment.

Final review: no material unresolved blocker in Slice1; high-blur issue resolved. Confirm/apply/removal separated, config reread after success, restore accessible when current values unresolved. POSIX check-to-rename interval remains a documented limit. No claim of arbitrary adversarial race immunity. Canonical verification and physical QA remained pending at review time.

Review content is tied to slice1-source-manifest.json. Before commit, compare current source to that manifest. No product source changes after the final review request.

## Claude continuation review (2026-10-28, separate read-only Sonnet reviewer, source manifest e894b2b5)

No blocker. Both new fixes verified correct by reading (`withoutHook` LF/CRLF/empty/created-file cases; optional Ghostty-only `installKeyboard`).
- should-fix 1: crash recovery. Writes go fragment → host hook → ledger. A crash during REMOVAL after the hook is gone but before fragment/ledger deletion leaves a ledger whose hook is absent; `planHostRemoval` then refuses forever ("owned include missing"). Other crash points block setup with clear messages but lose no user bytes. Planned fix: removal accepts "hook absent + ledger + owned fragment" and deletes only fragment and ledger (host file untouched), with a regression.
- should-fix 2 (plausible): Kitty on macOS also reads `~/Library/Preferences/kitty/kitty.conf`; Kitty uses the FIRST existing config directory, unlike Ghostty's all-roots load. Verify against installed Kitty 0.49.2 (`kitty.constants.config_dir` logic) before changing hostPaths/readHostConfiguration.
- minor: removal preview omits a restored line break; hub guidance not re-rendered after async read when hub closed; tiny window after apply where hub shows pre-write values; rename drops hardlinks/xattrs; stale XDG path blocks removal (fails closed). Recorded, not fixed in Slice 1.
- Resolution: should-fix 1 FIXED (removal with the hook already absent deletes only the hash-verified fragment and ledger; the host file is a dependency, not changed). should-fix 2 CONFIRMED by probing installed Kitty (kitty-config-dir-evidence.md) and FIXED (worse than reported: Kitty would have loaded a new hook-only XDG file instead of the user's Preferences config). Minor items remain documented.

## Slice 2 review (2026-10-28, separate read-only Sonnet reviewer, uncommitted diff on 4abd014d)

Reviewer read the diff against Kitty v0.49.2 `slang.py`, ran tsc and the two focused files (pass). No blocker.

Should-fix, all FIXED with regressions:
1. Removal refused when an owned fragment/pipeline was missing or hand-edited; and sync refused (drift, launch, inspection problems) even when the gates left no NMSh effect, so Reduced Motion could not turn effects off. → removal is lenient (deletes intact owned files, keeps an edited one unreferenced, skips a missing one, removes hook + ledger); taking every NMSh effect out writes NMSh-owned files directly, regardless of drift or launch state; adding reviewed groups back skips the launch re-check but still refuses on drift.
2. A written Kitty trail with cursor_trail 0 made Portable stop drawing while Kitty drew nothing. → `writtenKittyTrail` requires the recorded hook present, an active fragment, a trail group AND effective cursor_trail > 0; cursor facts are refreshed when NMSh's Kitty cursor fragment changes.
3. A failed/unsupported catalog read was cached for the process (and a rejection could leave the panel stuck). → only supported catalogs are cached; failures retry; rejections become an unsupported catalog.
4. One failing build disables the whole shared `end` slot (user shaders too). → disclosed in the review guidance; leaked vars that NMSh cannot pin (multi-line or repeated declarations) now refuse instead of being missed.

Minor, handled: `~user/` entries refuse (not guessed); R works on unsupported Kitty; confirmation re-plans and refuses if gates/files changed since the review; opening the studio applies gate changes made while NMSh was not running.
Minor, documented only: symlinked user pipelines refuse (safe, by design of Slice 1 reads); `ps` launch check can block up to 2 s on open/review/sync; Unicode-space splitting in `shellWords` differs from shlex (resolution only; raw value preserved); `unitPair` accepts hex numbers Kitty rejects (user pipelines only; NMSh never emits them).

## Slice 3 (Ghostty native shaders) — Codex gpt-6.1-sol, read-only, 2026-10-28

Full review: evidence `slice3-review/REVIEW.md`. No blocker. All items fixed by the lead with regressions:

1. Should-fix: successive trail changes replaced the pending record (legacy → Smear → Comet lost the /cursor shader). Fixed: pending trails accumulate; 'nmsh-cursor' wins.
2. Should-fix: a refused sync or unsaved reload record let Portable draw over a written trail. Fixed: a written studio trail suppresses Portable motion whenever native does not handle motion; in-memory fallback in the controller.
3. Should-fix: studio confirm called /cursor's writer outside the reviewed transaction. Fixed: removed; ledger `legacyPaused`; removal resumes the exact paused fragment in the same transaction, or says it was left alone.
4. Should-fix: no startup reconciliation. Fixed: one sync at app construction (no process-table read).
5. Should-fix: sync substituted the recorded version for an explicitly unsupported running version. Fixed: `hidden` capability; >1.4.x fails closed; sync removes passes with the reason.
6. Minor: Smear note claimed redraws only while fading. Fixed; every plan discloses Ghostty's animation loop.
7. Minor: short windows hid the reload warning. Fixed: compact pending line.
