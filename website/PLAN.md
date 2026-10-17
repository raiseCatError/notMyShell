# NMSh website implementation plan

**Goal:** Deliver a complete static product/docs site with honest media placeholders.
**Architecture:** Astro Markdown collections, custom shared layouts, Pagefind search,
checked-in public-release/source snapshots, no CLI runtime dependency.
**Spec:** DESIGN.md. Execute inline; user explicitly requests autonomous completion.

## Global constraints
- Source under website/, independent install/build/test. Node >=22.22.0 for Astro.
- No captures, recordings, demo tooling, app launches or production deployments.
- Worktree on verified T7, feature/nmsh-website from origin/dev; leave it intact.
- v0.18.0 is stable; Homebrew snapshot is v0.17.0; Learn is planned only.

## Review focus
- Offline external data: builds use reviewed snapshots, never live network requests.
- Narrow screens and long reference tables: preserve readable text without overflow.
- Missing media or failed clipboard/storage: no broken UI or false success.
- Release/source drift: check-only refresh fails without silently updating the site.
- Canonical Markdown relative links: resolve against the pinned source, not website paths.

## Task 1 — source and content foundation
- [x] Write failing Node tests for stable-release selection, source links and media.
- [x] Run them and confirm failure, then implement small data helpers.
- [x] Add isolated package/config, upstream sync and reviewed provenance snapshots.
- [x] Author concise guides and generate canonical technical references.
- [x] Verify tests and commit source/content foundation (`d97e878f`).

Interfaces: release.json supplies latest/history/tap/sourceCommit; upstream.json
maps canonical paths to site reference slugs and sha256; media.ts supplies typed slots.

## Task 2 — product and documentation experience
- [x] Write browser assertions for navigation, themes, search, copy and missing media.
- [x] Implement shared layout, visual tokens, product pages and Markdown docs routes.
- [x] Add native mobile navigation, TOC, anchors, metadata, sitemap, robots and 404.
- [x] Build Pagefind index and progressively enhanced search; no hydration framework.
- [x] Verify typecheck/build/link crawl and browser behavior, then commit (`365cbf89`).

Interfaces: Base supplies header/footer/theme/copy/search; Docs supplies sidebar,
TOC and previous/next; Media reads semantic slot IDs. CSS tokens serve both themes.

## Task 3 — integration and delivery
- [x] Add inexpensive website-only CI and narrowly exclude website from CLI jobs.
- [x] Document maintenance, refresh, media inventory and Cloudflare Git settings.
- [x] Run full website verification and independent final review; fix regressions.
- Delivery gate: commit and push only feature/nmsh-website after verification. No merge or deployment; confirm the remote checkpoint in the final handoff.
- [x] Record evidence and human review items in REVIEW.md.
