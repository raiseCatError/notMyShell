import {slashCommands} from '../commands/slashCommands.js';
import {authoredMarkdown, type AuthoredMarkdown} from './markdown.js';

/** The /help page. Every input is NMSh source (command table, fixed guidance); nothing comes from the shell. */
export function helpMarkdown(): AuthoredMarkdown {
  // Substantial surfaces by area, then everything else; aliases sit beside their command, not in a second row.
  const aliasesOf = (name: string) => slashCommands.filter(item => item.alias === name).map(item => `\`${item.name}\``);
  const row = (item: typeof slashCommands[number]) => `| \`${item.name}\`${aliasesOf(item.name).length ? ` (also ${aliasesOf(item.name).join(', ')})` : ''} | ${item.description} |`;
  const groups = (['Appearance', 'Composer & transcript', 'Providers', 'Tools & integration'] as const).map(group =>
    `### ${group}\n\n| Command | What it does |\n| --- | --- |\n${slashCommands.filter(item => item.group === group && !item.alias).map(row).join('\n')}`).join('\n\n');
  const commands = slashCommands.filter(item => !item.group && !item.alias).map(row).join('\n');
  return authoredMarkdown(`# NMSh help

## Commands

${groups}

### More commands

| Command | What it does |
| --- | --- |
${commands}

## Setup Cat and optional tools

NMSh is complete out of the box. No external shell tools are required. Optional providers and integrations can be added later, and you can switch between Native and external providers anytime from Settings or Setup Cat.

Run /setup (or /setup prompt, appearance, chroma, editor, tools) to revisit settings. Setup Cat starts from your current settings, changes nothing until you apply on its last step, and Esc discards the draft. /tools lists optional tools by tier (Recommended, Enhanced CLI); every install or upgrade shows its exact command and asks first. Optional tool update checks are Off unless you choose Daily or Weekly.

When a submitted command is missing in your zsh and exactly names a curated tool, NMSh may offer to install it; aliases, functions, builtins and executables always win, and your command stays in the composer. The command inspector (palette: Toggle command inspector) shows what a command word resolves to: builtin, alias, function or executable path.

## Appearance

Settings → Theme (and /setup appearance) picks a Built-in theme (NMSh themes and bundled families: Catppuccin with flavor and accent, Dracula, Tokyo Night, Gruvbox, Rosé Pine, Nord, Solarized, One Dark), an Imported theme or a Custom theme. Themes color NMSh-owned UI only; your terminal and editor keep their colors unless you opt a tool into Theme Bridge. /theme opens Theme Studio (Built-in · Imported · Custom · Import): set any theme active, duplicate a built-in, edit, rename, duplicate, export (NMSh Theme JSON) or delete library themes, and import a local file from NMSh Theme JSON, Base16, Base24, Windows Terminal, Oh My Posh (JSON, YAML, TOML), Kitty, Ghostty, iTerm2 (.itermcolors) or WezTerm TOML. Imports are parsed as data only (nothing is executed, sourced, templated, followed or fetched), previewed with their mapping and what was lost, and saved only when you confirm; once imported a theme is an ordinary Native theme that no longer needs the source app or file. Cursor shape and blink (/cursor), the prompt symbol and the optional status strip are in Settings. UI chrome (frames, rules, tabs, selection) follows the theme by default, or a Custom preset (Native Lavender, Grayscale, your colors). Chroma colors the Native prompt; Full Chroma is the default influence, and Semantic colors decides whether success, failure and Git state are recolored too. Shimmer (On by default) plays one soft sweep of light when you select or change something, submit, or confirm; Decorative effects Off or Reduced Motion turn it off. /motion (also /appearance → Motion) sets the general motion: context transitions, command launch, completion highlight, command completion and event feedback.

## Prompt None and history

/prompt → None keeps only the composer and its input marker: no prompt row, modules or right prompt. Editing, suggestions, syntax colors, history, themes and Theme Bridge keep working, and commands submitted under None store no prompt snapshot. /transcript → Historical prompt shows past prompts Full, Compact (place, branch, marker), Minimal (marker) or Off; stored snapshots are never changed.

## Context modules

/modules opens the module manager directly and saves each change as you make it; /prompt → Modules is the same manager inside the /prompt draft (A saves module changes at once, Enter in /prompt saves everything). It has three tabs, switched with Tab and Shift+Tab. Modules lists what is in use (Space shows or hides, Shift+arrows reorder, S picks a surface: Main Prompt, Right Context, Context Rail, Status Strip or Hidden). Catalog lists every module by category and what is recommended here, with the local evidence. Packs lists bundled and installed Context Packs. / searches labels, ids, categories and descriptions already loaded; Esc clears the search. Enter on a module shows what it reads, how fresh its facts are and whether its value may be kept in history. Under Starship, Powerlevel10k, Oh My Posh or Prompt None the Main Prompt, Right Context and Rail cannot show modules: the manager says so, keeps their settings, and Status Strip modules keep working. Modules read local files and allowlisted environment values only while visible; nothing in a project is executed and no cloud API is called.

## Status Strip

/strip (also /status-strip) is the Status Strip Studio. The strip is one live row at the Top or Bottom of the NMSh pane (inside tmux, Bottom sits above tmux's own status line; it is not a tmux status bar) with Left, Center and Right groups. Choose its style (Plain with a dot, bar or space separator, or Powerline), where the clock, CPU, RAM, battery, uptime and Keep Awake sit, and which of them show. Modules routed to the strip in /modules appear under Modules on the strip: ←→ moves one between groups, Shift+arrows reorder, X takes it off the strip. Presets (Minimal, Developer, System) show what they would change before Enter applies them; U undoes. When space runs out, compact forms come first, then lower priorities drop, the center before the edges. The strip is never saved to history, /copy or the transcript, and passthrough programs hide it.

Context Packs are data: \`nmsh packs inspect FILE\` shows what a pack would read and add, \`nmsh packs install FILE\` asks first (optionally pinned with --sha256), and installed modules start hidden. Claude Code can report its model, effort, context window and limits through its own status line: \`nmsh agent-status setup\` shows the one settings change and applies it on Yes; \`nmsh agent-status remove\` undoes exactly that.

Settings → Sessions → Terminal title (Off by default) lets NMSh set the window title to the project (and session) while it owns the screen; running programs keep their own titles.

## Theme Bridge

/theme-bridge (also /appearance, Settings and Setup) extends NMSh themes to terminal tools. It is Off by default: one switch plus Apply themes Manual, Follow NMSh or Choose theme. Under Manual each tool is Independent (NMSh injects and changes nothing for it), Follow NMSh or Choose theme (a pinned Built-in, Imported or Custom theme). fzf colors apply only to fzf launched by NMSh (FZF_DEFAULT_OPTS and rc files are untouched). less/man colors and File listing colors (GNU ls/gls through LS_COLORS, macOS/BSD ls through CLICOLOR and LSCOLORS) reach NMSh shells (zsh, Bash, Fish) at their next prompt through an NMSh-owned environment file; Independent restores what was there. tmux, Neovim, Vim, Helix and bat get NMSh-generated themes (bat after a reviewed cache build, selected with BAT_THEME in NMSh shells); loading them in new instances needs one include line (for Helix, a theme = "nmsh-bridge" assignment) that NMSh shows exactly and adds only after you confirm, and removes exactly. Running editors are not recolored live; tmux can reload on request. delta is never managed (NMSh does not change git config); its syntax highlighting follows bat's NMSh theme through BAT_THEME unless your git config pins delta's syntax-theme, and its status says which. Details: [Theme Bridge](https://github.com/raiseCatError/notMyShell/blob/dev/docs/design/theme-bridge.md).

Keep Awake (/caffeinate, also /awake and /zoomies) keeps the computer awake with the operating system's own mechanism: Apple caffeinate on macOS, the systemd inhibitor on Linux, the execution-state API on Windows. Modes are Idle, Display, System and All, optionally for a time (/zoomies display 2h, /caffeinate idle 30m); /caffeinate status shows it and /caffeinate stop ends it. It keeps running after the NMSh window closes, never changes power settings, and shows a mode as unavailable when the platform cannot honour it (Display on Linux). It runs as an NMSh-owned background process, never in your shell, so the composer comes straight back (typing caffeinate yourself stays an ordinary shell command). While it is active NMSh shows Awake · <mode> on a free composer edge (or a row next to the composer), in the Status Strip when the strip is on, and optionally on the screensaver; after 30 seconds without NMSh input it adds the time and a muted /zoomies stop. Placement, display, the idle reminder and the screensaver status are set in the Keep Awake panel. Off shows nothing.

Prompt providers (/prompt, /providers): NMSh Native, None, Starship, Powerlevel10k and Oh My Posh. NMSh keeps the editor, composer, transcript and history; an external provider supplies only the prompt content, and NMSh falls back to Native, saying so, when it cannot render. Starship and Oh My Posh are cross-shell prompt engines that NMSh runs directly, with no shell rc change; Powerlevel10k is a Zsh theme rendered in an isolated helper. In /tools, Oh My Zsh is a Zsh framework (not a command): its guided install keeps your .zshrc and NMSh never runs the installer itself; if you have .zshrc.pre-oh-my-zsh, NMSh can compare it with .zshrc and restore it after a backup and a confirmation, but never merges shell code. Oh My Zsh themes and plugins, ~/.p10k.zsh and Oh My Posh configs are inspect-only for dotfiles.

## Idle visuals

Optional and off by default (Never). /screensaver previews each mode live: Aurora Drift, Deep Space, Warp Starfield, Rain, Sparkles, Fireworks and Bouncing Vespyr. They run only inside NMSh at a quiet prompt; any key, mouse, focus return or new output ends them and leaves everything exactly as it was. Reduced Motion shows a still frame; Decorative effects Off keeps them off.

## Session presets

Use /presets (also in the palette) to create, inspect, launch and delete named startup configurations. N creates one with an explicit cwd and optional commands, one per line; Tab changes fields, Ctrl+J adds a command line, Enter saves. Never put secrets in saved commands; reference your existing environment tooling instead.

Enter inspects; L launches a NEW live session and keeps this one detached for /resume. First launch and changed commands/cwd require acknowledgement of the visible real cd and startup commands. PgUp/PgDn scroll the review. Decline runs nothing. Startup stops on a failed command; Ctrl+C cancels remaining commands. Launch also works with nmsh --preset <name>; nmsh --presets lists without executing. Presets require the live-session service and bypass automatic startup restoration.

## Command history

Use /history with plain text or combine cwd:, project:, exit:, before:, after:, session: and duration: filters. Quote filter values containing spaces. Example: /history cwd:/work exit:failure duration:>1s git

Enter or Tab restores the selected command without executing it. Ctrl+X removes the selected record from NMSh search. Session transcripts and the original zsh/Atuin history remain intact; deletion is remembered locally.

## Directory navigation

Use /dirs or the command palette to find recorded directories. Native ranks frequency and recency from approved command history. Select with arrows and Enter or Tab to insert a literal cd command, then press Enter separately to run it in zsh. Ordinary cd keeps its normal behavior.

Config offers optional zoxide ranking and optional fzf/Television pickers. zoxide reads a temporary copy of the existing database; hooks and the original database remain unchanged. Missing or failing tools use Native.

## Command correction

After an unambiguous simple command-not-found typo in zsh, Bash or Fish, NMSh may show a local executable correction (from the commands on your shell's PATH) below the composer. Tab places it in the editor; review and press Enter separately. Esc dismisses it. Complex expressions, ambiguous matches and destructive targets are suppressed. The suggestion is frontend UI and stays out of command output, copy and history.

## Tips

- A large multiline paste is **one editable atom**; Enter submits its original text. Press Ctrl+O beside it to inspect or unwrap.
- Portable Select-All is Alt+A.
- Shift+Tab focuses a past command; Enter opens its actions. **Open in pager** shows the command and its complete stored output in less (or your PAGER) and returns to NMSh when you quit; the text goes to the pager only on its stdin, never through the shell.
- VS Code Cmd+A keybinding JSON:

\`\`\`
{ "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }
\`\`\`
`);
}
