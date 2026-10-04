import {PACKAGE_NAME, type PackageInfo} from '../packages/homebrew.js';
import type {AskContext, AskOption, AskOutcome} from './types.js';

/**
 * Homebrew questions and typed package actions for Ask, answered from facts
 * the app gathered for this request (Homebrew's JSON and lists, the
 * executable's identity). Installs, upgrades and uninstalls are proposals
 * whose exact command is shown and which run only after the final Yes.
 */

export interface BrewFacts {
  available: boolean;
  installed?: {formulae: string[]; casks: string[]};
  outdated?: Array<{name: string; installed: string; current: string; kind: 'formula' | 'cask'}>;
  info?: Record<string, PackageInfo[]>;
  search?: Record<string, {formulae: string[]; casks: string[]}>;
  uses?: Record<string, string[]>;
  prefix?: Record<string, string | undefined>;
  /** What PATH has for a name and who owns it (Homebrew only from Cellar evidence). */
  identity?: Record<string, {path?: string; owner: 'homebrew' | 'unknown'}>;
}

export type PackageIntent =
  | {kind: 'outdated'} | {kind: 'list'}
  | {kind: 'installed' | 'info' | 'deps' | 'uses' | 'where' | 'install' | 'upgrade' | 'uninstall'; name: string}
  | {kind: 'search'; query: string};

const NAME = '([a-z0-9][\\w@.+-]{0,63})';
const STOP = new Set(['it', 'this', 'that', 'the', 'a', 'an', 'brew', 'homebrew', 'package', 'packages', 'something', 'stuff', 'them', 'all', 'everything', 'updates', 'nmsh', 'with', 'using', 'via']);
const SHELLS = new Set(['zsh', 'fish', 'bash']);

/** Which package question this is, if any (Homebrew words or package verbs). */
export function packageIntent(text: string): PackageIntent | undefined {
  const name = (match: RegExpExecArray | null) => match?.slice(1).find(Boolean);
  const valid = (value: string | undefined) => value && !STOP.has(value) && PACKAGE_NAME.test(value) ? value : undefined;
  const brewish = /\b(?:brew|homebrew|formulae?|casks?|packages?)\b/u.test(text);
  if (/\boutdated\b/u.test(text) || (brewish && /\b(?:updates?|updating|upgrades?|upgrading|need(?:s|ing)? (?:an? )?(?:update|upgrade))\b/u.test(text) && /\b(?:what|which|any|show|list|check)\b/u.test(text) && !/\bupgrade [a-z0-9]/u.test(text))) return {kind: 'outdated'};
  if (/\bwhat did (?:brew|homebrew) install\b|\bbrew (?:list|leaves)\b/u.test(text) || (brewish && /\b(?:show|list|what)\b.*\binstalled\b/u.test(text) && !/\bis \S+ installed\b/u.test(text))) return {kind: 'list'};
  const uses = valid(name(new RegExp(`\\bwhat (?:depends|relies) on ${NAME}`, 'u').exec(text)));
  if (uses) return {kind: 'uses', name: uses};
  const deps = valid(name(new RegExp(`\\bwhat does ${NAME} depend on\\b|\\bdependencies (?:of|for) ${NAME}`, 'u').exec(text)));
  if (deps) return {kind: 'deps', name: deps};
  const where = valid(name(new RegExp(`\\bwhere is ${NAME} installed\\b|\\bbrew --prefix ${NAME}`, 'u').exec(text)));
  if (where) return {kind: 'where', name: where};
  const installed = valid(name(new RegExp(`\\bis ${NAME} installed\\b|\\bwhat version of ${NAME}\\b|\\bdo i have ${NAME}\\b|\\bwhich version of ${NAME}\\b`, 'u').exec(text)));
  if (installed) return {kind: 'installed', name: installed};
  const search = valid(name(new RegExp(`\\b(?:search|look) (?:brew|homebrew) for ${NAME}|\\bbrew search ${NAME}|\\b(?:search|find|look for) (?:a |the )?(?:brew |homebrew )?(?:package|formula|cask)(?: for| called| named)? ${NAME}`, 'u').exec(text)));
  if (search) return {kind: 'search', query: search};
  const info = valid(name(new RegExp(`\\bbrew info ${NAME}|\\b(?:info|information|details) (?:about|on|for) ${NAME}`, 'u').exec(text)));
  if (info) return {kind: 'info', name: info};
  const verb = new RegExp(`^(?:please |can you |could you )?(?:brew )?(install|upgrade|update|uninstall|remove)(?: the)? ${NAME}(?: (?:with|using|via) (?:brew|homebrew))?$`, 'u').exec(text);
  const target = valid(verb?.[2]);
  if (verb && target && !SHELLS.has(target)) {
    const action = verb[1] === 'update' ? 'upgrade' : verb[1] === 'remove' ? (brewish ? 'uninstall' : undefined) : verb[1] as 'install' | 'upgrade' | 'uninstall';
    if (action) return {kind: action, name: target};
  }
  return undefined;
}

