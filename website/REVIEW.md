# Website delivery review

## Refinement pass (2026-10-18)

This record supersedes the initial delivery's version strategy and measurements below.
The site now targets cumulative v0.20 candidate `15d776ee`; actual published release
history remains separate. `LAUNCH.md` records feature evidence, exact branch ancestry,
the integrated Reactive Horizon evidence, newer follow-up boundary and publication checklist.
No v0.20 release date, published tag or Homebrew availability is fabricated.

Changes: stronger “A richer way to use the terminal” hook, concrete supporting copy,
Vespyr-only header signature, native tab icons and one authorized 1200×630 social
composition. Website-owned prose has an automated em-dash/stock-language guard;
canonical snapshots and real historical release notes retain their original wording.
The handbook adds practical Setup and execution guides, expands copy/report/compare,
agent/workspace/module coverage, and refreshes canonical references from the candidate.

The docs bug was reproduced: a sidebar at 631px reset to zero after native navigation,
leaving its active item out of view. Per-tab sidebar-only restoration fixes it without
overriding article scrolling, history or heading anchors. Current-item clicks no longer
reload the article. Thin scrollbar styling was removed; native scrolling stays intact.

Search now has an aligned icon/label/key hint, a sharp top-anchored dialog, full-row
result links and coordinate-based outside dismissal. Long results grow downward rather
than repositioning the input. A reviewer-identified viewport-height issue was reproduced
by a failing browser test (728px bottom in a 720px viewport), then corrected by deriving
height from the actual top offset and bottom clearance. Keyboard and focus behavior
remain native. Pagefind's relaxed matching found the short `^Z` token for the old
nonsense fixture after the canonical changelog was indexed; a quoted exact nonexistent
term now tests the real no-results path without changing the search engine.

Motion is limited to a short six-pixel hero entry, short native dialog transitions and
hover feedback. No scroll reveals, hidden waiting content or documentation animation.
Footer personality is confined to one human sentence and “Also, meows.” Existing
editorial layouts, theme palette, static architecture and all eight media placeholders
are deliberately preserved. No NMSh application or capture tooling was launched.

Current verification includes Node/content/brand/launch tests, Astro diagnostics,
production build, internal links/anchors, metadata/assets, Pagefind and Chrome tests.
The complete `npm run verify` gate passed on 2026-10-18 after the review fixes, with
no Astro errors, warnings or hints. The build validates every HTML page and internal
link/anchor; shared JavaScript is 2,171 bytes gzip, with Pagefind separate.
An additional Git-object audit verifies curated/canonical source paths at
the pinned candidate. `npm run check:upstream` passes; `npm run build:launch` exits
nonzero with the intended unpublished-candidate refusal, not a site build failure.
Rendered website-only QA was inspected at desktop, tablet and mobile sizes, in both
themes, including the hero, long docs, search and footer. Full-size social artwork and
its 400×210 thumbnail were visually inspected. Transparent icon dimensions/alpha and
real local production URLs are checked; human review of actual OS tab presentation,
Safari/Firefox and assistive technology remains appropriate.

Independent read-only review identified the modal-height issue, a hardcoded candidate
label in tests and stale delivery notes. All are addressed; browser expectations now
derive candidate/published behavior from launch data. No other Critical/Important
finding was reported. Website-only verification does not establish physical NMSh QA.

The production launch command intentionally refuses candidate metadata. Freshness
checking agrees on the pinned public candidate, published v0.18.0 and Homebrew v0.17.0.
Publication still requires the actual final tag, integrated onboarding/default review,
release acceptance, tap verification, human visual review and separate deployment
approval. The feature worktree is retained; no merge, release or deployment occurs.

The initial refinement checkpoint `b580d42c` passed local verification and GitHub
Website CI. A final read-only source check then found newly public onboarding
implementation at `15d776ee`, beyond the earlier evidence audit. The website was
repinned as one unified candidate, the real starting-point controls and transition
were documented, and fresh versus legacy queue-summary defaults were corrected.
The remaining newer local-only follow-ups are explicitly listed in `LAUNCH.md`.

## Initial delivery (2026-10-17, historical)

The measurements and stable-source decisions below describe the earlier implementation,
not the revised v0.20 baseline. They are retained as historical verification evidence.

## Scope and isolation

