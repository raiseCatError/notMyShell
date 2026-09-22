# notMyShell

**NMSh** is a terminal-native frontend around a persistent zsh session. It keeps command output in an independently scrollable upper viewport and provides a rich, stable multiline editor at the bottom of the existing terminal.

## What is NMSh?

NMSh is **NOT** a replacement shell implementation, and it is **NOT** a terminal emulator.

It is a frontend that wraps your real zsh environment. NMSh owns the prompt, multiline input editor, syntax highlighting, and history presentation. Real zsh owns the parsing, command execution, aliases, and environment variables.

```
Terminal host (Ghostty, macOS Terminal, VS Code)
        ↓
NMSh (terminal frontend/editor)
        ↓
real zsh (shell execution engine)
```

## Why?

NMSh was built to provide a richer interactive frontend without throwing away the proven robustness of a real shell parser. It brings a Claude Code-like interaction model to your daily shell:

- Fixed bottom input editor
- Scrollable history viewport that doesn't disappear
- True multiline input that acts like a text editor
- Command lifecycle and status presentation
- Preserves your real shell semantics, aliases, and pipelines

## Features

- **Real zsh execution:** Uses your actual zsh environment, aliases, functions, and pipelines.
- **Semantic syntax highlighting:** Differentiates executables, builtins, aliases, functions, and unknown commands instantly using real-zsh-backed classification.
- **Rich editing:** Multiline input, selection, bracketed paste, and word movement.
- **Command lifecycle rows:** Visually separates distinct command executions with status markers and activity animations.
- **Completion bridge:** Uses real zsh completion data.
- **Ghost autosuggestions:** Unobtrusive history suggestions.
- **History viewport:** Independently scrollable output.
- **`/copy` and `/copy N`:** Instantly copy the output of recent commands to the clipboard.
- **`/history`:** Interactive history search.
- **`/appearance`:** Configure Ghostty window opacity and blur directly from the CLI.
- **`/keyboard`:** Automate Ghostty keybinding forwarding rules.
- **Passthrough:** Safely yields the terminal for full-screen applications like `fzf`, `vim`, `nano`, and `less`.

## Demo

```
❯ git status
On branch master
nothing to commit, working tree clean
✻ Checked status for 0.1s · done 14:30

❯ echo "hello world"
hello world
✻ Ran for 0.0s · done 14:31
```

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

After linking, you can run the CLI from anywhere:

```sh
nmsh
```

## Ghostty setup

For the most robust startup experience in Ghostty, configure it to run NMSh using absolute paths. GUI applications on macOS sometimes have unpredictable `PATH` resolution.

1. Find your absolute paths by running:
   ```sh
   command -v node
   command -v nmsh
   ```

2. Add the direct command to your Ghostty config (e.g., `~/.config/ghostty/config`):
   ```
   command = direct:/absolute/path/to/node /absolute/path/to/nmsh
   ```

Do not instruct macOS to change your default login shell to NMSh. NMSh is a frontend; zsh remains the underlying shell.

## Keyboard behavior

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

## /keyboard

Some advanced shortcuts (like Option+Backspace, Cmd+A, Cmd+Up/Down) are normally consumed or collapsed by the terminal host before NMSh sees them.

NMSh provides a `/keyboard` slash command that can install managed forwarding rules exclusively into your Ghostty configuration. This allows NMSh to accurately distinguish keys like Option+Backspace from a plain Backspace (`0x7f`).

- This integration is **opt-in**.
- It only modifies Ghostty configuration.
- It does not alter any macOS system keybindings.

## /appearance

The `/appearance` slash command provides an interactive UI to adjust Ghostty's window background opacity, blur mode, and blur radius.

Ghostty itself owns the rendering of the window background, transparency, blur, and font. NMSh simply provides a CLI interface to update the configuration file. NMSh owns the foreground UI colors, input editor, and status presentation.

## Shell compatibility

NMSh boots a real, controlled zsh instance.

**What works naturally:**
- Aliases and functions
- PATH and environment variables
- `zoxide` integration
- Shell expansion, pipelines, and redirects
- External commands and exit statuses

**UI Plugin differences:**
- `Powerlevel10k` (and other prompt rendering) is strictly suppressed inside NMSh.
- `zsh-autosuggestions` functionality is replaced by NMSh-native ghost suggestions.
- `zsh-syntax-highlighting` is replaced by NMSh-native semantic highlighting.
- `fzf-tab` UI is not rendered directly.

NMSh loads your `~/.zshrc` in a controlled sandbox to extract environment knowledge without letting UI plugins fight for terminal control.

## Syntax highlighting

Highlighting is entirely NMSh-native and non-blocking. A lexical layer tokenizes the input, while an asynchronous semantic bridge queries your real zsh environment to classify command tokens.

Visual differentiation includes:
- Executables, builtins, aliases, and functions
- Unknown commands
- Strings, variables, operators, redirects, flags, and comments

**Security note:** NMSh queries metadata safely (`whence -w`) and never executes partially typed input to highlight it.

## Host compatibility

| Host | Status | Notes |
|------|--------|-------|
| Ghostty | Primary | Full integration available (`/keyboard`, `/appearance`). |
| macOS Terminal | Supported | Shift+Enter works out of the box. |
| VS Code Integrated Terminal | Supported | `Shift+Enter` may require custom `keybindings.json` forwarding. Opacity/blur controls are not applicable. |

## Known limitations

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

## Architecture

Major internal components:
- **`TerminalApp`**: The main rendering loop and input coordinator.
- **`ShellSession`**: Manages the persistent background zsh PTY and controlled `.zshrc` bootstrap.
- **`CommandEditor`**: The multiline grapheme-aware input buffer and selection engine.
- **`TerminalRenderer`**: Alternating-screen compositor that renders only changed rows.
- **`CompletionService`**: Bridges real zsh completion data safely.
- **`SemanticService` & `Highlighter`**: Fast lexical tokenization combined with background metadata lookup for semantic colors.
- **`OutputBuffer`**: Parses raw ANSI output, strips unsafe sequences, and maintains the scrollable viewport state.

## Security / privacy

- Everything executes locally on your machine through your local shell.
- No cloud backend is required.
- No telemetry is collected.
- Shell configuration reads from your local system securely.

## License

NMSh is licensed under the **GNU General Public License v3.0** (GPL-3.0-only). See the `LICENSE` file for details.
