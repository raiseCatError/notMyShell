# CI verification implementation plan

Goal: shorten local and PR feedback without reducing canonical platform coverage.
Architecture: preserve the canonical runner and ranking isolation; partition whole
runtime files using measured weights. Separate quality, minimum-runtime smoke,
and dev/manual release evidence. Keep required aggregate checks always present.
Scope: active feature/v017-compatibility-discovery branch and PR #309 only.

- [x] Inspect runner, workflow, package scripts, docs and observed Actions timings.
- [x] Measure the unchanged canonical suite and inspect slow files.
- [x] Test selection invariants before implementing the shard helper.
- [x] Add explicit fast/Node 22/Fedora lists and local verification commands.
- [x] Replace duplicated full-suite matrix with platform shards and separate gates.
- [x] Preserve required status aliases and test docs-only/failure behavior.
- [x] Update development and exact-release instructions.
- [x] Run local aggregates, both shards, benchmark smoke and workflow validation.
- [ ] Commit coherently as J, push and compare actual Actions timings.

Review focus: exact suite union, ranking contention, invalid shard arguments,
code-to-doc renames, skipped/failed required gates, built-launcher test execution,
Linux prerequisite/security checks and helper-process cleanup.
