# NMSh demo gallery

Every GIF clip is the real NMSh binary, recorded with VHS from the committed tapes in [`scripts/demos/`](../scripts/demos/README.md) against a disposable demo home (`~/Projects/demo`). Captures are opaque 1440 × 960, with a neutral demo welcome instead of release/build metadata. VHS supplies a clean terminal surface independent of desktop window decorations; these are not Ghostty or Zed screen captures. Re-record with `npm run demos`. They were recorded on macOS; Linux and Windows/WSL behavior is covered by automated tests, not by these recordings.

<p align="center"><img alt="Vespyr, the NMSh cat" src="../assets/readme/vespyr-divider.svg" width="520"></p>

## Using NMSh

Typing with semantic highlighting, a live test run in the transcript, and a theme change from `/theme`.

<img alt="NMSh hero demo" src="../assets/readme/nmsh-demo.gif" width="960">

## Composer and prompts

`/prompt` switches the Native prompt to one-line and the Soft style; `/layout` moves the composer to the top, then to Flow, right after the newest output. See [prompt customization](architecture/prompt-customization.md).

<img alt="Composer and prompt changes" src="../assets/readme/composer.gif" width="960">

## Theme Studio

`/theme` previews each built-in theme on the real prompt, interface and syntax roles before you set it, and duplicates one into Custom for editing. See [themes, imports and Theme Bridge](design/theme-bridge.md).

<img alt="Theme Studio" src="../assets/readme/themes.gif" width="960">

## Theme Bridge and integrations

`/theme-bridge` is opt-in and starts with every tool Independent; each target shows how NMSh would theme it (environment, managed file or detected only). `/integrations` reviews the health of everything NMSh manages. This clip shows the control surface only; external tools were not driven in the recording.

<img alt="Theme Bridge panel and integrations review" src="../assets/readme/theme-bridge.gif" width="960">

## Providers and tools

`/providers` shows each job's provider inline; `/tools` lists curated tools with what is relevant to the current project, details and the exact install plan. Nothing was installed in the recording.

<img alt="Providers and tools" src="../assets/readme/tools.gif" width="960">

## Live sessions

The build keeps running after its window goes away (the frontend gets `SIGHUP`, as from a closing window); `nmsh` offers the detached session and reattaches with the output that arrived meanwhile.

<img alt="Detach and reattach a live session" src="../assets/readme/sessions.gif" width="960">

## Screensavers and Vespyr

Every named saver is shown in three clips. Random chooses among these scenes rather than adding a separate visual. Motion stays visible, with several seconds per scene; any key restores the composer.

<img alt="Aurora Drift, Deep Space, Warp Starfield and Rain" src="../assets/readme/screensavers.gif" width="960">
<img alt="Sparkles, Night Fireworks, Black Hole, Fireworks and Circletastic" src="../assets/readme/screensavers-motion.gif" width="960">
<img alt="Bouncing Vespyr and raiseCatError" src="../assets/readme/screensavers-cats.gif" width="960">

## Keep Awake

`/zoomies display` starts Keep Awake and hands the prompt straight back; `Awake · Display` sits on the free composer edge and in the Status Strip, the idle reminder adds the time and a muted `/zoomies stop`, and stopping removes it all. Recorded with the inert demo backend, so nothing was kept awake. See [Keep Awake](design/keep-awake.md).

<img alt="Keep Awake" src="../assets/readme/keep-awake.gif" width="960">

## Stills

| | |
| --- | --- |
| <img alt="Composer with the Native prompt" src="../assets/readme/nmsh-composer.png"> | <img alt="Theme Studio" src="../assets/readme/theme-studio.png"> |
| Composer and Native prompt | Theme Studio |
| <img alt="Keep Awake idle reminder" src="../assets/readme/keep-awake.png"> | |
| Keep Awake with the idle reminder | |

## Setup, syntax and Chroma

First launch opens `/setup`; Apply completes discovery. Escape discards the draft and leaves first-run setup pending. Completed and legacy onboarding stays completed, and explicit presets bypass it. `/setup` can be reopened anytime.

<img alt="Setup Cat" src="../assets/readme/setup.gif" width="960">

`/syntax` follows the saved NMSh prompt theme, chooses a family and variant independently, or uses grayscale. Custom appears when a custom theme exists. The same role palettes power the real input and new submitted command lines; raw command output keeps its own colors. Catppuccin uses the shared accent from `/theme`.

<img alt="Shared syntax theme families" src="../assets/readme/syntax.gif" width="960">

Chroma controls show whether previews are colorized. Turn Chroma Off to view the base theme colors; `/theme` uses C and Setup uses P to toggle only their local preview. `/prompt` C changes its draft Chroma setting. `/chroma` exposes the full controls.

<img alt="Gradients and Chroma state" src="../assets/readme/chroma.gif" width="960">

## Ask and local understanding

`/ask` provides typed local guidance in a conversational surface. `/llm` shows optional local-understanding settings; the recording does not download a model or pretend that model inference ran.

<img alt="Ask and local-understanding settings" src="../assets/readme/ask.gif" width="960">

## Fish and Vim

`/shell fish` switches the existing session while preserving NMSh appearance. The old view is archived in `/resume`. The default Native module order puts a differing shell first; customized module orders remain configurable in `/prompt`. Real Vim owns the terminal through passthrough and returns to the composer on exit. The clip preserves the NMSh theme; it does not claim Vim is themed without an enabled Theme Bridge.

<img alt="Fish and real Vim passthrough" src="../assets/readme/shell-vim.gif" width="960">

## Rich motion and activity

Real commands show live status, completion and failure feedback. `/setup motion` previews the Rich rendering of each event without running a command.

<img alt="Rich motion and live activity" src="../assets/readme/motion.gif" width="960">

## Motion promo

[Watch the standalone 20-second promo](../assets/promo/nmsh-promo.mp4). It combines actual recordings with titles and transitions. It is silent for portable sharing; normal GIF demos remain the detailed feature walkthroughs. Regenerate with `npm run promo` after recording the demos.

## Architecture

<img alt="Simple terminal stack with Vespyr" src="../assets/readme/architecture.svg" width="960">
<img alt="Detailed runtime flow" src="../assets/readme/architecture-detailed.svg" width="1100">
