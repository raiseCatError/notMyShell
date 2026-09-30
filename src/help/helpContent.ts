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

## Tips

- A large multiline paste is **one editable atom**; Enter submits its original text. Press Ctrl+O beside it to inspect or unwrap.
- Portable Select-All is Alt+A.
- VS Code Cmd+A keybinding JSON:

\`\`\`
{ "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }
\`\`\`
`);
}
