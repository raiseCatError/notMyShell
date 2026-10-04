import type {CommandEnvironment} from './commands.js';
import type {AskContext, AskOption, AskOutcome, RecentCommand} from './types.js';

/**
 * "What did I just do?" from facts NMSh recorded about recent commands (text,
 * folder, branch, exit status, duration, line count), never their output.
 * A command is explained only from local command knowledge; otherwise Ask
 * says it has none rather than guessing from the name.
 */

const LAST = /\bwhat (?:did|have) i (?:just )?(?:do|done|run|ran)\b(?! (?:today|recently|lately))|\b(?:last|previous|latest) command\b|\bwhat was that(?: command)?\b|\bwhat i just ran\b|\bmy last command\b/u;
const RECENT = /\bwhat (?:have i been doing|did i do (?:today|recently|lately))\b|\brecent (?:work|commands|activity|history)\b|\bwhat have i (?:run|ran) (?:recently|lately|today)\b/u;

const home = (path: string | undefined, context: AskContext) => path && path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path ?? context.cwd;
function duration(ms?: number): string {
  if (ms === undefined) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 1 ? '' : seconds < 60 ? ` after ${seconds}s` : ` after ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
const status = (item: RecentCommand) => item.exitCode === 0 ? 'It exited successfully' : item.exitCode >= 128 ? `It was interrupted or killed (exit ${item.exitCode})` : `It failed with exit status ${item.exitCode}`;

/** The command's words up to the first option or argument-looking word. */
const pathWords = (command: string) => command.trim().split(/\s+/u).filter(word => /^[\w.+-]+$/u.test(word)).slice(0, 3);

export function resolveActivity(text: string, context: AskContext, commands?: CommandEnvironment): AskOutcome | undefined {
  const recent = context.recent ?? [];
  if (RECENT.test(text)) {
    if (!recent.length) return {kind: 'answer', capability: 'help.command', text: 'No commands have finished in this session yet.'};
    const rows = recent.slice(0, 6).map(item => `  ${item.exitCode === 0 ? '✓' : '✗'} ${item.command.slice(0, 60)}   ${home(item.cwd, context)}${item.branch ? ` · ${item.branch}` : ''}${item.exitCode ? ` · exit ${item.exitCode}` : ''}`);
    return {kind: 'answer', capability: 'help.command', text: `Recent work (newest first)\n${rows.join('\n')}`,
      next: [{key: 'activity:last', label: 'Explain the last command', refine: 'what did i just do'}]};
  }
  if (!LAST.test(text)) return undefined;
  const last = recent[0];
  if (!last) return {kind: 'answer', capability: 'help.command', text: 'No command has finished in this session yet.'};
  const where = `in ${home(last.cwd, context)}${last.branch ? ` on branch ${last.branch}` : ''}`;
  const lines = [`You ran:\n  ${last.command}\n${where}. ${status(last)}${duration(last.durationMs)}${last.lines ? ` (${last.lines} output line${last.lines === 1 ? '' : 's'})` : ''}.`];
  const words = pathWords(last.command);
  const found = words.length ? commands?.reference.lookup(words) : undefined;
  const next: AskOption[] = [];
  if (found?.facts.description) {
    const path = found.facts.path.join(' ');
    lines.push('', `${path}: ${found.facts.description}`);
    next.push({key: `syntax:${path}`, label: 'Explain syntax', refine: `how do i use ${path}`});
    if (found.facts.options.length) next.push({key: `options:${path}`, label: 'Show useful options', refine: `what flags does ${path} have`});
  } else lines.push('', 'NMSh does not have enough local command knowledge to explain what it does.');
  return {kind: 'answer', capability: 'help.command', text: lines.join('\n'), next,
    block: {argv: [last.command], literal: last.command, provenance: 'context', risk: 'informational'},
    referents: {command: found?.facts.path ?? words}};
}
