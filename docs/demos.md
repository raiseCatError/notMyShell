# NMSh demo gallery

Every clip is the real NMSh binary, recorded with VHS from the committed tapes in [`scripts/demos/`](../scripts/demos/README.md) against a disposable demo home (`~/Projects/demo`). Re-record with `npm run demos`. They were recorded on macOS; Linux and Windows/WSL behavior is covered by automated tests, not by these recordings.

<p align="center"><img alt="Vespyr, the NMSh cat" src="../assets/readme/vespyr-divider.svg" width="520"></p>

## Using NMSh

Typing with semantic highlighting, a live test run in the transcript, and a theme change from `/theme`.

<img alt="NMSh hero demo" src="../assets/readme/nmsh-demo.gif" width="760">

## Composer and prompts

`/prompt` switches the Native prompt to one-line and the Soft style; `/layout` moves the composer to the top, then to Flow, right after the newest output. See [prompt customization](architecture/prompt-customization.md).

<img alt="Composer and prompt changes" src="../assets/readme/composer.gif" width="760">

## Theme Studio

`/theme` previews each built-in theme on the real prompt, interface and syntax roles before you set it, and duplicates one into Custom for editing. See [themes, imports and Theme Bridge](design/theme-bridge.md).

<img alt="Theme Studio" src="../assets/readme/themes.gif" width="760">

## Theme Bridge and integrations

`/theme-bridge` is opt-in and starts with every tool Independent; each target shows how NMSh would theme it (environment, managed file or detected only). `/integrations` reviews the health of everything NMSh manages. This clip shows the control surface only; external tools were not driven in the recording.

<img alt="Theme Bridge panel and integrations review" src="../assets/readme/theme-bridge.gif" width="760">

## Providers and tools

`/providers` shows each job's provider inline; `/tools` lists curated tools with what is relevant to the current project, details and the exact install plan. Nothing was installed in the recording.

<img alt="Providers and tools" src="../assets/readme/tools.gif" width="760">

## Live sessions

The build keeps running after its window goes away (the frontend gets `SIGHUP`, as from a closing window); `nmsh` offers the detached session and reattaches with the output that arrived meanwhile.

<img alt="Detach and reattach a live session" src="../assets/readme/sessions.gif" width="760">

## Screensavers and Vespyr

The `/screensaver` gallery previews idle visuals inline: Aurora Drift, Warp Starfield, Night Fireworks, Bouncing Vespyr and the screen-based Black Hole. They never start on their own under Reduced Motion. See [idle visuals](design/idle-visuals.md).

<img alt="Screensaver gallery" src="../assets/readme/screensavers.gif" width="760">

## Keep Awake

`/zoomies display` starts Keep Awake and hands the prompt straight back; `Awake · Display` sits on the free composer edge and in the Status Strip, the idle reminder adds the time and a muted `/zoomies stop`, and stopping removes it all. Recorded with the inert demo backend, so nothing was kept awake. See [Keep Awake](design/keep-awake.md).

<img alt="Keep Awake" src="../assets/readme/keep-awake.gif" width="760">

## Stills

| | |
| --- | --- |
| <img alt="Composer with the Native prompt" src="../assets/readme/nmsh-composer.png"> | <img alt="Theme Studio" src="../assets/readme/theme-studio.png"> |
| Composer and Native prompt | Theme Studio |
| <img alt="Keep Awake idle reminder" src="../assets/readme/keep-awake.png"> | |
| Keep Awake with the idle reminder | |
