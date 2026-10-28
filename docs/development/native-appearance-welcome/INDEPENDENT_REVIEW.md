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
