# v0.12 presentation design and dependency plan

Frozen base: PR #271 at `4a5ef78968c6e4751ac977b39170514a4ec9e282`. All changes are additive, unmerged, and unreleased; package version remains 0.7.0. Physical QA is deferred.

## Architecture findings for #78

Color/preset, geometry, and motion are independent axes. Reuse Chroma color references and interpolation, Motion sampling, and the existing capability downgrade. A treatment samples semantic cells against explicit time; it owns no timer. Theme, Lavender, Aurora, and bounded custom stops are sufficient initially. Geometry is linear, center-out, or outside-in; motion is static, travel, or breathe. Intensity blends against the surface's ordinary foreground.

Eligible roles are native prompt identity, divider, panel frame, and effect canvas. Status/error/warning, selection/focus, command source, raw PTY, external prompt and welcome captures are excluded. Historical chrome stays static, so animation never invalidates the transcript cache. Native prompt identity initially integrates into unfilled Minimal/Outline module text; filled prompt geometry retains its contrast rules. Panel framing and live separator prove other consumers. Defaults retain ordinary static presentation.

Reduced Motion retains a static palette and suppresses transient effects. Effects Off suppresses decorative motion and transients, retaining ordinary/static presentation. Deterministic callers can supply explicit timestamps; normal deterministic sessions do not schedule decorative frames. Existing NMSH_REDUCED_MOTION and NMSH_DETERMINISTIC precedence remains.

TerminalApp and TaskProgress currently own separate 100ms intervals; unify them through one demand-driven presentation clock with subscriptions. Pure primitives consume timestamps. Dispose subscriptions at completion, frontend stop, suspension, or terminal handoff. No subscription means no timer. Welcome's occasional blink is separate low-frequency scheduling and should use the same clock when active.

Persist declarative presentation controls as an optional additive settings group; absent values preserve old configuration. Validate 2–8 hex stops; no executable expressions or persisted particles. Preserve provider, theme, module, and layout configuration. Advanced controls expose geometry, motion, intensity, and custom config; Simple exposes preset and accessibility controls.

Transient v1: seeded sparkles and rain, user-triggered through /effects, replacing any active effect. Restrict overlays to owned blank gap/separator regions; never cover meaningful content or raw output. Three seconds, at most 64 particles and 10 FPS. Escape, resize, passthrough/fullscreen, suspend, detach, stop cancel. Rebuild the underlying row projection after completion; terminal modes are untouched.

## Implementation plan

- [x] Treatment child: src/chroma/treatment.ts pure cell sampler, validated settings, representative Native Minimal/Outline identity modules, static historical divider and Settings panel frame. Tests cover interpolation, widths, geometry, capability, semantic exclusions, configuration, and all layouts. Canonical verification; push focused PR based on #271.
- [x] Effects child: shared src/motion/PresentationClock.ts for existing activity/task consumers and effects; src/motion/effects.ts bounded seeded state; internal /effects UX. Tests cover ownership and lifecycle; canonical verification; push PR onto treatment branch.
- [ ] Research #179/#180 using current primary documentation. Record product boundaries and framework concepts; only create a further primitive child if genuinely missing beyond the clock already needed by effects.
- [ ] Cumulative hardening: audit timers, restore/resize/passthrough, semantic and persistence boundaries, settings, rendering cost and widths. Fix concrete issues in a separate PR when necessary.
- [ ] Acceptance: additive physical QA, findings, performance and automated evidence; full cumulative verification and Node 22/26 CI. Final docs PR targets immediate predecessor; no merges/tags/releases.

Review focus: malformed config must not reset theme; grapheme width must survive treatment; historical rows must not animate; effects cannot hide focus or shell output; idle clocks must have zero wakeups.
