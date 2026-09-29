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

## Tips

- A large multiline paste is **one editable atom**; Enter submits its original text. Press Ctrl+O beside it to inspect or unwrap.
- Portable Select-All is Alt+A.
- VS Code Cmd+A keybinding JSON:

\`\`\`
{ "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }
\`\`\`
`);
}
