import {Highlighter} from '../input/Highlighter.js';
import {graphemes} from '../input/inputLayout.js';
import {completionLabel, type CompletionCandidate, type CompletionKind} from './completion.js';

export interface CommandKnowledge {
  value: string;
  kind: CompletionKind;
  description: string;
  usage?: string;
}

/** Explicit local facts, shared by completion and inspection. No executable adapters. */
const COMMANDS: Record<string, {description: string; usage: string; words: CommandKnowledge[]}> = {
  git: {description: 'Distributed version control', usage: 'git <subcommand> [options]', words: [
    {value: 'status', kind: 'subcommand', description: 'Show working tree and index status'},
    {value: 'diff', kind: 'subcommand', description: 'Show changes between commits, index and working tree'},
    {value: 'log', kind: 'subcommand', description: 'Show commit history'},
    {value: 'add', kind: 'subcommand', description: 'Stage file content for the next commit'},
    {value: 'commit', kind: 'subcommand', description: 'Record staged changes'},
  ]},
  rg: {description: 'Search files for a pattern', usage: 'rg [options] <pattern> [path ...]', words: [
    {value: '--hidden', kind: 'option', description: 'Search hidden files and directories'},
    {value: '--glob', kind: 'option', description: 'Include or exclude paths matching a glob', usage: '<glob>'},
    {value: '--ignore-case', kind: 'option', description: 'Search case insensitively'},
    {value: '--files', kind: 'option', description: 'List files that would be searched'},
    {value: '--line-number', kind: 'option', description: 'Show line numbers'},
  ]},
  npm: {description: 'Node package manager', usage: 'npm <subcommand> [options]', words: [
    {value: 'run', kind: 'subcommand', description: 'Run a script from package.json', usage: '<script>'},
    {value: 'test', kind: 'subcommand', description: 'Run the package test script'},
    {value: 'install', kind: 'subcommand', description: 'Install package dependencies'},
    {value: 'ci', kind: 'subcommand', description: 'Install dependencies from the lockfile'},
  ]},
};

export function localKnowledge(command: string, word: string, commandPosition = false): CommandKnowledge | undefined {
  const entry = COMMANDS[command];
  if (commandPosition && entry) return {value: command, kind: 'command', description: entry.description, usage: entry.usage};
  return entry?.words.find(item => item.value === word);
}

/** Enrich only uncomplicated first-argument contexts; keep source insertion and bounds intact. */
export function enrichCompletion(candidate: CompletionCandidate): CompletionCandidate {
  const prefix = candidate.context.buffer.slice(0, candidate.replacement.start).trim();
  const fact = candidate.kind === 'command' ? localKnowledge(candidate.value, candidate.value, true)
    : /^[\w-]+$/u.test(prefix) ? localKnowledge(prefix, candidate.value) : undefined;
  return fact ? {...candidate, kind: fact.kind, description: candidate.description || fact.description} : candidate;
}

export interface InspectorContext extends CommandKnowledge {
  start: number;
  end: number;
  command: string;
  source: string;
}

/** Grapheme cursor, like CommandEditor. Highlighter owns lexical boundaries; no shell evaluation. */
export function inspectCommand(buffer: string, cursor: number, cwd: string,
  candidates: readonly CompletionCandidate[] = []): InspectorContext | undefined {
  const chars = graphemes(buffer);
  const at = Math.max(0, Math.min(chars.length, cursor));
  const tokens = new Highlighter().tokenize(chars, new Map());
  const token = tokens.find(item => item.start <= at && at < item.end)
    ?? tokens.find(item => item.end === at && item.type !== 'Normal');
  if (!token || ['Normal', 'Comment', 'Operator'].includes(token.type)) return undefined;
  const before = tokens.filter(item => item.start <= token.start);
  // Restrict knowledge to simple commands. Substitutions, redirects and wrappers are context-only.
  let boundary = -1;
  before.forEach((item, index) => {
    if (item.type === 'Operator' && ['|', '||', '&&', '&', ';', ';;', '(', ')'].includes(item.text)
      || item.type === 'Normal' && item.text.includes('\n')) boundary = index;
  });
  const segment = before.slice(boundary + 1);
  const words = segment.filter(item => !['Normal', 'Operator', 'Comment'].includes(item.type));
  // Styling roles do not encode command position for quoted/path words.
  // The first word after assignments is still a command, even without facts.
  const commandToken = words.find(item => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(item.text));
  const command = commandToken?.text ?? '';
  const start = chars.slice(0, token.start).join('').length;
  const end = chars.slice(0, token.end).join('').length;
  const commandPosition = token === commandToken;
  const word = token.text;
  const candidate = candidates.find(item => item.context.buffer === buffer && item.context.cwd === cwd
    && item.replacement.start === start && item.replacement.end === end && item.value === word);
  const simple = words[0] === commandToken && !segment.some(item => item.type === 'Operator')
    && !/[\\'"$`]/u.test(word) && !/[\\'"$`]/u.test(command);
  const optionsEnded = words.slice(0, -1).some(item => item.text === '--');
  const known = simple && !optionsEnded ? localKnowledge(command, word, commandPosition) : undefined;
  const fact = known?.kind === 'subcommand' && words.length !== 2 ? undefined : known;
  const kind: CompletionKind = commandPosition ? 'command' : token.type === 'Flag' && !optionsEnded ? 'option' : 'argument';
  return {value: completionLabel(word), kind: candidate?.kind ?? fact?.kind ?? kind,
    description: completionLabel(candidate?.description || fact?.description || 'No local description available'),
    usage: fact?.usage, start, end, command, source: candidate?.description ? candidate.source : fact ? 'local' : 'context'};
}
