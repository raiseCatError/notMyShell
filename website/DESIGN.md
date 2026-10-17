# NMSh website specification

## Brief and constraints

Build the official product and documentation site for notMyShell by raiseCatError at
`https://nmsh.raisecaterror.com`. The site explains a frontend over a persistent real
shell, not a shell, terminal emulator, multiplexer or AI-first terminal. It must be
reviewable and deployable independently of the CLI. No capture, recording, demo,
terminal simulation or media-generation work is permitted. All media is pending.

The user authorizes autonomous design and inline implementation, without intermediate
approval gates. No publishing, merging, release creation or production configuration.
Keep the dedicated external worktree intact. Only website files and narrowly scoped
CI filtering may change. The later branding addendum explicitly authorizes Vespyr
favicons and one static social-preview composition, not product captures.

## Discovery (2026-10-17)

- Latest public stable release: v0.18.0, published 2026-10-13. Physical-terminal QA
  for this release remains pending; Linux and WSL 2 have additional validation gaps.
- The public Homebrew formula still references v0.17.0. Surface that discrepancy;
  do not imply the tap necessarily installs the latest release.
- `origin/dev` is 4a02520d (older than stable `origin/master`, 9ec06768). Branch
  from dev as instructed, without bringing application/release changes into this PR.
- Existing status-strip, onboarding, release and older website worktrees are not
  reused or modified. `nmsh-site` is not used or deleted.
- Sources reviewed: stable README, architecture, roadmap, changelog, contributor,
  support, security, license, llms, platforms, ShellAdapter, prompt customization,
  context modules, accessibility, session design, privacy, demos and physical QA.
- Issue #398 is a future proposal, not a release commitment. Bash/zsh only initially;
  verified OS-enforced isolation or explicitly labeled simulation, never a temp-folder
  "sandbox". Architecture/security/curriculum approval remains a gate.

## Architecture and alternatives

Use Astro static output, typed Markdown collections, Astro's built-in Shiki and
Pagefind's local static index. No React, MDX, UI framework, analytics, CDN fonts,
server adapter or client-side router. Compared with Starlight, custom layouts keep
the product and docs visually continuous without overriding a framework's UI.
Compared with hand-built HTML, Astro supplies safe content rendering and route
generation with less custom machinery. Dependencies stay in website/package.json.

Curated beginner guides link to canonical release documents. Longer technical
references are generated, verbatim, from a pinned stable Git commit through an
explicit upstream-sync command. A provenance manifest records paths and hashes.
Normal builds never fetch GitHub or require git history or CLI compilation. Release
notes are cached from real public releases. Upstream changes are reviewed, never
silently promoted by a build. A check-only sync reports drift without changing files.

## Information architecture

Product `/`, Features `/features/`, Install `/install/`, Docs `/docs/`, future Learn
`/learn/`, Roadmap `/roadmap/`, Releases `/releases/`, Architecture `/architecture/`.
Docs progress from first run, concepts and everyday use through composer, completion,
transcript, sessions, prompts, themes, integrations, context, shells, configuration,
accessibility, troubleshooting, advanced usage, development and reference.
Reference documents remain visibly versioned and retain their historical context.

## Visual system

Charcoal canvas, graphite surfaces, warm off-white text, quiet lavender emphasis.
Light mode is warm paper, dark ink and deeper violet. Dark is the first-visit default;
manual choice persists when storage is available. System UI typography avoids font
requests; monospace is reserved for commands, metadata and concise labels. Headings
use tight tracking, measured line-height and weight rather than oversized effects.
Maximum marketing width 1160px; prose 70ch; 8px-derived spacing, 1px rules, small
4–12px radii only where useful. No gradient blobs, glass, fake terminal chrome or
decorative animation. Original brand artwork is reused unmodified.

Marketing sections use editorial splits, numbered explanations and comparison rows,
not endless cards. A fine ruled media field with an abstract registration mark,
purpose label and honest pending notice reserves its real aspect ratio. No fake
commands, output, playback buttons or product UI. Learn is a conceptual introduction,
not a functional lesson player. The homepage stays static. Motion is limited to quick
article-only fades between documentation pages, short native dialog entry/exit and
hover feedback. No scroll-triggered reveals or JavaScript-gated content. Reduced
motion disables it. Focus rings and text labels carry state
independently of color.

