# v0.13 portability work plan

Frozen base: #278 at cfc9c08a5fb7b5f3bc637400a59da7a714a58ae4.
Milestone: #13. Research parents: #18 and #19. Linux child: #279.

## Constraints

Keep persistent real zsh, isolated semantic/completion helpers, raw PTY bytes,
capability-driven frontend and macOS behavior. Version remains 0.7.0. Every PR
stacks on its predecessor, with no merges/releases/tags. Physical QA is deferred.

## Ordered deliverables

1. Audit current sources and dependency implementation; document #18 findings.
2. Linux baseline (#279): resolve executable zsh consistently before allocating
   bootstrap resources; select a verified private XDG runtime directory on Linux
   with short-socket fallback; retain macOS locations. Tests exercise missing zsh,
   spaces/Unicode/symlinks, runtime privacy, host capabilities and existing real
   PTY/service/frontend lifecycles. Notifications remain optional no-op on Linux.
3. Extend the single canonical workflow to Ubuntu 24.04 and macOS, Node 22/26.
   Install zsh and native build prerequisites on Linux. Keep optional-tool skips.
   Typecheck benchmark scripts and retain process/temp-root leak checks.
4. Use actual Linux CI failures to fix narrowly scoped portability defects in
   this new branch. No lower branch is rewritten. Full macOS suite is required.
5. Research native Windows/ConPTY and WSL using current dependency and official
   documentation plus #17 findings. No additional shell backend implementation.
6. Audit cumulative platform hits, packaging and timing; fix proven leaks in a
   separate hardening PR only if justified. Final acceptance/docs PR records
   actual evidence and additive docs/testing/v013-physical-qa.md.

## Verification

Test changes before implementation where practical; run focused tests, build,
typecheck, full suite and diff check for every implementation PR. Linux runtime
proof comes from hosted Linux canonical tests, never a simulated platform flag.
Inspect disk before full suites and periodically: stop heavy work only below
1 GiB. Preserve .serena and pre-existing processes/temp directories.

## Review focus

HOME quoting and missing HOME; non-executable or absent zsh; unsafe/relative XDG
paths and socket length; genuine Linux job control; platform-specific fixtures.
