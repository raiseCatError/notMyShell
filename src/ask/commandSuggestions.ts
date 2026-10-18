import {analyzePaste} from '../input/pasteGuard.js';
import type {CommandSuggestion} from '../understanding/tasks.js';
import type {ActionRisk, CommandBlock} from './types.js';

/**
 * What NMSh itself says about a suggested command (#432), from the classifier paste review uses. The model's own
 * wording never sets it: a command that deletes, needs administrator rights, signals processes or pipes into an
 * interpreter is destructive; installs are installs; anything that writes, reaches the network, runs project scripts
 * or is unknown changes things; only reading and moving between directories read.
 */
export function suggestionRisk(command: string): ActionRisk {
  const kinds = analyzePaste(command).commands.flatMap(item => item.kinds);
  if (kinds.some(kind => kind === 'destructive' || kind === 'privilege' || kind === 'pipeline')) return 'destructive';
  if (kinds.includes('install')) return 'install';
  if (kinds.length && kinds.every(kind => kind === 'navigation')) return 'navigate';
  if (kinds.length && kinds.every(kind => kind === 'read' || kind === 'navigation')) return 'read';
  return 'mutate';
}

/**
 * A suggestion as an Ask command block: shown verbatim (`literal`), so Ask offers Copy and Insert only, never Run;
 * Insert puts it in the composer unsent and only the person's Enter runs it. The note says where it came from.
 */
export function suggestionBlock(suggestion: CommandSuggestion, modelLabel: string): CommandBlock {
  const risk = suggestionRisk(suggestion.command);
  return {argv: [], literal: suggestion.command, provenance: 'suggested', risk,
    note: `${suggestion.explanation} · NMSh's check: ${RISK_WORDS[risk]} · Suggested by your local model (${modelLabel}); check it before you run it.`};
}

const RISK_WORDS: Record<ActionRisk, string> = {informational: 'shows information', read: 'reads only', navigate: 'changes directory',
  configure: 'changes settings', mutate: 'changes things', destructive: 'destructive', install: 'installs software'};
