# NMSh demos (VHS)

Every animated clip and still in the README and [docs/demos.md](../../docs/demos.md) is recorded from the real NMSh build by [Charmbracelet VHS](https://github.com/charmbracelet/vhs). The `.tape` files here are the source of truth; commit a tape change together with its regenerated asset.

```sh
npm run demos                       # build NMSh, record every tape
npm run demos -- main keep-awake    # only these
npx tsx scripts/demos/vespyr-svg.ts # the Vespyr divider (from the real sprite)
```

## Requirements

- VHS (recorded with 0.12.0), plus `ttyd` and `ffmpeg`, which VHS uses. Install them from your package manager, for example `brew install vhs` (pulls in both) on macOS; see the [VHS installation notes](https://github.com/charmbracelet/vhs#installation) for other systems. Nothing here installs them for you.
- zsh, git and `lsof`.
- The **JetBrainsMono Nerd Font** (`settings.tape` sets it) so Nerd glyphs render; without it VHS falls back to another font and icons show as boxes.

## What a run does

- Builds NMSh, then for each tape creates a **disposable demo home** (HOME, XDG directories, NMSh config and runtime, git config, TMPDIR) with a small fixture project at `~/Projects/demo` on branch `feature/theme-preview`. Your NMSh settings, shell rc files, history, themes, sessions and dotfiles are never read or written, and nothing personal (user, host, paths) appears in a recording.
- Uses no network: NMSh update checks are off in the demo config and npm's update notifier is disabled.
- Composes `settings.tape` (shared framing: font, size, colors, typing speed), the demo environment as `Env` lines, and the tape. VHS records PNG frames and `render.mjs` encodes the GIF (and any `# demo-still:` PNGs) itself with ffmpeg, so the palette and size do not depend on a particular VHS/ffmpeg pairing.
- Afterwards stops every process that still holds files in the demo home (frontends, the session service, shells, the Keep Awake helper), removes it, and fails if anything survives.

## Tape conventions

| Line | Meaning |
| --- | --- |
| `Output assets/readme/<name>.gif` | the clip this tape produces (one per tape) |
| `# demo-still: <path>.png <seconds>s` | also save that frame as a still |
| `# demo-env: KEY=VALUE` | extra environment for this recording |
| `# demo-config: {...}` | merged into the demo NMSh config |

Keep clips focused (5–25 s), type at a readable pace and pause after each visible change. Use `NMSH_DETERMINISTIC=1` only where it helps: it also freezes NMSh motion, so screensaver and Chroma clips leave it off.

**Keep Awake** is recorded with `NMSH_DETERMINISTIC=1 NMSH_KEEP_AWAKE_BACKEND=inert`: the real slash command, controller, ownership record and presentation run, but the backend is an inert helper, so recording never keeps a machine awake. `NMSH_DEMO_AWAKE_IDLE_MS` shortens the idle-reminder delay for the clip; both are ignored without `NMSH_DETERMINISTIC=1`.

**Sessions** ends the frontend with `SIGHUP`, the signal a closing terminal window sends, then reattaches with `nmsh`; nothing about the detach is simulated.

## Tapes

| Tape | Asset | Shows |
| --- | --- | --- |
| `main.tape` | `nmsh-demo.gif`, `nmsh-composer.png` | README hero: highlighting, a live test run, a theme change from `/theme` |
| `composer.tape` | `composer.gif` | `/prompt` one-line + Soft style, `/layout` Top and Flow |
| `themes.tape` | `themes.gif`, `theme-studio.png` | Theme Studio browsing with live preview, Duplicate → Custom |
| `sessions.tape` | `sessions.gif` | A build that keeps running while the window is gone; reattach |
| `screensavers.tape` | `screensavers.gif` | Aurora, Warp, Night Fireworks, Bouncing Vespyr, Black Hole |
| `keep-awake.tape` | `keep-awake.gif`, `keep-awake.png` | `/zoomies display`, composer edge + Status Strip, idle reminder, status, stop |
| `tools.tape` | `tools.gif` | `/providers` and the `/tools` catalog (browsing only) |
| `theme-bridge.tape` | `theme-bridge.gif` | `/theme-bridge` panel and `/integrations` health |

This replaces the earlier asciinema/tmux recorder (`scripts/readme-demo/`), which recorded against the maintainer's real home.
