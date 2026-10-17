# The official NMSh website

Static product site and documentation for **notMyShell**, by **raiseCatError**.
Canonical origin: **https://nmsh.raisecaterror.com**. Source stays in this repository;
the unused `nmsh-site` repository is not involved. Nothing here publishes itself.

## Architecture and structure

Astro generates HTML. Its official unified Markdown processor runs small source-link
and accessible-markup transforms; Shiki highlights code at build time. Pagefind builds
a local, lazy-loaded docs search index. There is no React, hydration framework, server
adapter, app bundle, analytics, external font, account system or capture pipeline.

```text
website/
  src/
    components/       Code blocks, media slots, native search dialog
    brand/            Editable social-preview SVG composition
    content/guides/   Curated user handbook (editable Markdown)
    content/reference/ Generated canonical release documents (do not edit)
    content/releases/ Generated actual public release notes
    data/            Launch baseline, public releases, source hashes, media inventory
    layouts/         Shared product shell and documentation layout
    lib/             Shared release metadata and docs navigation
    pages/           Product, install, Learn, roadmap, docs and release routes
    scripts/         Small browser enhancement: theme, copy and search
    styles/          Shared tokens, responsive layouts and prose styles
  public/            Genuine brand artwork, robots and Cloudflare headers
  scripts/           Explicit upstream refresh and static validation
  tests/             Content/CI tests and browser accessibility/interaction checks
```

`DESIGN.md` records the brief, discovery and visual specification. `PLAN.md` tracks
implementation; `REVIEW.md` records delivery evidence and review limits. Keep ongoing
maintenance instructions here rather than copying them into those records.
`LAUNCH.md` contains the v0.20 coverage inventory and the short release/onboarding
checklist, with exact inspected commits and explicit integration gaps.

## Local setup and preview