/** What to fetch for an intent: bounded and request-specific. */
export function packageQueries(intent: PackageIntent): {installed: boolean; outdated: boolean; info: string[]; search: string[]; uses: string[]; prefix: string[]} {
  const name = 'name' in intent ? intent.name : undefined;
  return {
    installed: intent.kind !== 'search',
    outdated: intent.kind === 'outdated',
    info: name ? [name] : [],
    search: intent.kind === 'search' ? [intent.query] : intent.kind === 'install' && name ? [name] : [],
    uses: (intent.kind === 'uses' || intent.kind === 'uninstall') && name ? [name] : [],
    prefix: intent.kind === 'where' && name ? [name] : [],
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const isInstalled = (facts: BrewFacts, name: string) => Boolean(facts.installed?.formulae.includes(name) || facts.installed?.casks.includes(name));

function brewProposal(verb: 'install' | 'upgrade' | 'uninstall', item: Pick<PackageInfo, 'name' | 'kind' | 'description'>, effect: string): AskOutcome {
  const argv = ['brew', verb, ...(item.kind === 'cask' ? ['--cask'] : []), item.name];
  return {kind: 'proposal', capability: 'tools.open', safety: verb === 'install' ? 'install' : 'mutate', confidence: 0.95, command: argv.join(' '),
    text: `${effect}`, action: {kind: 'brew', argv, name: item.name, expect: verb === 'install' ? 'installed' : verb === 'upgrade' ? 'upgraded' : 'absent'}};
}

function describe(item: PackageInfo): string {
  const kind = item.kind === 'cask' ? 'Cask' : 'Formula';
  const state = item.installed.length ? `installed ${item.installed.join(', ')}${item.outdated && item.current ? ` (${item.current} available)` : ''}` : 'not installed';
  return `${item.name} · ${kind}${item.description ? ` — ${item.description}` : ''}\n${item.current ? `Current ${item.current} · ` : ''}${state}${item.homepage ? `\n${item.homepage}` : ''}`;
}

function nextFor(item: PackageInfo, facts: BrewFacts): AskOption[] {
  if (!item.installed.length) return [{key: `brew:install:${item.name}`, label: `Install ${item.name}`, outcome: brewProposal('install', item, `Install ${item.name}${item.description ? ` (${item.description})` : ''}?`)}];
  const next: AskOption[] = [];
  if (item.outdated || facts.outdated?.some(entry => entry.name === item.name)) next.push({key: `brew:upgrade:${item.name}`, label: `Upgrade ${item.name}`, outcome: brewProposal('upgrade', item, `Upgrade ${item.name}${item.current ? ` to ${item.current}` : ''}?`)});
  if (item.kind === 'formula') next.push({key: `cmd:${item.name}`, label: `Show ${item.name} syntax`, refine: `how do i use ${item.name}`});
  return next;
}

export function resolvePackage(text: string, context: AskContext): AskOutcome | undefined {
  const intent = packageIntent(text);
  if (!intent) return undefined;
  const facts = context.brew;
  if (!facts) return undefined;
  if (!facts.available) {
    // Installing a curated tool or a shell keeps its own paths; this is only for Homebrew-specific requests.
    return /\b(?:brew|homebrew|formulae?|casks?)\b/u.test(text) || intent.kind === 'outdated' || intent.kind === 'list'
      ? {kind: 'answer', capability: 'tools.open', text: 'Homebrew is not installed here, and NMSh does not guess other package managers.'} : undefined;
  }
  const info = (name: string) => facts.info?.[name] ?? [];
  switch (intent.kind) {
    case 'outdated': {
      const outdated = facts.outdated ?? [];
      if (!outdated.length) return {kind: 'answer', capability: 'tools.open', text: 'Everything Homebrew installed is up to date (as of Homebrew\'s last local index update).'};
      const width = Math.min(24, Math.max(...outdated.map(item => item.name.length)));
      return {kind: 'answer', capability: 'tools.open', text: `${plural(outdated.length, 'Homebrew package')} ${outdated.length === 1 ? 'has' : 'have'} an update available:\n${outdated.slice(0, 30).map(item => `  ${item.name.padEnd(width)}  ${item.installed} → ${item.current}${item.kind === 'cask' ? '  (cask)' : ''}`).join('\n')}`,
        next: outdated.slice(0, 4).map(item => ({key: `brew:upgrade:${item.name}`, label: `Upgrade ${item.name}`, outcome: brewProposal('upgrade', {name: item.name, kind: item.kind}, `Upgrade ${item.name} from ${item.installed} to ${item.current}?`)}))};
    }
    case 'list': {
      const formulae = facts.installed?.formulae ?? [];
      const casks = facts.installed?.casks ?? [];
      const show = (names: string[]) => names.slice(0, 40).join(', ') + (names.length > 40 ? `, … (${names.length - 40} more)` : '');
      return {kind: 'answer', capability: 'tools.open', text: `Homebrew has ${plural(formulae.length, 'formula')} and ${plural(casks.length, 'cask')} installed.${formulae.length ? `\n\nFormulae\n  ${show(formulae)}` : ''}${casks.length ? `\n\nCasks\n  ${show(casks)}` : ''}`,
        next: [{key: 'brew:outdated', label: 'What is outdated?', refine: 'what is outdated in brew'}]};
    }
    case 'installed': case 'info': {
      const items = info(intent.name);
      const identity = facts.identity?.[intent.name];
      if (!items.length) {
        const onPath = identity?.path ? `${intent.name} is on PATH at ${identity.path}, ${identity.owner === 'homebrew' ? 'inside Homebrew\'s Cellar' : 'not installed by Homebrew'}.` : `Homebrew has no package named ${intent.name}.`;
        return {kind: 'answer', capability: 'tools.open', text: onPath, ...(identity?.path ? {} : {next: [{key: `brew:search:${intent.name}`, label: `Search Homebrew for ${intent.name}`, refine: `search brew for ${intent.name}`}]})};
      }
      const lines = items.map(describe);
      if (identity?.path && identity.owner !== 'homebrew' && !isInstalled(facts, intent.name)) lines.push(`The ${intent.name} on PATH (${identity.path}) was not installed by Homebrew.`);
      return {kind: 'answer', capability: 'tools.open', text: lines.join('\n\n'), next: items.length === 1 ? nextFor(items[0]!, facts) : []};
    }
    case 'deps': {
      const item = info(intent.name)[0];
      if (!item) return {kind: 'answer', capability: 'tools.open', text: `Homebrew has no package named ${intent.name}.`};
      return {kind: 'answer', capability: 'tools.open', text: item.dependencies.length ? `${item.name} depends on: ${item.dependencies.join(', ')}.` : `${item.name} has no Homebrew dependencies.`};
    }
    case 'uses': {
      const uses = facts.uses?.[intent.name] ?? [];
      return {kind: 'answer', capability: 'tools.open', text: uses.length ? `Installed packages that depend on ${intent.name}: ${uses.join(', ')}.` : `No installed Homebrew package depends on ${intent.name}.`};
    }
    case 'where': {
      const prefix = facts.prefix?.[intent.name];
      const identity = facts.identity?.[intent.name];
      return {kind: 'answer', capability: 'tools.open', text: [isInstalled(facts, intent.name) && prefix ? `Homebrew's ${intent.name} lives in ${prefix}.` : `${intent.name} is not installed with Homebrew.`,
        identity?.path ? `On PATH: ${identity.path}${identity.owner === 'homebrew' ? ' (Homebrew)' : ' (not from Homebrew)'}.` : ''].filter(Boolean).join(' ')};
    }
    case 'search': {
      const found = facts.search?.[intent.query] ?? {formulae: [], casks: []};
      const options: AskOption[] = [...found.formulae.map(name => ({key: `brew:f:${name}`, label: `${name}`, detail: 'Formula', refine: `brew info ${name}`})),
        ...found.casks.map(name => ({key: `brew:c:${name}`, label: `${name}`, detail: 'Cask', refine: `brew info ${name}`}))].slice(0, 8);
      if (!options.length) return {kind: 'answer', capability: 'tools.open', text: `Homebrew found nothing for "${intent.query}".`};
      return {kind: 'choose', reason: 'missing', capability: 'tools.open', question: `Homebrew found ${plural(found.formulae.length, 'formula')} and ${plural(found.casks.length, 'cask')} for "${intent.query}". Which one?`, options};
    }
    case 'install': {
      const items = info(intent.name);
      const installedItem = items.find(item => item.installed.length);
      if (installedItem) return {kind: 'answer', capability: 'tools.open', text: `${intent.name} ${installedItem.installed.join(', ')} is already installed with Homebrew.`, next: nextFor(installedItem, facts)};
      const identity = facts.identity?.[intent.name];
      if (identity?.path) return {kind: 'answer', capability: 'tools.open', text: `${intent.name} is already on PATH at ${identity.path}${identity.owner === 'homebrew' ? '' : ' (not from Homebrew)'}, so I won't install a second copy.`};
      if (items.length > 1) {
        return {kind: 'choose', reason: 'ambiguous', capability: 'tools.open', question: `${intent.name} exists as both a formula and a cask. Which one?`,
          options: items.map(item => ({key: `brew:${item.kind}:${item.name}`, label: `${item.kind === 'cask' ? 'Cask' : 'Formula'} · ${item.description ?? item.name}`,
            outcome: brewProposal('install', item, `Install the ${item.kind} ${item.name}?`)}))};
      }
      if (items.length === 1) {
        const item = items[0]!;
        return brewProposal('install', item, `${item.name} isn't installed. Homebrew has the ${item.kind} ${item.name}${item.description ? ` — ${item.description}` : ''}. Install it?`);
      }
      const found = facts.search?.[intent.name];
      const options = [...(found?.formulae ?? []).map(name => ({key: `brew:f:${name}`, label: name, detail: 'Formula', refine: `install ${name}`})),
        ...(found?.casks ?? []).map(name => ({key: `brew:c:${name}`, label: name, detail: 'Cask', refine: `brew info ${name}`}))].slice(0, 6);
      return options.length ? {kind: 'choose', reason: 'ambiguous', capability: 'tools.open', question: `Homebrew has no package named exactly ${intent.name}. Did you mean:`, options}
        : {kind: 'answer', capability: 'tools.open', text: `Homebrew has no package named ${intent.name}.`};
    }
    case 'upgrade': case 'uninstall': {
      const item = info(intent.name).find(entry => entry.installed.length) ;
      if (!item || !isInstalled(facts, intent.name)) {
        const identity = facts.identity?.[intent.name];
        return {kind: 'answer', capability: 'tools.open', text: identity?.path && identity.owner !== 'homebrew'
          ? `${intent.name} at ${identity.path} wasn't installed by Homebrew, so NMSh can't safely ${intent.kind} it through Homebrew. Use whatever installed it.`
          : `${intent.name} isn't installed with Homebrew.`};
      }
      if (intent.kind === 'upgrade') {
        const outdated = item.outdated || facts.outdated?.some(entry => entry.name === item.name);
        return outdated ? brewProposal('upgrade', item, `Upgrade ${item.name} ${item.installed.at(-1)} to ${item.current ?? 'the latest'}?`)
          : {kind: 'answer', capability: 'tools.open', text: `${item.name} ${item.installed.at(-1)} is already the newest version Homebrew knows about.`};
      }
      const dependents = facts.uses?.[intent.name] ?? [];
      return brewProposal('uninstall', item, `Uninstall ${item.name} ${item.installed.at(-1)}?${dependents.length ? ` These installed packages depend on it: ${dependents.join(', ')}.` : ''}`);
    }
  }
}
