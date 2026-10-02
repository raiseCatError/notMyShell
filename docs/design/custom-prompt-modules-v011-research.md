# Custom prompt modules: v0.11 research

Refs #73. This is a design proposal, not implemented custom-module support.

## Current boundary and decision

`src/prompt/configuration.ts` persists a closed `ContextModuleId` union and drops
unknown IDs during normalization. `moduleSegments` in `src/prompt/prompt.ts`
derives built-in values from cached `PromptContext`; `renderedModules` and
`nativePromptSnapshot` already own placement, colors, geometry and historical
presentation. `src/prompt/snapshot.ts` stores rendered data, rather than a recipe
that reruns commands during historical rendering. Extend those paths when the
configuration model is settled; do not introduce a second renderer.

The smallest useful future implementation is static modules first. Even that
needs a durable custom-ID namespace, migration behavior, validation limits and a
module editing/import UX: the current normalizer intentionally rejects unknown
IDs. Issue #73 explicitly remains research/design until its model is agreed.
v0.11 therefore leaves it research-only. No implementation child was created.
Command-backed modules also need visible failure/cache state and an explicit
execution trust boundary; supporting arbitrary command strings now would bypass
those decisions. This is deferred design work, not a technical impossibility.

## Proposed versioned model

A custom entry should have a stable `custom:` ID, display name, enabled state,
left/right placement and a discriminated source: literal text, a cheap known
context value, or an explicitly configured executable plus argv. Formatting
should use the current semantic/identity colors and safe glyph policy. Custom
identity must not overwrite status/error roles. Store the rendered value in the
existing prompt snapshot so resume/history neither launches commands nor changes
the original prompt. Preserve unknown future entries across schema migrations
without executing them.

Visibility can use cached repository state, cwd/project patterns, bounded marker
file checks, cached executable presence and environment-variable **names**. Do
not show environment values in source inspection or launch commands to decide
whether another command should run. Normalize conditions once on configuration
change, and cache marker/executable results by context generation.

## Proposed command safety contract

Command sources require explicit user configuration and argv only. No shell
interpolation or implicit shell-string mode is proposed. Run detached from the
active PTY using the existing bounded provider process facility, after extending
its descendant-cleanup guarantees where necessary. User-selected programs can
still perform arbitrary external side effects; isolation is terminal ownership
and resource containment, not a security sandbox.

Suggested initial limits, to be confirmed by profiling: timeout 500 ms, stdout
4 KiB, discarded/bounded stderr 4 KiB, one displayed line and 80 display columns,
two concurrent module jobs globally, minimum refresh interval five seconds and
an LRU cap of 64 context entries. Strip CSI, OSC, C0/C1 and other terminal controls
before width truncation. Re-render any future hyperlink through existing safe
primitives; never pass command ANSI through. Use cwd/config generations to
discard stale results, abort obsolete work and settle on disable/stop.

Rendering reads a cached value or placeholder immediately. A refresh queue
coalesces repeated cwd changes and never launches per frame or per keystroke.
Cache policy must distinguish stale value, pending, failed, last success and next
refresh; failure retains a bounded stale value or hides the entry. Explicit
refresh must obey the same concurrency/timeout limits.

## Settings and implementation gate

Extend `/prompt` module rows with enabled state, placement, source kind, cache
age/refresh and a sanitized failure reason. Command argv/source inspection must
support redaction; configuration may contain secrets, so avoid logging argv or
stderr by default. Design the config/import review flow before adding commands.

A future child should first settle schema/migration and static modules, then
add the asynchronous command scheduler separately. Required tests include
unknown-ID round trips, snapshot fidelity, narrow widths, NO_COLOR/safe glyphs,
control-sequence injection, timeout/output overflow, cancellation, repeated cwd
changes, bounded concurrency, disabled modules and teardown. Physical QA remains
deferred; v0.11 has no custom-module runtime checks to claim.