The **website** requires Node **22.22.0+** (Astro's requirement), npm and, for browser
tests, installed Google Chrome. The **NMSh application** separately requires Node 22+.
Do not run the repository-root install or application build to work on the site.

On the maintainer's Mac, use the dedicated T7 worktree and storage launcher:

```sh
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/nmsh-website/website
rtk t7run --check
rtk t7run npm ci
rtk t7run npm run build
rtk t7run npm run preview -- --port 4321
```

Open **http://127.0.0.1:4321/**. `npm run dev` offers live editing; search needs a
production build because Pagefind indexes generated HTML. Browser tests own port
4321 by default. To leave an existing preview running, use a free port instead:
`rtk t7run env WEBSITE_TEST_PORT=4323 npm run verify`. Do not delete this worktree after review.

Elsewhere, in a supported development environment, enter `website/`, run `npm ci`,
`npm run build` and `npm run preview`. Local AI-driven dependencies, caches, `.astro`,
`dist` and browser profiles belong on the verified external workspace. This worktree
is already external; `t7run` redirects scratch and shared caches. Never fall back to
the internal SSD if its storage check fails. CI/Cloudflare use their hosted ephemeral
build environment; they do not depend on local paths, credentials or T7 tooling.

## Commands and validation

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local live-editing server |
| `npm test` | Content helpers, Markdown transforms and real workflow classifier |
| `npm run check` | Astro and TypeScript diagnostics |
| `npm run build` | Validate provenance, static build, Pagefind, link/anchor/SEO/budget checks |
| `npm run build:launch` | Reject candidates, verify published-source freshness online, then build |
| `npm run brand` | Export authorized Vespyr icons and static social image; no product media |
| `npm run preview` | Serve the built site, including search |
| `npm run test:browser` | Chrome responsive, theme, clipboard, keyboard, no-JS and axe checks |
| `npm run verify` | All website checks including browser tests |
| `npm run check:upstream` | Network check for candidate/release/tag/tap drift; never writes |
| `npm run sync:upstream` | Refresh the chosen launch source and actual release history; review required |

Builds force a fresh content layer so Markdown-transform changes cannot leave stale
rendered links in Astro's cache. Static checks cover every generated HTML page's
internal links/anchors, one h1, canonical URLs, social metadata, sitemap inclusion,
no autoplay, local image contracts and a 15KB gzip shared-JS budget. Search's own
engine/index is loaded separately, only after a search. The site has no runtime API.

Browser tests use a fresh Chrome profile under the launcher's external TMPDIR, never
the user's signed-in profile. Tests disable screenshots, video and traces. Any
website-only visual-QA images are disposable external scratch—not product media.
No command launches NMSh or creates terminal captures. Automated axe checks are not
a comprehensive human accessibility audit or physical-terminal validation of NMSh.

## Content and source-of-truth strategy

User guides are a curated explanation layer, not a second invented specification.
Each has `title`, `description`, `group`, `order` and `sources` frontmatter. Sources
link directly to the verified launch-source Git commit. Add a `.md` file in
`src/content/guides/`; navigation, previous/next links, sitemap, llms and search update
from the collection. Group names are in `src/lib/docs.ts`. Do not add empty sections.

Longer technical documents are generated from canonical Markdown in this repository
at the independently verified launch commit. The source list lives in
`scripts/upstream-sources.mjs`; `src/data/upstream.json` records original and generated
SHA-256 hashes plus route mappings. Import removes the first h1 because the layout
supplies its own title, normalizes trailing whitespace/EOF, and preserves Markdown
hard line breaks as explicit `<br />` elements. Rendering remaps relative Markdown
links to local imported references when available, otherwise the pinned GitHub source.
Historical release-note links stay at their own tag. Do not edit generated snapshots.

This deliberate versioned mirror makes a shallow Git clone and an **offline build**
work even when `dev` is older than the launch candidate. It does not falsely promote
a candidate to a published release. Historical design records retain their caveats and have an explicit
source-snapshot notice. Curated guides explain current behavior; the presence of a
proposal inside an old design document is not a release promise.

### Preparing and finalizing the v0.20 launch

`src/data/launch.json` is the product/documentation baseline: state, intended version,
public ref, immutable commit and verification date. Candidate metadata has no invented
publication date or release URL. `src/data/release.json` independently records actual
public releases and the tap. Generated references must agree with the launch manifest,
not necessarily with the latest published version. This keeps v0.20 product writing
confident without describing a candidate as a released download.

1. Run `npm run check:upstream`. If GitHub is unavailable or rate-limited, normal
   builds remain offline and buildable. The freshness check and publication build
   fail closed rather than guessing. An optional `GITHUB_TOKEN` increases API limits.
2. After inspecting an approved public integration checkpoint, refresh explicitly:
   `npm run sync:upstream -- --candidate <public-ref> --version 0.20.0`.
   This resolves the exact GitHub commit, fetches canonical documents and genuine
   brand sources, and refreshes only actual published release history and tap data.
   No application branch is checked out, merged or compiled. See `LAUNCH.md` before
   replacing onboarding controls or defaults with claims from an unfinished branch.
3. Review reference diffs, guides, defaults, feature coverage, known limits, platform
   evidence and installation instructions. The sync is a source refresh, not a
   semantic audit. Requirements remain explicit maintained values. The QA source in
   `upstream-sources.mjs` must match the actual release, not a renamed old checklist.
4. Once the official public stable v0.20.0 release exists, run
   `npm run sync:upstream -- --published v0.20.0`. It rejects a missing, draft or
   prerelease target, resolves the immutable tag commit and imports the real notes
   and date. Review the final source integration and checklist before continuing.
5. Verify the tap separately. Until it really provides v0.20, keep its discrepancy
   visible. Candidate source installs use an exact detached SHA; published installs
   switch to the verified tag. `/update` targets stable releases, not candidate review.
6. Finish `LAUNCH.md`, run `npm run verify` and `npm run build:launch`, then seek
   publication approval. The latter rejects candidate state and also performs the
   online freshness check. Candidate HTML is `noindex` and omits released-version
   structured data; verified publication restores normal indexing automatically.

Check-only mode compares public release titles, bodies, dates, URLs and the historical
set as well as the launch ref/commit and tap. Notes are hash-validated during builds.
Historical notes are never rewritten to match the website voice or launch version.

Generated collections must exactly match their provenance manifests. An explicit
sync prunes a removed/renamed generated page only when its old recorded hash still
matches; unknown or independently edited orphan files fail closed for review. All
network reads finish before snapshot writes begin, so an unavailable source does
not leave a half-fetched refresh. Filesystem write failures still require checking
the Git diff and rerunning the refresh; normal builds validate the complete result.

The roadmap is a curated editorial view linked to public issues, not an API dump.
Recheck issue state and product direction during each release review. Issue #398 is
authoritative for Learn Mode; it remains a future proposal with no date or version
commitment. Never add an install command, fake course player or unsafe host-shell demo.

Add product pages in `src/pages/`, reuse `Base`, `Code` and `Media`, and update sitemap
routes/global navigation deliberately. New or renamed docs paths need explicit
`public/_redirects` entries if old public URLs exist; no migration aliases are invented
for this new site. Existing NMSh canonical documents and history remain untouched.

## Media inventory and replacement

**Do not generate the media in this phase.** `src/data/media.json` is the single
inventory and replacement configuration. Each entry specifies purpose, dimensions,
caption and future alt-text requirements. Every slot is currently intentionally empty.

| Semantic ID | Future subject | Dimensions / ratio |
| --- | --- | --- |
| `home-overview` | Composer, genuine output and command feedback | 1440×900 / 8:5 |
| `composer-input` | Multiline input and semantic highlighting | 1440×900 / 8:5 |
| `transcript-history` | Command blocks, folding, search, plain copy | 1440×900 / 8:5 |
| `theme-studio` | Theme Studio and its real preview | 1440×960 / 3:2 |
| `session-resume` | Detach and reattach a live shell | 1440×900 / 8:5 |
| `context-modules` | Native prompt, Rail and Status Strip | 1440×900 / 8:5 |
| `vespyr-appearance` | Vespyr and appearance choices | 1440×900 / 8:5 |
| `learn-concept` | Future approved guide/practice concept | 1440×960 / 3:2 |

When genuine supplied assets are available, put them in `public/media/` and add
`src: "/media/name.webp"`, `kind: "image"`, and a specific `alt` to the corresponding
entry. PNG, WebP and AVIF work through normal image elements. For video use
`kind: "video"`, a local `src`, `poster` and descriptive `alt`; native controls,
`preload="none"` and no autoplay are mandatory. Add a text transcript/captions when
the actual recording needs them; the existing `caption` is not a speech transcript.
No video library, automatic playback or animation bypass is introduced. Match the
reserved ratio (the home slot is height-capped on desktop) to avoid layout movement.

Update the caption honestly when replacing pending media. Do not call a conceptual
Learn image a working interface. Requirements in `altRequirement` are instructions
for a future author, never fabricated alt text for an unavailable asset. Build
validation rejects missing local assets, missing alt text, bad dimensions and
unapproved external media URLs. Genuine existing logo/lockup assets are copied
unchanged from the pinned source, not newly generated terminal imagery.

### Authorized brand assets

`npm run brand` extracts the exact rect-based Vespyr sprite from the approved
`public/brand/nmsh-lockup.svg`, originally sourced from `assets/brand/nmsh-lockup.svg`
and the production `catSprite.ts` artwork. It does not invent a new cat or use the
embedded wordmark bitmap. Header `vespyr.svg` keeps its natural wide proportions;
`favicon.svg` centers it on a transparent square. The transparent 16px/32px PNGs
provide tab fallbacks; the 180px PNG is the Apple touch icon. No filled bounding box.

The editable composition is `src/brand/social-preview.svg`. Sharp, an explicit
development-only dependency already used by Astro, substitutes genuine Vespyr and
exports `public/brand/social-preview.png` at 1200×630. Text uses the local Arial or
Helvetica installation; the checked-in production PNG is the reviewed output, so
ordinary builds neither rasterize artwork nor depend on the maintainer's fonts.
After a deliberate edit, regenerate on the approved workstation, visually inspect
the full image and a small thumbnail, then run the asset tests and website build.
This branding-only command is not a terminal capture or demonstration system.

## Theme, accessibility and metadata

Shared CSS tokens define charcoal/lavender dark mode and warm-paper/deep-violet light
mode. Dark is the first-visit default. A small prepaint script reads `nmsh-theme`;
the manual toggle persists it when storage is available and remains functional when
storage writes are blocked. No JS means readable default-dark HTML. Reduced-motion
CSS disables transitions; videos never start themselves.

The homepage is static. Only documentation article navigation opts into native
cross-document view transitions in `Docs.astro`: a 100ms exit fade and a 180ms entry
fade with a four-pixel upward movement. Unique article names prevent geometry
morphing between differently sized pages. Header, sidebar and root are not animated.
Direct loads and same-article anchors do not replay the transition. Reduced motion
and unsupported browsers use immediate native navigation; no router or animation
dependency is added. Dialog entry/exit uses native discrete CSS transitions with a
plain native fallback. Only search has softer corners. Docs never reveal on scroll.
All sidebar categories and nested groups start expanded, including without JavaScript.
Their choices and desktop scroll offset persist per tab in session storage; active
ancestors always open. The v2 preference key resets the old implicit collapsed defaults
once. Before article parsing, restore the desktop offset and adjust it only if the
active link is outside the visible sidebar. Opening the mobile menu also reveals
its active link without scrolling the article.
`src/lib/docs.ts` groups existing references into nested categories and rejects an
uncategorized new reference. A passive TOC indicator tracks the current section;
article scrolling, browser Back/Forward and heading hashes remain native. Blocked
storage stays usable. CSS supplies thin, square theme-colored scrollbars through
standard properties and compatible eight-pixel WebKit styling, with native forced colors.

`src/lib/site.ts` is the origin/identity configuration. `Base` provides canonical,
Open Graph, Twitter and accurate software metadata. All pages use the real 1200×630
brand composition, absolute production image URLs, dimensions, image alt text and
`summary_large_image` cards. Sitemap and llms endpoints derive docs
links from the same collections. `robots.txt` points only to the official domain.
Preview URLs never become canonicals. `public/_headers` supplies basic security and
cache headers; hashed Astro assets are immutable, Pagefind revalidates to prevent
mixing deployment indexes. No tracking scripts or cookie banner are needed.

## Cloudflare Pages: manual publishing only

The Git-connected Pages project **nmsh** is prepared in account
`c1644ccedec713ad6e4f2d34cd76aa06`. Its assigned hostname is
`nmsh-5mc.pages.dev`. It has **zero deployments** at setup. The intended custom domain
`nmsh.raisecaterror.com` is not attached and no DNS record has been created.

| Setting | Value |
| --- | --- |
| Root directory | `website` |
| Framework preset | Astro (static, no adapter/Workers runtime) |
| Build command | `npm ci && npm run build:launch` |
| Build output directory | `dist` (relative to `website`) |
| Environment | `NODE_VERSION=22.22.0`, `SKIP_DEPENDENCY_INSTALL=1` |
| Production branch | `master`, for deployment classification only |
| Git automatic deployments | `deployments_enabled=false` |
| Production automatic deployments | `production_deployments_enabled=false` |
| Preview branch builds | `preview_deployment_setting=none` |
| PR deployment comments | Disabled |

These controls apply to **every branch**, including `master`. Git remains connected
for source ownership, not deployment triggers. Do not use Save and Deploy, build
hooks, retries or automatic preview builds. `.github/workflows/website.yml` only
checks the static site; it cannot publish it. The old `deploy.yml` GitHub Pages
workflow was disabled through GitHub and must remain disabled. Its existing public
site was not deleted or changed.

### Credentials and approval

GitHub environment **nmsh-production** permits only the `master` branch, requires
approval by **raiseCatError**, and disables administrator bypass. Self-review is
allowed for this independent, single-maintainer project; clicking approval is still
required. No deployment has been dispatched.

`CLOUDFLARE_ACCOUNT_ID` is already an environment variable. The maintainer has added
`CLOUDFLARE_API_TOKEN` as an environment secret; its presence was verified without
reading its value or testing a deployment. The token must have only
**Account / Cloudflare Pages / Edit**, restricted to this account. Never paste it
into chat, commit it, or reuse broad MCP/OAuth
credentials. Pages token access is account-scoped, so do not describe it as isolated
to this one project. Grant no DNS, Workers, R2 or unrelated permissions. Set an expiry
and rotate it when needed. No additional GitHub PAT is required.

The deploy job receives the token only in its final step, after approval and release
revalidation. Other jobs get a read-only GitHub token. Actions are pinned to immutable
commits; Wrangler is version-pinned in this website's independent lockfile.

### Publish when ready

1. Complete `LAUNCH.md`, verify the real v0.20.0 release/tag, synchronize the published
   source, then run `npm run verify` and `npm run build:launch`. The current candidate
   deliberately fails publication. Do not bypass this gate.
2. Obtain approval to integrate the website and deployment workflow through the normal
   `dev` to `master` process. Nothing in this task merges branches. GitHub only exposes
   a new manual workflow after it exists on the default branch.
3. In Actions, select **Publish NMSh website**, choose **Run workflow** on `master`,
   and enter `nmsh.raisecaterror.com`. Equivalent command, **only when authorized**:
   `gh workflow run website-deploy.yml --repo raiseCatError/notMyShell --ref master -f confirmation=nmsh.raisecaterror.com`.
4. The unprivileged build validates release provenance and uploads an immutable static
   artifact. Review its exact commit and approve the pending **nmsh-production** job.
   It rechecks the public release and manual-only Cloudflare settings, then uploads
   that artifact with `wrangler pages deploy`, not a rebuild or arbitrary branch.
5. Check the assigned Pages hostname. Domain attachment/DNS needs separate approval,
   as described below. A workflow dispatch is real publication, not a preview test.

Ordinary source pushes and pull requests never publish. CI-classification tests keep
website and deployment-only changes out of the expensive application jobs. Canonical
source changes reach this site only through a reviewed source synchronization.

### Custom domain

After an approved production upload and separate domain approval, associate
**nmsh.raisecaterror.com** in the Pages project's Custom domains section, then follow
Cloudflare's DNS instructions for the existing `raisecaterror.com` zone. Do not add
the domain or a CNAME now. Confirm TLS, HTTP-to-HTTPS behavior, canonical origin,
custom 404, headers and Pagefind on the final host. `/docs/` belongs to this same
project, not a docs subdomain.

### Cross-site link activation, after the domain works

The NMSh footer links to the already-live creator homepage. Outgoing launch links
remain staged to avoid sending visitors to an unavailable NMSh site:

- Apply `git apply website/launch-links.patch` on the reviewed integration branch
  only after both `https://nmsh.raisecaterror.com/` and `/docs/` return the actual
  expected pages over valid HTTPS. The patch adds separate Website and Documentation
  README links without mixing them into the pre-publication workflow merge.
  It targets this branch's README, not the older current `master` layout. Recheck
  the patch against the final integrated README and retain existing source links.
- Set About → Website to `https://nmsh.raisecaterror.com/` using repository settings
  or `gh repo edit raiseCatError/notMyShell --homepage https://nmsh.raisecaterror.com/`.
- The private `raisecaterror-website` repository has a local T7 branch
  `feature/nmsh-launch-links`. It stages **View website**, **Read documentation**,
  **View repository**, in that order, with a muted repository action. Do not push it
  before the NMSh domain works: its current Git integration automatically deploys
  preview branches. Its live branch and deployment settings remain unchanged.

GitHub's public Website field and default README remain unchanged during preparation.
After activation, verify both URLs, redirects and their distinct canonicals before
publishing the homepage link commit. No publishing command in this section has run.

References: [disabled Git builds](https://developers.cloudflare.com/pages/configuration/git-integration/#disable-automatic-deployments),
[Wrangler uploads and token permissions](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/),
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Troubleshooting the site

- **T7 check refused:** stop local disposable work; verify the mounted pinned volume.
  Sandbox-restricted disk inspection can require an approved outside-sandbox check.
- **Astro requires a newer Node:** use 22.22.0+ for the website; do not confuse this
  with the application's documented 22+ requirement.
- **Search unavailable in dev:** build and preview; the complete docs map works
  without JavaScript or an index. A blocked/failed index shows an honest fallback.
- **Generated-source hash mismatch:** revert only your accidental snapshot edit or
  run an authorized upstream sync; never bypass provenance validation.
- **Broken local link/anchor:** fix the source link or transform; rerun build. References
  outside the selected set should point to their pinned GitHub source, not a local 404.
- **Browser tests cannot launch Chrome:** install Chrome or deliberately configure
  another Playwright browser on external storage. No hidden browser download is required.
- **Copy/storage permission denied:** the site gives manual-copy feedback and keeps
  theme switching usable without falsely claiming persistence.
- **Cloudflare root install builds the CLI:** set Root directory to `website` and
  verify the explicit build command and dependency-install environment above.
