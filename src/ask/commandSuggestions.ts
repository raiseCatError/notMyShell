import {analyzePaste, commandWords} from '../input/pasteGuard.js';
import {repeatRisk} from '../tasks/repeatSafety.js';
import type {CommandSuggestion} from '../understanding/tasks.js';
import type {ActionRisk, CommandBlock} from './types.js';

/**
 * What NMSh itself says about a suggested command (#432), from the classifier paste review uses. The model's own
 * wording never sets it: a command that deletes, needs administrator rights, signals processes or pipes into an
 * interpreter is destructive; installs are installs; anything that writes, reaches the network, runs project scripts
 * or is unknown changes things. "Reads only" is the one verdict a person may relax for, so it needs every part to be
 * plainly read-only: no substitution (`$(…)`, backticks, `<(…)`), no wrapper that runs another command (env, xargs,
 * nice…), no find action, and nothing the stricter /track gate (repeatRisk) would question, such as `git -c` or an
 * option that writes a file. Otherwise it changes things.
 */
export function suggestionRisk(command: string): ActionRisk {
  const parts = analyzePaste(command).commands;
  const kinds = parts.flatMap(item => item.kinds);
  if (kinds.some(kind => kind === 'destructive' || kind === 'privilege' || kind === 'pipeline')) return 'destructive';
  if (kinds.includes('install')) return 'install';
  const plain = parts.length > 0 && !SUBSTITUTION.test(command)
    && parts.every(item => !WRAPPERS.has(firstWord(item.text)) && !FIND_ACTION.test(item.text) && !repeatRisk(item.text, item.kinds));
  if (plain && kinds.every(kind => kind === 'navigation')) return 'navigate';
  if (plain && kinds.every(kind => kind === 'read' || kind === 'navigation')) return 'read';
  return 'mutate';
}

const SUBSTITUTION = /\$\(|`|<\(|>\(/u;
/** Commands whose job is to run another command. */
const WRAPPERS = new Set(['env', 'xargs', 'nice', 'nohup', 'timeout', 'command', 'exec', 'builtin', 'eval', 'time', 'watch', 'stdbuf', 'unbuffer', 'parallel', 'script', 'caffeinate', 'flock', 'chroot', 'su']);
/** find options that run a command or delete what they find. */
const FIND_ACTION = /(?:^|\s)-(?:exec|execdir|ok|okdir|delete|fprint|fprintf|fls)\b/u;
const firstWord = (text: string) => (commandWords(text).find(word => !/^[A-Za-z_]\w*=/u.test(word)) ?? '').split('/').pop() ?? '';

/**
 * A suggestion as an Ask command block: shown verbatim (`literal`), so Ask offers Copy and Insert only, never Run;
 * Insert puts it in the composer unsent and only the person's Enter runs it. The note says where it came from.
 */
export function suggestionBlock(suggestion: CommandSuggestion, modelLabel: string): CommandBlock {
  const risk = suggestionRisk(suggestion.command);
  // NMSh's verdict first; the model's own words after it, quoted and attributed, so they cannot pose as NMSh's.
  return {argv: [], literal: suggestion.command, provenance: 'suggested', risk,
    note: `NMSh's check: ${RISK_WORDS[risk]}. Your local model (${modelLabel}) says: “${suggestion.explanation}” Check it before you run it.`};
}

const RISK_WORDS: Record<ActionRisk, string> = {informational: 'shows information', read: 'reads only', navigate: 'changes directory',
  configure: 'changes settings', mutate: 'changes things', destructive: 'destructive', install: 'installs software'};
