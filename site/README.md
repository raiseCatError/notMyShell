# notMyShell Documentation Website

Official documentation site for [notMyShell (NMSh)](https://github.com/raiseCatError/notMyShell).

Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Development

Run all commands from within the `site/` directory:

```bash
npm install     # Install dependencies
npm run dev     # Start local development server (http://localhost:4321)
npm run build   # Build production static bundle to ./dist/
npm run preview # Preview the production build locally
```

## Structure

```
site/
├── public/         # Static assets served at the site root
├── src/
│   ├── assets/     # Vector branding and diagrams
│   ├── components/ # Reusable MDX components (<Availability />, etc.)
│   ├── content/
│   │   └── docs/   # Documentation pages (MDX)
│   ├── styles/     # Tailwind and Starlight theme styling
│   └── custom.css  # Lavender theme styling overrides
├── astro.config.mjs # Astro and Starlight configuration
└── package.json
```

## Deployment

The documentation site deploys to GitHub Pages via `.github/workflows/deploy.yml` on pushes to the `master` branch.
