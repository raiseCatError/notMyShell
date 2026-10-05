# Development VHS tapes

Two VHS sets with separate jobs:

- **`scripts/demos/`** is the canonical source of README and `docs/demos.md`
  media: `npm run demos` records committed tapes into `assets/readme/` from a
  disposable demo home. Change those tapes when published media should change.
- **`dev/tapes/`** (this directory) holds development captures: feature and
  regression looks (Settings, Chroma, idle visuals, shimmer) written to the
  ignored `dev/tapes/output/`. They are never published as-is.

The earlier asciinema/tmux recorder (`scripts/readme-demo/`) was retired: it
recorded against the maintainer's real home. Use plain `asciinema rec` by hand
when a real interactive session is needed as support evidence.

Neither set is a runtime dependency, and neither is installed for NMSh users.

## VHS tapes

These optional VHS tapes capture welcome, Settings v2, an ordinary command, native history selection and idle visuals. They are development tooling only; NMSh does not depend on VHS at runtime, and `npm test` does not invoke it.

## Run

From the repository root, install the normal project dependencies if needed, then run:

```sh
npm run build
mkdir -p dev/tapes/output
vhs validate 'dev/tapes/*.tape'
vhs dev/tapes/welcome.tape
vhs dev/tapes/settings.tape
vhs dev/tapes/command.tape
vhs dev/tapes/intelligence.tape
vhs dev/tapes/idle-aurora.tape      # Aurora Drift, Aurora Chroma
vhs dev/tapes/idle-warp.tape        # Warp Starfield
vhs dev/tapes/idle-fireworks.tape   # Fireworks, Rainbow Chroma
vhs dev/tapes/idle-catppuccin.tape  # Aurora Drift following Catppuccin Mocha (blue accent)
vhs dev/tapes/shimmer.tape          # color-aware light sweep, one pass per row
```

Idle-visual tapes write short WebM files (smooth gradients without large GIF
artifacts) plus a PNG screenshot. `NMSH_DEMO_CONFIG` passes a JSON overlay to
the isolated demo config (glyph style, Chroma palette, theme), and
`NMSH_IDLE_START_MS` picks the deterministic starting phase.

VHS writes GIFs under `dev/tapes/output/`, which is ignored by Git. VHS is not installed automatically. Install it using the instructions in the [official VHS repository](https://github.com/charmbracelet/vhs) if you want to record these demos.

The launch helper isolates HOME/preferences, disables update checks, opts out of the session service and uses the current `NMSH_DETERMINISTIC=1` seam. It never edits user config or attaches an existing session. Each tape exits so the helper can remove its private directory. Deterministic presentation freezes decorative motion and the completion clock only; real command durations, scheduling, font, build identity and cwd still vary. Review captures before sharing; these are not pixel goldens.

Prefer VHS 0.12.1 or later: the previously tested host 0.12.0 binary reported success without materializing recordings. Validation is useful locally; visual-golden CI is deferred because font/host/timing differences would make it fragile. No end-user QA or optional-tool installation is required. Keep captures short and offline.
