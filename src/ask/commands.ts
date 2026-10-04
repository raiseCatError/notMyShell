import {optionLabel, syntaxOf, type CommandFacts, type CommandReference} from '../shell/CommandReference.js';
import {matchConcepts} from './concepts.js';
import type {AskContext, AskOutcome, CommandBlock} from './types.js';

/**
 * Command questions answered from local command knowledge (the completion
 * catalog, custom specs and NMSh's own facts) and the factual installed
 * state. Explaining a command is knowledge, not action: these are answers
 * only, so even `git clean` or `git push` can be explained. Nothing is
 * guessed from a name; a command NMSh has no facts for is said to be unknown.
 */

export type CommandQuestion =
  | {intent: 'explain' | 'syntax' | 'options'; words: string[]}
  | {intent: 'option'; words: string[]; option: string};

/** Tools NMSh integrates as providers: asking about them means the tool itself, with NMSh's note added. */
const PROVIDER_TOOLS = new Set(['zoxide', 'fzf', 'tv', 'television', 'atuin', 'starship', 'fastfetch', 'neofetch', 'deja', 'llama-server', 'ollama']);

const LEAD = /^(?:please |so |ok |hey )?(?:what(?: is| are|'s| does| do)|whats|explain|tell me about|describe|how (?:do|can|would|should) i|how to|how does|show me|give me|syntax (?:of|for)|usage (?:of|for)|options (?:of|for)|flags (?:of|for))\b\s*/u;
const TRAIL = /\s+(?:do|does|mean|means|command|commands|have|has|syntax|usage|flags|options|work|works|for|again)$/u;
const FILLER = new Set(['the', 'a', 'an', 'use', 'using', 'command', 'cli', 'tool', 'program', 'this', 'my']);

/** Parse a normalized request into a command question, or undefined. Pure: whether the command is known is checked by the caller. */
export function parseCommandQuestion(text: string): CommandQuestion | undefined {
  const lead = LEAD.exec(text);
  const syntaxWords = /\b(?:syntax|usage)\b/u.test(text);
  const optionWords = /\b(?:flags|options|switches)\b/u.test(text);
  if (!lead && !syntaxWords && !optionWords) return undefined;
  let rest = lead ? text.slice(lead[0].length) : text.replace(/^(?:what|which) (?=(?:flags|options|switches)\b)/u, '');
  rest = rest.replace(/^(?:flags|options|switches) (?:does|do|can|for|of) /u, '');
  rest = rest.replace(/^(?:the )?(?:syntax|usage|flags|options) (?:of|for) /u, '');
  for (let previous = ''; previous !== rest;) { previous = rest; rest = rest.replace(TRAIL, ''); }
  const optionMatch = /(?:^|\s)(--?[a-z0-9][\w-]*(?:=\S*)?)(?=\s|$)/u.exec(rest);
  const words = rest.replace(/(?:^|\s)--?[a-z0-9][\w-]*(?:=\S*)?(?=\s|$)/gu, ' ').split(/\s+/u).filter(word => word && !FILLER.has(word) && /^[\w.+-]+$/u.test(word));
  if (optionMatch) return {intent: 'option', words, option: optionMatch[1]!};
  if (!words.length) return undefined;
  const howTo = /^how (?:do|can|would|should) i|^how to/u.test(lead?.[0] ?? '');
  return {intent: optionWords ? 'options' : syntaxWords || howTo ? 'syntax' : 'explain', words};
}

export interface CommandEnvironment {
  reference: CommandReference;
  /** The command's identity in this shell, when NMSh can tell (PATH lookup and the live shell's names); never runs it. */
  identity(name: string): {kind: 'executable' | 'alias' | 'function' | 'builtin'; path?: string} | undefined;
}

/** Roots to search for a bare option ("what does --force-with-lease do"): this conversation's command, recent commands, then a few common tools. */
function optionSearchPaths(context: AskContext): string[][] {
  const paths = [context.referents?.command, ...context.recentCommands.map(command => command.split(/\s+/u).filter(word => /^[\w.+-]+$/u.test(word)).slice(0, 2))]
    .filter((path): path is string[] => Boolean(path?.length));
  const seen = new Set<string>();
  return [...paths, ...['git', 'docker', 'npm', 'kubectl', 'cargo', 'rg'].map(root => [root])].filter(path => !seen.has(path.join(' ')) && seen.add(path.join(' '))).slice(0, 10);
}

/** Bounded: subcommands scanned for a bare option across the search roots (inline subcommands cost no extra catalog reads). */
const MAX_OPTION_SCAN = 200;

function installedLine(name: string, env: CommandEnvironment): string {
  const identity = env.identity(name);
  if (!identity) return `${name} is not installed here (not found in this shell).`;
  return identity.kind === 'executable' ? `${name} is installed${identity.path ? ` at ${identity.path}` : ''}.` : `${name} is a ${identity.kind} in this shell.`;
}

/** Useful options: those with descriptions, own before inherited, at most `limit`. */
function usefulOptions(facts: CommandFacts, limit = 6): string[] {
  const described = facts.options.filter(item => item.description);
  const width = Math.min(28, Math.max(...described.slice(0, limit).map(item => optionLabel(item).length), 0));
  const brief = (text: string) => text.length > 96 ? `${text.slice(0, 95).replace(/\s+\S*$/u, '')}…` : text;
  return described.slice(0, limit).map(item => `  ${optionLabel(item).padEnd(width)}  ${brief(item.description!)}`);
}

/**
 * Answer a command question from facts, or undefined when the words don't
 * name a command NMSh knows or this shell has (the caller keeps resolving).
 */
export function answerCommandQuestion(question: CommandQuestion, context: AskContext, env: CommandEnvironment): AskOutcome | undefined {
  if (question.intent === 'option') {
    const paths = question.words.length ? [question.words] : optionSearchPaths(context);
    let scanned = 0;
    for (const words of paths) {
      const found = env.reference.lookup(words);
      if (!found) continue;
      let facts = found.facts;
      let hit = env.reference.option(facts, question.option);
      // A bare option usually belongs to a subcommand (git push --force-with-lease): scan a bounded number of them.
      if (!hit && !question.words.length) {
        for (const child of facts.subcommands) {
          if (scanned++ >= MAX_OPTION_SCAN) break;
          const sub = env.reference.lookup([...facts.path, child.names[0]!]);
          const subHit = sub && env.reference.option(sub.facts, question.option);
          if (subHit && !subHit.persistent) { facts = sub.facts; hit = subHit; break; }
        }
      }
      if (hit) {
        return {kind: 'answer', capability: 'help.command', text: `${facts.path.join(' ')} ${optionLabel(hit)}\n${hit.description ?? 'No description is available for this option.'}`,
          block: commandBlock([...facts.path, question.option.split('=')[0]!], 'reference')};
      }
      if (question.words.length) return {kind: 'answer', capability: 'help.command', text: `${facts.path.join(' ')} has no ${question.option} option in NMSh's local command knowledge.`};
    }
    return {kind: 'answer', capability: 'help.command', text: `I don't know which command ${question.option} belongs to. Say the command too, e.g. "what does git push ${question.option} do".`};
  }
  const name = question.words[0]!;
  const concept = matchConcepts(question.words.join(' '));
  if ((concept.concepts.length || concept.ambiguous.length) && !PROVIDER_TOOLS.has(name)) return undefined;
  const found = env.reference.lookup(question.words);
  const identity = env.identity(name);
  if (!found) {
    if (!identity) return undefined;
    return {kind: 'answer', capability: 'help.command', text: `${installedLine(name, env)} NMSh has no local documentation for it, so I can't say what it does or its syntax.`};
  }
  const {facts, rest} = found;
  const path = facts.path.join(' ');
  const lines: string[] = [];
  const unknownTail = rest.length && facts.subcommands.length ? ` (${rest[0]} is not a ${facts.path.join(' ')} subcommand NMSh knows)` : '';
  lines.push(`${path}: ${facts.description ?? 'no description in NMSh\'s local command knowledge'}${unknownTail}.`.replace(/\.\.$/u, '.'));
  if (facts.path.length === 1 || question.intent !== 'explain') lines.push(installedLine(facts.path[0]!, env));
  const syntax = syntaxOf(facts);
  if (question.intent !== 'explain' || facts.path.length > 1) {
    if (syntax) lines.push('', 'Syntax', `  ${syntax}`);
    else lines.push('', 'NMSh does not have enough local syntax knowledge to show its usage.');
  }
  if (question.intent === 'options' || question.intent === 'syntax') {
    const options = usefulOptions(facts, question.intent === 'options' ? 12 : 6);
    if (options.length) lines.push('', question.intent === 'options' ? `Options (${facts.options.length})` : 'Useful options', ...options);
  }
  if (question.intent === 'explain' && facts.subcommands.length && facts.path.length === 1) {
    lines.push('', `Subcommands include ${facts.subcommands.slice(0, 8).map(item => item.names[0]).join(', ')}${facts.subcommands.length > 8 ? ', …' : ''}.`);
  }
  if (PROVIDER_TOOLS.has(name) && concept.concepts[0]) lines.push('', `In NMSh: ${concept.concepts[0].description}`);
  return {kind: 'answer', capability: 'help.command', text: lines.join('\n'), ...(syntax && question.intent !== 'explain' ? {block: commandBlock(facts.path, 'reference')} : {})};
}

/** A command block for the path only (a reference, not filled from context). */
function commandBlock(argv: string[], provenance: CommandBlock['provenance']): CommandBlock {
  return {argv, provenance, risk: 'informational'};
}
