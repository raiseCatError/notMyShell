<div align="center">
  <picture>
    <img alt="NMSh Logo" src="assets/brand/nmsh-logo.png" width="300">
  </picture>

  <p><b>A terminal frontend for your real shell.</b></p>

  <p>
    <a href="https://github.com/raiseCatError/notMyShell/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-8B84B2.svg" alt="License"></a>
    <img src="https://img.shields.io/badge/platform-macOS-B0B8C2.svg" alt="macOS">
    <img src="https://img.shields.io/badge/node-%3E%3D%2018-C5B9E8.svg" alt="Node.js">
    <img src="https://img.shields.io/badge/shell-zsh-F2F0EC.svg" alt="zsh">
  </p>
</div>

<br>

**NMSh** is a terminal-native frontend around a persistent zsh session. It keeps command output in an independently scrollable upper viewport and provides a rich, stable multiline editor at the bottom of the existing terminal.

## Visual demo

<div align="center">
  <img alt="NMSh Demo" src="assets/readme/nmsh-demo.gif" width="700">
  <p><em>NMSh showing semantic highlighting, the pinned input bar, and live activity feedback.</em></p>
</div>

<br>
<div align="center">
  <picture>
    <img alt="Divider" src="assets/readme/divider.svg" width="600">
  </picture>
</div>
<br>

## What is NMSh?

NMSh is **NOT** a replacement shell implementation, and it is **NOT** a terminal emulator.

It is a frontend that wraps your real zsh environment. NMSh owns the prompt, multiline input editor, syntax highlighting, and history presentation. Real zsh owns the parsing, command execution, aliases, and environment variables.

<div align="center">
  <picture>
    <img alt="NMSh Architecture" src="assets/readme/architecture.svg" width="500">
  </picture>
</div>

## Why NMSh?

NMSh provides a richer interactive frontend without throwing away the proven robustness of a real shell parser. It brings a Claude Code-like interaction model to your daily shell:

- **Fixed bottom input:** A stable workspace that never jumps around.
- **Scrollable history:** Output history that doesn't disappear when you edit.
- **Rich editor:** True multiline input that acts like a text editor.
- **Preserved semantics:** Your real shell aliases, functions, and pipelines still work.

<br>
<div align="center">
  <picture>
    <img alt="Divider" src="assets/readme/divider.svg" width="600">
  </picture>
</div>
<br>

## Features

### Shell
- Real zsh execution and parsing
- Real aliases, functions, and environment
- `zoxide` integration
- Completion bridge using real zsh completion data

### Editor
- Multiline input and selection
- Ghost autosuggestions from history
- **Semantic syntax highlighting** (differentiates executables, builtins, aliases, and functions instantly)

### Interface
- Command lifecycle rows with activity animation
- Scrollable history viewport
- `/copy` and `/copy N` for instant clipboard access
- `/history` interactive search
- `/appearance` and `/keyboard` integrations

### Interactive Apps
- Safe passthrough yielding for full-screen applications like `fzf`, `vim`, `nano`, and `less`.

<br>
<div align="center">
  <picture>
    <img alt="Divider" src="assets/readme/divider.svg" width="600">
  </picture>
</div>
<br>

## Syntax Highlighting

Highlighting is entirely NMSh-native and non-blocking. A fast lexical layer tokenizes the input, while an asynchronous semantic bridge queries your real zsh environment to classify command tokens.

NMSh safely queries metadata (`whence -w`) and never executes partially typed input.

<div align="center">
  <picture>
    <img alt="Syntax highlighting demo" src="assets/readme/syntax-demo.svg" width="600">
  </picture>
</div>

<br>
<div align="center">
  <picture>
    <img alt="Divider" src="assets/readme/divider.svg" width="600">
  </picture>
</div>
<br>

## Shell Compatibility

NMSh currently boots a real, controlled zsh instance.

**What works naturally:**
- Aliases, functions, PATH, and environment variables
- `zoxide` integration, pipelines, redirects, and external commands

