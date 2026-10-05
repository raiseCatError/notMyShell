# NMSh demo gallery

Four chapters of real NMSh: make it yours, see it move, work with your tools, and return to your sessions. Each chapter opens with a featured recording; expand the walkthroughs for the rest.

[Customization](#customization) · [Color and motion](#color-and-motion) · [Tools and shells](#tools-and-shells) · [Sessions](#sessions)

Every GIF runs the real binary in a disposable home (`~/Projects/demo`), with an opaque 1440 × 960 capture and neutral demo welcome. VHS provides a clean terminal surface; these are not Ghostty or Zed desktop captures. The clips were recorded on macOS; Linux and Windows/WSL behavior is covered by automated tests. [Recording sources and reproduction](../scripts/demos/README.md).

<details>
<summary><b>Start here: NMSh in one recording</b></summary>

## Using NMSh

Type a semantically highlighted command, follow a live test run, then change the theme from `/theme`.

<img alt="NMSh hero demo" src="../assets/readme/nmsh-demo.gif" width="960">

*From input to feedback: a persistent real shell under the NMSh frontend.*

</details>

## Customization

Start with Setup Cat, then shape the composer, prompt and colors around the way you work.

<a id="setup-syntax-and-chroma"></a>

### Setup Cat

First launch opens `/setup`; Apply completes discovery. Escape discards the draft and leaves setup pending. Completed and legacy onboarding stays completed, explicit presets bypass discovery, and `/setup` can be reopened anytime.

<img alt="Setup Cat with current choices and live previews" src="../assets/readme/setup.gif" width="960">

*The same draft-based setup surface on first launch and whenever you return.*

<details>
<summary><b>Walkthroughs: composer, themes and syntax</b></summary>

### Composer and prompts

`/prompt` changes the Native prompt to one-line and Soft style; `/layout` moves the composer to Top, then Flow after the newest output. See [prompt customization](architecture/prompt-customization.md).

<img alt="Composer and prompt changes" src="../assets/readme/composer.gif" width="960">

*One editor, different placements: Bottom, Top and Flow.*

### Theme Studio

`/theme` previews built-in themes on the real prompt, interface and syntax roles before applying them, and duplicates one into Custom for editing. See [themes, imports and Theme Bridge](design/theme-bridge.md).

<img alt="Theme Studio" src="../assets/readme/themes.gif" width="960">

*Browse, preview and edit through one shared theme system.*

### Syntax themes

`/syntax` follows the saved NMSh theme, chooses a family and variant independently, or uses grayscale. Custom appears when a custom theme exists; Catppuccin uses the shared accent from `/theme`. The same role palettes color input and new submitted command lines. Raw output keeps its own colors.

<img alt="Shared syntax theme families" src="../assets/readme/syntax.gif" width="960">

*Family and variant choices with real semantic previews.*

</details>

## Color and motion

Color treatments, command feedback and idle scenes share NMSh’s motion controls. Motion remains live in these recordings.

### Chroma gradients

Chroma controls show whether previews are colorized. Turn Chroma Off to see base theme colors. C in `/theme` and P in Setup toggle only the local preview; C in `/prompt` changes its draft. `/chroma` exposes the full controls.

<img alt="Gradients and Chroma state" src="../assets/readme/chroma.gif" width="960">

*Change gradient looks, then return to the underlying theme colors.*

<details>
<summary><b>Walkthrough: Rich motion and live feedback</b></summary>

### Rich motion and activity

Real commands show live status, completion and failure feedback. `/setup motion` previews Rich rendering for each event without running a command.

<img alt="Rich motion and live activity" src="../assets/readme/motion.gif" width="960">

*Command activity and animation previews that give motion a clear purpose.*

</details>

<details>
<summary><b>Screensaver collection: every named scene</b></summary>

### Screensavers and Vespyr

Every named saver appears below. Random selects among these scenes rather than adding another visual; any key returns to the composer.

#### Atmospheres

<img alt="Aurora Drift, Deep Space, Warp Starfield and Rain" src="../assets/readme/screensavers.gif" width="960">

*Aurora Drift → Deep Space → Warp Starfield → Rain.*

#### Sparks and orbits

<img alt="Sparkles, Night Fireworks, Black Hole, Fireworks and Circletastic" src="../assets/readme/screensavers-motion.gif" width="960">

*Sparkles → Night Fireworks → Black Hole → Fireworks → Circletastic.*

#### Vespyr and raiseCatError

<img alt="Bouncing Vespyr and raiseCatError" src="../assets/readme/screensavers-cats.gif" width="960">

*Vespyr’s bounce and the playful raiseCatError scene, with time to see each move.*

</details>

## Tools and shells

Choose providers, review tools, ask for local guidance, and use real interactive programs.

### Providers and tools

`/providers` shows each job’s provider inline. `/tools` lists curated tools, project relevance and the exact install plan; Space leaves persistent checked markers as focus moves away. Nothing was installed in the recording.

<img alt="Providers and tools with persistent chosen-item checkboxes" src="../assets/readme/tools.gif" width="960">

*Choose first, review the plan, then decide whether to install.*

<details>
<summary><b>Walkthroughs: Ask, Theme Bridge, Fish and Vim</b></summary>

### Ask and local understanding

`/ask` provides typed local guidance in a conversational surface. `/llm` shows optional local-understanding settings; this recording downloads no model and makes no claim that model inference ran.

<img alt="Ask and local-understanding settings" src="../assets/readme/ask.gif" width="960">

*Local guidance and a look at the optional understanding controls.*

### Theme Bridge and integrations

`/theme-bridge` is opt-in and starts with every tool Independent. Each target shows how NMSh would theme it: environment, managed file or detection only. `/integrations` reviews managed-tool health. See [Theme Bridge](design/theme-bridge.md).

<img alt="Theme Bridge panel and integrations review" src="../assets/readme/theme-bridge.gif" width="960">

*The control surface and ownership review; external tools are not driven in this clip.*

### Fish and Vim

`/shell fish` switches the existing session while preserving NMSh appearance and archives the old view in `/resume`. A differing shell leads the default Native prompt; customized ordering remains configurable in `/prompt`. Vim uses real passthrough and restores the composer on exit.

<img alt="Entering and exiting Vim, then switching to Fish" src="../assets/readme/shell-vim.gif" width="960">

*Real Vim entry/exit, followed by Fish with the NMSh theme preserved. Vim itself is not themed without an enabled Theme Bridge.*

</details>

## Sessions

Let a command keep running when the window goes away, then return to the same shell.

### Live sessions

The frontend receives `SIGHUP`, as from a closing window. The build continues; `nmsh` offers the detached session and reattaches with the output that arrived meanwhile.

<img alt="Detach and reattach a live session" src="../assets/readme/sessions.gif" width="960">

*Detach during a build and return to its live session.*

<details>
<summary><b>Walkthrough: Keep Awake</b></summary>

### Keep Awake

`/zoomies display` starts Keep Awake and immediately returns the prompt. `Awake · Display` appears on a free composer edge and in the Status Strip. The idle reminder adds elapsed time and `/zoomies stop`; stopping removes the presentation. See [Keep Awake](design/keep-awake.md).

<img alt="Keep Awake" src="../assets/readme/keep-awake.gif" width="960">

*Recorded with the inert demo backend: the full UI runs without keeping a machine awake.*

</details>

---

## Architecture

The simple stack follows the original artwork: terminal host, NMSh frontend and real shell, with Vespyr beside the NMSh title.

<p align="center"><img alt="Vertical NMSh terminal stack with square borders" src="../assets/readme/architecture.svg" width="640"></p>

<details>
<summary><b>Detailed runtime flow: helpers, geometry, sessions and passthrough</b></summary>

<img alt="Detailed vertical NMSh runtime flow" src="../assets/readme/architecture-detailed.svg" width="1000">

*The same central stack, with supporting services and the raw interactive path shown separately.*

</details>

## Stills

Full-size views for inspecting details without motion.

| Composer and Native prompt | Theme Studio | Keep Awake idle reminder |
| --- | --- | --- |
| [<img alt="Composer with the Native prompt" src="../assets/readme/nmsh-composer.png" width="300">](../assets/readme/nmsh-composer.png) | [<img alt="Theme Studio" src="../assets/readme/theme-studio.png" width="300">](../assets/readme/theme-studio.png) | [<img alt="Keep Awake idle reminder" src="../assets/readme/keep-awake.png" width="300">](../assets/readme/keep-awake.png) |

<p align="center"><img alt="Vespyr, the NMSh cat" src="../assets/readme/vespyr-divider.svg" width="520"></p>

[Back to README](../README.md) · [Recording sources](../scripts/demos/README.md)
