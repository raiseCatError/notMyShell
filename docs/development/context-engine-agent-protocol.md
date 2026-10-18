# Context Engine agent protocol

GitHub is durable program memory. Chat history is guidance, not repository evidence.

Before editing:

1. Inspect the repository and applicable instructions, including `AGENTS.md`.
2. Read [the canonical design](../design/context-engine.md), [#305](https://github.com/raiseCatError/notMyShell/issues/305), the focused issue, and the most recent implementation/checkpoint comments.
3. Report current branch, exact HEAD, intended base and `git status`. Check the actual implementation before trusting an earlier summary. Preserve intentional uncommitted changes; stop on unexpected scope.
4. Confirm the requested slice and its dependencies. Use current `dev` unless the user explicitly names an accepted foundation/base. Do not use another agent's worktree.

During work:

- Preserve the design's security/privacy invariants. Modules have no unrestricted I/O, environment or execution authority. Packs are declarative. Discovery is not execution permission.
- Work one reviewable slice at a time. Never silently broaden scope; record blockers and deferred work.
- Prefer one primary agent; multiple subagents require genuine independent work and applicable authorization. Ordinary reads/tests/tracking are primary-agent work.
- Preserve persistent shell, raw PTY, detached semantic helper, transcript, fullscreen and ScreenPlan boundaries across all three shells.
- Run affected checks and required verification. Distinguish regressions from base/environment failures by reproducing failures at the exact accepted base in an untouched archive or isolated checkout.
- Never claim physical QA that did not occur. Keep human-validation issues open.
- Honor session-specific commit/push/review restrictions. After an **accepted** checkpoint, update the relevant focused issue and umbrella with exact durable evidence. Do not describe an uncommitted tree as a committed checkpoint.

Standard issue comment (fill every field; `None` is valid, guesses are not):

```text
CONTEXT ENGINE CHECKPOINT

Branch:
Base:
Commit:
Issue:

Implemented:
Architecture decisions:
Security/privacy:
Config/migration:
Performance:
Validation:
Known base/environment failures:
Deferred:
Next intended slice:
```

Include exact commands/results, links to review artifacts and explicit pending
physical tests. Identify an uncommitted review handoff as such (`Commit: none;
HEAD: <sha>`); update the accepted checkpoint after the user accepts it. No release,
master promotion or issue closure is implied by successful automated verification.
