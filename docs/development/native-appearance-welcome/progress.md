# Native appearance / welcome checkpoint

Status: research and environment preparation only; NO product code implemented.
Date: 2026-10-28. This is a fresh task, not a continuation of stabilization.

Repository: https://github.com/raiseCatError/notMyShell
Primary checkout: /Users/jaisukka/Projects/notMyShell (preserved, not used for feature edits).
Worktree: /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/appearance-welcome-20261028
Branch: feature/appearance-welcome-20261028
Base/upstream when created: origin/dev at c690de055daeb7b33ed8b5e302ef01133b3e55b4.
At this initial checkpoint HEAD is that base, no source changes, branch not pushed, no feature PR.
Checkpoint documents are the only pending edits. Query Git for later checkpoint commit SHA; documents cannot embed their own commit hash.
Two existing shared stashes were inspected and left untouched.

Completed: mandatory ownership report read; physical T7/APFS backing verified outside sandbox; remote dev fetched; isolated worktree created; relevant architecture and official/community sources inspected; installed versions checked; Ghostty 1.4.0 staged on T7 and signature verified.
Pending: implementation, complete visual-system audit, full research pinning of shipped catalogs/versions, deterministic tests, baseline/canonical verification, performance, independent review, exact-head CI and physical QA.

User requires separate reviewable implementation slices for host ownership/appearance, Kitty, Ghostty, welcome layout, bounded animation/graphics, and integration. No required feature is silently deferred. See HANDOFF and DECISIONS for required scope and next step.

A required brainstorming approval/opt-out question is pending in the Codex UI. User has supplied additional scope and authorized host updates, but has not explicitly answered that question. Do not assume elapsed time constitutes approval. Resolve this process gate before product code/dependency setup. There is no technical storage blocker after elevated preflight.
