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
