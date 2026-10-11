# NMSh Website Development Record

## 1. Stack and Architecture
- **Framework**: Astro with Starlight.
- **Why**: Starlight provides out-of-the-box support for Markdown/MDX, typography, a configurable sidebar, Pagefind search, accessibility features, dark/light mode switching, and static HTML output for GitHub Pages.
- **Styling**: Tailwind CSS (v4) for utility classes, with customized Starlight CSS variables for the NMSh identity (Lavender accent: `#ac96e6`).

## 2. Content Architecture
The site is organized into logical learning paths to support both beginners and experienced users without overwhelming navigation.

- **Learn**: What is NMSh, Fundamental Concepts (ShellAdapter, PTYs, UI boundaries).
- **Guides**: Composer, Transcripts, Customization, Context Engine, Sessions, Tools, Agents, Troubleshooting, Contributing.
- **Reference**: Comprehensive CLI Commands & Flags, Configuration files, Keyboard Shortcuts matrix.
- **Project**: Architecture, Roadmap & Releases.

## 3. Feature/Status Provenance Strategy
To clearly distinguish released vs in-development features, we use a reusable MDX `<Availability />` component.
- **Released**: `status="released" version="v0.17.0"`
- **Unreleased (Dev)**: `status="unreleased" issue="304"` (Implemented on `dev`, planned for the next release, e.g. v0.18.0)
- **In Progress**: `status="in-progress" issue="305"`
- **Planned**: `status="planned"`

## 4. Branding and Assets
- Strictly no legacy screenshots, GIFs, stock imagery, or placeholder artwork.
- We exclusively use official vector branding: `nmsh-lockup.svg`, `vespyr-divider.svg`, and architectural diagrams (`architecture.svg`, `architecture-detailed.svg`).
- Future media should be captured at 16:9 or terminal standard ratios, saved as WebP, and placed in `src/assets/`.

## 5. Build and Deployment
- **Local Dev**: `npm install` then `npm run dev` in the `site/` directory.
- **Build**: `npm run build` inside `site/`.
- **Deployment Workflow**: `.github/workflows/deploy.yml` triggers on pushes to `master` and manual `workflow_dispatch`.

## 6. Completed Source-Backed Audit
- **Configuration Paths**: Corrected paths per `src/configuration/paths.ts`: macOS (`~/Library/Application Support/notMyShell/config.json`) and Linux (`~/.config/nmsh/config.json` or `$XDG_CONFIG_HOME/nmsh/config.json`).
- **Portable Categories**: Updated export categories to match the 18 real IDs defined in `src/configuration/portability.ts` (`prompt`, `theme`, `themeBridge`, `chroma`, `chrome`, `syntax`, `transcript`, `layout`, `suggestions`, `providers`, `statusStrip`, `idle`, `notifications`, `tools`, `sessions`, `agents`, `shell`, `editor`).
- **Context Engine Modules**: Aligned the catalog with the 7 bundled first-party pack definitions in `src/context/packs/builtin/` (`nmsh.agents`, `nmsh.cloud`, `nmsh.environment`, `nmsh.infrastructure`, `nmsh.project`, `nmsh.system`, `nmsh.vcs`). Correctly distinguished core built-in prompt modules (`kubeContext`, `dockerContext`, `cwd`, `gitBranch`, `gitStatus`, etc.) from pack modules.
- **Commands & Flags**: Verified CLI flags (`nmsh --new`, `--sessions`, `--attach`, `--presets`, `--preset`, `--version`), maintenance commands (`nmsh doctor`, `nmsh uninstall`, `nmsh packs`, `nmsh agent-status`), and all slash commands in `src/commands/slashCommands.ts`.
- **Keyboard Shortcuts**: Verified key bindings against `src/terminal/keys.ts` and `src/input/editingKeys.ts`.
- **Authorship Conventions**: Strictly audited all site files, documentation, and commits to ensure zero model/tool attribution references.