**UI Plugin differences:**
- `Powerlevel10k` (and other prompt rendering) is strictly suppressed.
- `zsh-autosuggestions` and `zsh-syntax-highlighting` are replaced by NMSh-native equivalents.
- `fzf-tab` UI is not rendered directly.

NMSh loads your `~/.zshrc` in a controlled sandbox to extract environment knowledge without letting UI plugins fight for terminal control.

See [ROADMAP.md](ROADMAP.md) for planned shell compatibility, multi-shell adapters, and future work.

## Installation

**Prerequisites:**
- macOS
- Node.js (v18+)
- zsh
- A compatible terminal host (Ghostty, macOS Terminal, VS Code)

Clone the repository and install dependencies:

```sh
git clone https://github.com/raiseCatError/notMyShell.git
cd notMyShell
npm install
npm run build
npm link
```

*(Note: Depending on your npm version, you may be prompted to allow lifecycle scripts required by `node-pty`. You can safely approve this or set `allowScripts` appropriately.)*

After linking, run the CLI from anywhere:

```sh
nmsh
```

## Ghostty Setup

For the most robust startup experience in Ghostty, configure it to run NMSh using absolute paths. GUI applications on macOS sometimes have unpredictable `PATH` resolution.

1. Find your absolute paths:
   ```sh
   command -v node
   command -v nmsh
   ```

2. Add the direct command to your Ghostty config (`~/.config/ghostty/config`):
   ```
   command = direct:/absolute/path/to/node /absolute/path/to/nmsh
   ```

Do not instruct macOS to change your default login shell to NMSh. NMSh is a frontend; zsh remains the underlying shell.

## Host Compatibility

| Host | Status | Notes |
|------|--------|-------|
| Ghostty | Primary | Full integration available (`/keyboard`, `/appearance`). |
| macOS Terminal | Supported | Shift+Enter works out of the box. |
| VS Code Integrated Terminal | Supported | `Shift+Enter` may require custom `keybindings.json` forwarding. Opacity/blur controls are not applicable. |

## Keyboard Behavior

- **Enter:** Submit command
- **Ctrl+J:** Portable multiline newline fallback
- **Shift+Enter (Ghostty/macOS Terminal):** Insert a newline in the editor
- **Option+Left/Right:** Move cursor by word
- **Option+Backspace:** Delete previous word (requires Ghostty forwarding setup)
- **Ctrl+W:** Delete previous word
- **Cmd+A:** Select all input (requires Ghostty forwarding setup)
- **Cmd+Up/Down:** Jump to top/bottom of buffer (requires Ghostty forwarding setup)
- **Shift+Left/Right:** Character selection
- **PageUp/PageDown:** Scroll output history

*(Note: In VS Code, Shift+Enter is often indistinguishable from Enter by default. Use Ctrl+J as a reliable multiline fallback.)*

### /keyboard & /appearance

Some advanced shortcuts (like Option+Backspace, Cmd+A) are normally consumed by the terminal host before NMSh sees them. The `/keyboard` slash command installs managed, opt-in forwarding rules exclusively into your Ghostty configuration. It does not alter any macOS system keybindings.

The `/appearance` slash command provides an interactive UI to adjust Ghostty's window background opacity, blur mode, and blur radius.

## Known Limitations

- **Mouse behavior:** Native mouse selection or Shift-drag behavior may feel different because NMSh enables mouse reporting.
- **ZLE widgets:** Certain complex third-party ZLE (Zsh Line Editor) widgets are not directly portable.
- **zsh grammar:** Syntax highlighting intentionally does not implement the entire, exhaustive zsh grammar; it focuses on providing fast semantic assistance for common command structures.

## Development

```sh
npm run build
npm run typecheck
npm test
git diff --check
```

See [ROADMAP.md](ROADMAP.md) for future multi-shell architecture and extensibility plans.

## Security & Privacy

- Everything executes locally on your machine through your local shell.
- No cloud backend is required.
- No telemetry is collected.
- Shell configuration reads from your local system securely.

## License

NMSh is licensed under the **GNU General Public License v3.0** (GPL-3.0-only). See the `LICENSE` file for details.
