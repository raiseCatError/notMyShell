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
    content/guides/   Curated user handbook (editable Markdown)
    content/reference/ Generated canonical release documents (do not edit)
    content/releases/ Generated actual public release notes
    data/            Release snapshot, source hashes/routes, media inventory
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
production build because Pagefind indexes generated HTML. Stop a dev server before
running browser tests, which own port 4321. Do not delete this worktree after review.

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
| `npm run preview` | Serve the built site, including search |
| `npm run test:browser` | Chrome responsive, theme, clipboard, keyboard, no-JS and axe checks |
| `npm run verify` | All website checks including browser tests |
| `npm run check:upstream` | Network check for release/tag/tap drift; never writes |
| `npm run sync:upstream` | Explicitly update canonical sources and public releases; review required |

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
link directly to a verified stable Git commit. Add a `.md` file in
`src/content/guides/`; navigation, previous/next links, sitemap, llms and search update
from the collection. Group names are in `src/lib/docs.ts`. Do not add empty sections.

Longer technical documents are generated from canonical Markdown in this repository
at the verified stable tag's resolved commit. The source list lives in
`scripts/upstream-sources.mjs`; `src/data/upstream.json` records original and generated
SHA-256 hashes plus route mappings. Import removes the first h1 because the layout
supplies its own title, normalizes trailing whitespace/EOF, and preserves Markdown
hard line breaks as explicit `<br />` elements. Rendering remaps relative Markdown
links to local imported references when available, otherwise the pinned GitHub source.
Historical release-note links stay at their own tag. Do not edit generated snapshots.

This deliberate versioned mirror makes a shallow Git clone and an **offline build**
work even when `dev` is older than the public release. It avoids promoting development
docs to stable. Historical design records retain their caveats and have an explicit
source-snapshot notice. Curated guides explain current behavior; the presence of a
proposal inside an old design document is not a release promise.

### Updating for a release

1. Run `check:upstream`. If GitHub is unavailable or rate-limited, normal builds keep
   using the existing reviewed snapshot; they do not silently guess a new version.
2. When authorized to update site content, run `sync:upstream`. It accepts only public,
   non-draft, non-prerelease `vX.Y.Z` releases, resolves the tag's commit, fetches the
   selected canonical docs and actual release notes, and independently reads the tap.
   An optional `GITHUB_TOKEN` increases API limits; never commit credentials.
3. Review `src/data/release.json`, reference/release diffs, installation requirements,
   platform evidence, curated guides, feature copy, roadmap and known limitations.
   `requirements` in the snapshot are explicit maintained values: verify them against
   the new release; the sync script is not a semantic product audit.
4. Keep pending/unreleased features labeled. Inspect the tap discrepancy rather than
   assuming Homebrew offers the latest tag. Update the release-specific QA source in
   `upstream-sources.mjs` when appropriate; do not relabel an old checklist as a new one.
5. Run website verification, review, commit and push. Publishing still needs approval.

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
unchanged from the verified release, not newly generated terminal imagery.

## Theme, accessibility and metadata

Shared CSS tokens define charcoal/lavender dark mode and warm-paper/deep-violet light
mode. Dark is the first-visit default. A small prepaint script reads `nmsh-theme`;
the manual toggle persists it when storage is available and remains functional when
storage writes are blocked. No JS means readable default-dark HTML. Reduced-motion
CSS disables transitions; videos never start themselves.

`src/lib/site.ts` is the origin/identity configuration. `Base` provides canonical,
Open Graph, Twitter and accurate software metadata. The social image is the genuine
existing wordmark, not a fake product capture. Sitemap and llms endpoints derive docs
links from the same collections. `robots.txt` points only to the official domain.
Preview URLs never become canonicals. `public/_headers` supplies basic security and
cache headers; hashed Astro assets are immutable, Pagefind revalidates to prevent
mixing deployment indexes. No tracking scripts or cookie banner are needed.

## Cloudflare Pages (manual setup only)

No Cloudflare project, DNS, production deployment or GitHub Pages configuration has
been created or changed by this work. After review and explicit approval, connect
the **existing `raiseCatError/notMyShell` repository** through Pages' Git integration.

| Setting | Value |
| --- | --- |
| Root directory | `website` |
| Framework preset | Astro (static, no adapter/Workers runtime) |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` (relative to `website`) |
| Environment | `NODE_VERSION=22.22.0`, `SKIP_DEPENDENCY_INSTALL=1` |
| Build image | Current supported Pages build image (v3 at verification) |
| Build watch include paths | `website/*` (Cloudflare's `*` spans nested directories) |
| Build watch exclude paths | Empty |
| Production branch | Select **only after approval** and integration of this feature |
| Preview branches | Allow this feature branch explicitly for review only when authorized |

The repository default `master` does not yet contain this site. Do not select it and
claim deployment is ready without integrating the website. Use `dev` for normal PR
integration, then make a separate, authorized production-branch decision. Connecting
a Pages Git project can trigger deployment; do not do that as a harmless setup step.

No Wrangler configuration or GitHub Actions deploy workflow is needed. The inexpensive
`Website` workflow runs only site checks. The application's existing aggregate CI
check still exists, but website-only changes skip its expensive CLI/platform jobs;
mixed application changes retain those gates. Manual dispatch remains comprehensive.
Canonical source changes affect the website only through a reviewed source-sync commit,
so unrelated application changes do not rebuild this pinned site.

The stable branch was observed to contain a separate legacy `site/` GitHub Pages
workflow; `dev` does not. It was deliberately not altered or deployed. Reconcile that
legacy surface explicitly during integration rather than assuming it serves this site.

### Custom domain

After approving the Pages preview, add **nmsh.raisecaterror.com** in the project's
Custom domains section. Follow Cloudflare's validation/DNS instructions for the
actual account/zone. If DNS is external, the subdomain generally needs the CNAME
Cloudflare specifies for the Pages project; associate the custom domain in Pages
first. Do not invent a project hostname, overwrite an existing record or change
production DNS without review. Confirm ownership, TLS, HTTP-to-HTTPS behavior,
canonical origin, custom 404, headers and Pagefind loading on the final host.
Preview indexing/access policy is a separate Pages dashboard decision; use Access
or preview response headers as appropriate rather than changing production canonicals.

Official references checked for this handoff:
[monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/),
[watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/),
[build image/environment](https://developers.cloudflare.com/pages/configuration/build-image/),
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