- Dedicated worktree: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/nmsh-website`.
- Branch: `feature/nmsh-website`; base: `origin/dev` at `4a02520d`.
- Content/design foundation: `d97e878f`; working product/docs implementation: `365cbf89`.
- Remaining integration/review-fix commits follow those checkpoints; use `git log`
  on this branch for exact final IDs rather than a self-referencing document hash.
- Only `website/` and focused `.github/workflows/` integration changed. Root package,
  lockfile, runtime, PTY, prompt, onboarding, existing assets and canonical docs are
  unchanged. The main checkout's two pre-existing package edits remain untouched.
- Existing worktrees and the unused `nmsh-site` repository are untouched. This
  website worktree remains available for review; no merge or deployment authorized.

## Shipped for review

Home, Features, Install, documentation index, Roadmap, Releases,
historical release-note pages, Architecture and custom 404. The handbook includes
18 curated guides and 15 version-pinned technical references, with desktop sidebar,
compact navigation/contents, anchor links, previous/next and local full-text search.
All eight configured product/concept media slots are deliberately pending.

Astro static HTML; system fonts; a shared dark/light token system; no hydration
framework, third-party font, tracking, runtime API or app compilation. Shared site
JavaScript measured 2058 bytes gzip; Pagefind loads separately when used. The static
build currently produces 52 HTML pages. No Core Web Vitals field measurements or
numerical Lighthouse score is claimed.

## Verification evidence

Run from `website/` on verified T7 through `rtk t7run`:

| Gate | Result |
| --- | --- |
| `npm test` | PASS — content, release drift, source ownership/membership, Markdown pipeline and real CI classification |
| `npm run check` | PASS — no Astro/TypeScript errors, warnings or hints |
| `npm run build` | PASS — provenance, all internal links/anchors, metadata, sitemap, search and bundle budget |
| `npm run test:browser` | PASS — Chrome interaction, responsive layout, keyboard, reduced motion and automated accessibility |
| `npm run verify` | PASS — combined website gate after independent-review fixes |
| `npm run check:upstream` | PASS — release/tag/tap and public release notes/history agree |
| Workflow YAML parsing | PASS — both touched workflows parse |
| Source-object link audit | PASS — rendered pinned GitHub source paths exist in immutable local Git objects |
| Browser runtime/navigation smoke | PASS — product routes return success, no runtime page errors or horizontal overflow |
| `git diff --check` | PASS at verification checkpoints |

Chrome covers 1440px desktop, 834px tablet and 390px mobile; dark and light themes;
blocked storage writes; clipboard success/denial; search results, no-results and
failed-index fallback; Escape focus return; no-JS docs; compact contents/permalinks;
404 and pending-media behavior. Automated axe checks exercise representative product,
installation and technical-doc pages in both themes.

Rendered **webpage-only** viewport QA was visually inspected at desktop/tablet/mobile
sizes, using disposable external scratch. These images contain the website and its
honest placeholders; they are not terminal product captures or deliverable media.
No NMSh app, VHS, demo script, terminal recording, GIF/video production or capture
pipeline was used. No physical terminal or human assistive-technology acceptance
is claimed. The application test suite was not run: its runtime is unchanged and
the task explicitly requires an independently verified website pipeline.

## Independent review and rulings

One read-only specialist reviewed the implementation and CI integration. No Critical
finding. Its Important release-refresh finding is fixed: check mode now detects
published body/title/date/URL and historical-set drift without writing, and build
validation verifies generated release-note hashes. Regression tests failed before
the change and pass afterward; the complete website gate is green.

The reviewer called orphan references Minor. I treated the effect as Important:
a removed source could otherwise remain published under a newer release label.
Exact collection membership is now validated, and explicit refresh prunes only
previously generated files whose ownership hash still matches. Unknown/edited files
fail closed. Regression coverage checks extra/missing files and ownership mismatch.
There are no intentionally deferred review findings.

Other explicit decisions:
- Keep the required `dev` base despite its older application snapshot. Pin website
  references to verified stable instead of merging unrelated release/onboarding work.
  Tradeoff: refreshing source snapshots is an explicit reviewed maintenance step.
- Keep current Homebrew truth visible: latest stable is v0.18.0 but the verified tap
  still references v0.17.0. Do not fix the tap as unrelated work.
- Use the official Astro unified processor for stable Markdown transforms and
  foreground `--ignore-lock` servers to avoid agent-inferred orphan preview daemons.
- No live release lookup on page requests or builds. External outages do not make
  an existing reviewed site unbuildable; freshness requires the check-only command.

The reviewer set aside physical-terminal behavior, fresh upstream status, deployed
Cloudflare behavior, Safari/Firefox and human visual/accessibility acceptance. The
primary verified upstream separately. The other exclusions remain honest limits:
no changed app behavior to accept, no production deployment, Chrome-only browser
execution, and human review still required. None is silently represented as passing.

## Remaining human steps

1. Review the website visually in the retained worktree; approve wording, hierarchy,
   brand treatment and the deliberate media presentation. Test with the actual
   browsers and assistive technology you intend to support; Safari/Firefox and a
   human screen-reader audit were not exercised here.
2. Approve integration and an eventual production branch separately. Do not merge
   to `master` or create a release merely to host this site. Reconcile the stable
   branch's separate legacy `site/` Pages workflow during integration.
3. Only after deployment approval, connect Cloudflare Pages to this repository with
   root `website`, explicit clean install/build and output `dist`; configure build
   watch paths, preview access/indexing policy, custom domain and DNS/TLS. Exact
   settings and authoritative references are in README.md.
4. Supply genuine future assets for the eight media IDs documented in README.md and
   `src/data/media.json`. No media creation is needed to review or ship this site.
