# NMSh Website Development Record

## 1. Stack and Rationale
- **Framework**: Astro with the Starlight template.
- **Why**: Starlight is the standard for modern documentation sites. It provides out-of-the-box support for Markdown/MDX, excellent typography, a configurable sidebar, powerful search (Pagefind), accessibility features, dark/light mode switching, and an easy path to a customized homepage. It outputs static HTML perfectly suited for GitHub Pages.
- **Styling**: Tailwind CSS (to be added) for the homepage custom layout and utility classes, with customized Starlight CSS variables for the NMSh identity (Lavender accent: `#A67CF3`).

## 2. Content Architecture
The site is organized into logical learning paths to support both beginners and experienced users without overwhelming navigation.

- **Learn (Getting Started)**: Intro, Installation, First Launch, Basic Walkthrough.
- **Guides**:
  - Fundamental Concepts (ShellAdapter, PTYs, UI boundaries)
  - Composer and Interaction
  - Transcripts and Workflows
  - Appearance and Customization (Theme Studio, Theme Bridge)
  - Sessions and Workspaces
  - Context Engine and Modules (Extensive coverage of v0.17 foundation and planned v0.19 features)
  - Tool Integrations (fzf, zoxide, starship, dotfiles)
  - Managed Agents (Claude)
- **Reference**:
  - Commands and Keyboard Shortcuts
  - Configuration files
  - Theme JSON format
  - Context Pack format
- **Project**:
  - Architecture
  - Roadmap & Releases (Clear demarcation of v0.17 released vs v0.18/0.19 dev)

## 3. Feature/Status Inventory Strategy
To clearly distinguish released vs in-development features, we will use custom Starlight `Badge` components or a reusable MDX `<Availability />` component.
- **Released (v0.17.0)**: Documented normally.
- **Implemented, Unreleased (dev/v0.18.0/v0.19.0)**: Documented with clear "Unreleased" badges and notes that these features require building from the `dev` branch or wait for the next release.
- **Planned**: Mentioned in the Roadmap section, not mixed into active tutorials.

## 4. Build and Deployment
- **Local Dev**: `npm run dev` in the `site/` directory.
- **Build**: `npm run build` in the `site/` directory.
- **Deployment**: A GitHub Actions workflow `.github/workflows/deploy.yml` triggers on pushes to `docs/github-pages-site`. It builds the Astro site and deploys the static output to GitHub Pages.

## 5. Media Integration (Future)
We have intentionally excluded existing screenshots and GIFs as requested.
- **How to add media later**: 
  - Place WebP images or MP4/WebM videos in `site/src/assets/`.
  - Use Astro's `<Image />` component or standard HTML `<video>` tags in the MDX files.
  - Recommended dimensions: 1920x1080 (16:9) or 1280x800 for terminal captures.
  - Keep media lightweight and provide `alt` text.

## 6. Work Remaining
- Build the actual MDX pages.
- Customize `astro.config.mjs` sidebar.
- Create the custom homepage.
- Validate internal links.
- Test deployment.