## Responsive and accessible behavior

Desktop: persistent global header, docs sidebar, prose and optional sticky TOC.
Tablet: sidebar plus prose; TOC collapses to disclosure. Mobile: native navigation
disclosures and a one-column reading layout; no unusably narrow content columns.
Native buttons, links, details and dialog; escape closes search; focus returns to
its trigger. Skip link, anchor links, breadcrumbs, previous/next docs, live feedback
for copy/search, scrollable labeled code/tables. Search is progressive enhancement;
the complete docs index remains usable without JavaScript. Copy failure explains
manual selection. There are no essential hover-only interactions.

## Content and media contracts

Stable version, publication date, tag commit, source-install command and Homebrew
version come from one snapshot. Released, in-development and planned are explicit.
No popularity claims, deadlines, installers, testimonials, pricing or invented team.
Media manifest fields: semantic ID, purpose, aspect ratio, dimensions, caption,
future alt-text requirement, optional image/video source and poster. Replacement
requires genuine supplied media, specific alt text and retained captions. Video uses
native controls, never autoplay. Pending slots are shippable, not broken images.

## Verification contract

Node tests for release validation, source-link resolution and media validation.
Astro check and static build; post-build crawl for links, anchors, metadata, media,
search index and bundle budgets. Browser checks at desktop/tablet/mobile: navigation,
search, theme persistence, copy feedback, keyboard, no overflow, reduced motion,
contrast and automated accessibility. These checks never launch NMSh or create
terminal media. Manual human visual/product review and Cloudflare setup remain.

## Refinement and launch correction (2026-10-17)

The intended baseline is now the cumulative v0.20 product, not the last published
v0.18 release. `LAUNCH.md` records exact source ancestry, integrated feature coverage,
onboarding gaps and publication gates. Candidate provenance and actual public release
history are separate; generated references follow the candidate checkpoint. Publication
requires a real immutable released tag, final content review and explicit approval.

Primary hook: **A richer way to use the terminal.** Supporting copy describes command
editing, output, queueing and live sessions before clarifying the real-shell model.
Authored copy uses natural punctuation and concrete descriptions, without em dashes.
Canonical snapshots, code and actual historical release notes retain their text.

Preserve the existing editorial splits, reading measure, neutral palette and honest
media fields. Refine hierarchy rather than adding cards or decorative effects. The
hero aligns headline and supporting copy at their top edges, including tablet sizes.
Primary actions have one clear visual priority; GitHub remains a quiet secondary link.

Header: the exact existing pixel Vespyr silhouette plus plain notMyShell text. No
miniature duplicate wordmark. Personality is limited to this brand signature and a
short footer aside. Search uses a compact icon/label/key hint and a softly rounded,
top-anchored native dialog. This is the exception to the site's sharper geometry;
results grow downward without moving the input after entry.

Docs keep ordinary full-page links, native Back/Forward and anchor behavior. Only
the independently scrolling sidebar position and native category disclosures persist
in session storage, restored before article parsing. All categories and nested groups
start expanded. The active article's ancestors always open; unavailable storage
falls back to the expanded server-rendered navigation. Native cross-document view
transitions animate only the article, without a client router or whole-page fade.
Different article names avoid size/position morphing. Unsupported browsers and
reduced motion switch immediately; same-article anchors never replay an entrance.
Clicking the current item does not reload the article. A passive section indicator
follows reading position without scrolling or rewriting history. Eight-pixel square
scrollbars use theme-specific graphite and lavender colors with a native forced-color
fallback. Scrolling itself remains native.

The editable 1200×630 social composition uses charcoal, neutral typography, the
lavender hook and genuine Vespyr. It is branding, never a simulated terminal. SVG
geometry is extracted from the approved lockup; deterministic Sharp exports are
checked in and are not rebuilt by ordinary site builds.
