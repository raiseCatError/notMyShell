# NMSh Website Development Record

## 1. Stack and Rationale
- **Framework**: Astro with the Starlight template.
- **Why**: Starlight provides out-of-the-box support for Markdown/MDX, excellent typography, a configurable sidebar, powerful search (Pagefind), accessibility features, dark/light mode switching, and an easy path to a customized homepage. It outputs static HTML perfectly suited for GitHub Pages.
- **Styling**: Tailwind CSS (v4) for utility classes, with customized Starlight CSS variables for the NMSh identity (Lavender accent: `#ac96e6`).

## 2. Content Architecture
The site is organized into logical learning paths to support both beginners and experienced users without overwhelming navigation.

- **Learn**: What is NMSh, Fundamental Concepts (ShellAdapter, PTYs, UI boundaries).
- **Guides**: Composer, Transcripts, Customization, Context Engine, Sessions, Tools, Agents, Troubleshooting, Contributing.
- **Reference**: Comprehensive CLI Commands & Flags, Configuration files, Keyboard Shortcuts matrix.
- **Project**: Architecture, Roadmap & Releases.

## 3. Feature/Status Inventory Strategy
To clearly distinguish released vs in-development features, we use a reusable MDX `<Availability />` component.
- **Released**: `status="released" version="v0.17.0"`
- **Unreleased (Dev)**: `status="unreleased" issue="304"` (Implemented on `dev`, planned for the next release, e.g. v0.18.0)
- **In Progress**: `status="in-progress" issue="305"`
- **Planned**: `status="planned"`

## 4. Branding and Assets
Per strict instructions, no legacy screenshots, GIFs, stock imagery, or AI mockups are used.
- The default Starlight `houston.webp` logo has been replaced.
- We exclusively use official vector branding: `nmsh-lockup.svg`, `vespyr-divider.svg`, and the `architecture.svg` diagrams located in `public/assets/`.
- Future screenshots should be captured at 16:9 or terminal standard ratios, saved as highly optimized WebP, and placed in `src/assets/`.

## 5. Build and Deployment
- **Local Dev**: `npm install` then `npm run dev` in the `site/` directory.
- **Build**: `npm run build` inside `site/`.
- **Deployment Workflow**: `.github/workflows/deploy.yml` triggers on pushes to the master branch (once the PR is merged) and deploys to GitHub Pages via Actions.

## 6. Completed Audit (Quality Pass 2)
- ✅ Retargeted PR #371 to `master`. Diff is clean (only `site/` and `.github/workflows/deploy.yml`).
- ✅ Removed Starlight's default `houston.webp` from all configs and MDX.
- ✅ Integrated NMSh's real vector branding (`nmsh-lockup.svg`, `vespyr-divider.svg`).
- ✅ Configured Astro with `site: 'https://raisecaterror.github.io'` and `base: '/notMyShell'` for GH Pages.
- ✅ Fixed Starlight navigation links to use `slug` to correctly resolve the `base` path.
- ✅ Expanded Configuration docs (`config.json`, export/import, portable categories).
- ✅ Expanded Commands docs (CLI flags, maintenance commands, slash-commands).
- ✅ Created Keyboard Shortcuts matrix (Kitty protocol, editor keys, terminal host specifics).
- ✅ Expanded Context Engine docs with the full 7 first-party module catalog.
- ✅ Created Troubleshooting guide (macOS, Linux, WSL2, host configurations).
- ✅ Created Contributing guide (development loop, verification rules).
- ✅ Reconciled Roadmap (v0.18 is unreleased dev line, v0.19 is Context Engine). Fixed Availability component to use `issue` links.

## 7. GitHub Pages Activation Instructions (For Repository Admin)
Because GitHub Pages is not yet enabled for this repository, the initial GitHub Actions deployment run may fail with a permissions error.

To activate GitHub Pages for the documentation:
1. Go to the repository **Settings** on GitHub.
2. Under the "Code and automation" sidebar section, click **Pages**.
3. Under "Build and deployment" > "Source", select **GitHub Actions** from the dropdown menu (instead of "Deploy from a branch").
4. Re-run the failed `Deploy Documentation Site to GitHub Pages` workflow in the Actions tab. The site will deploy successfully to `https://raisecaterror.github.io/notMyShell/`.
