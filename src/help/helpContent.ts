import {slashCommands} from '../commands/slashCommands.js';
import {authoredMarkdown, type AuthoredMarkdown} from './markdown.js';

/** The /help page. Every input is NMSh source (command table, fixed guidance); nothing comes from the shell. */
export function helpMarkdown(): AuthoredMarkdown {
  const commands = slashCommands.map(item => `| \`${item.name}\` | ${item.description} |`).join('\n');
  return authoredMarkdown(`# NMSh help

## Commands

| Command | What it does |
| --- | --- |
${commands}

## Setup Cat and optional tools

NMSh is complete out of the box. No external shell tools are required. Optional providers and integrations can be added later, and you can switch between Native and external providers anytime from Settings or Setup Cat.

Run /setup (or /setup prompt, appearance, chroma, editor, tools) to revisit settings. Setup Cat starts from your current settings, changes nothing until you apply on its last step, and Esc discards the draft. /tools lists optional tools by tier (Recommended, Enhanced CLI); every install or upgrade shows its exact command and asks first. Optional tool update checks are Off unless you choose Daily or Weekly.

When a submitted command is missing in your zsh and exactly names a curated tool, NMSh may offer to install it; aliases, functions, builtins and executables always win, and your command stays in the composer. The command inspector (palette: Toggle command inspector) shows what a command word resolves to: builtin, alias, function or executable path.

## Appearance

Settings → Theme family picks NMSh themes or bundled families (Catppuccin with flavor and accent, Dracula, Tokyo Night, Gruvbox, Rosé Pine, Nord, Solarized, One Dark). Themes color NMSh-owned UI only; your terminal and editor keep their colors. /theme opens Theme Studio to clone, edit, import (NMSh Theme JSON, Base16, Windows Terminal schemes) and export a custom theme. Cursor shape and blink (/cursor), the prompt symbol and the optional status strip are in Settings. UI chrome (frames, rules, tabs, selection) follows the theme by default, or a Custom preset (Native Lavender, Grayscale, your colors). Chroma colors the Native prompt; Full Chroma is the default influence, and Semantic colors decides whether success, failure and Git state are recolored too. Shimmer (On by default) plays one soft sweep of light when you select or change something, submit, or confirm; Decorative effects Off or Reduced Motion turn it off.

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

After an unambiguous simple command-not-found typo, NMSh may show a local executable correction below the composer. Tab places it in the editor; review and press Enter separately. Esc dismisses it. Complex expressions, ambiguous matches and destructive targets are suppressed. The suggestion is frontend UI and stays out of command output, copy and history.

## Tips

- A large multiline paste is **one editable atom**; Enter submits its original text. Press Ctrl+O beside it to inspect or unwrap.
- Portable Select-All is Alt+A.
- VS Code Cmd+A keybinding JSON:

\`\`\`
{ "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }
\`\`\`
`);
}
