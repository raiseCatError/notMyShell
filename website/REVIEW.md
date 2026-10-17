# Website delivery review — 2026-10-17

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

Home, Features, Install, documentation index, planned Learn, Roadmap, Releases,
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
installation, learning and technical-doc pages in both themes.

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
