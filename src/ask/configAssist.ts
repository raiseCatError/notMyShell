import {basename, extname, isAbsolute, join, resolve} from 'node:path';
import {displayConfigPath, type ConfigFormat, type ConfigTarget} from './configTargets.js';
import {flattenJson, inspectFile, parseJsonc, planAppend, planCreate, planJsonSet, planKeyValueSet, planReplace, renderEditCommand, type FileEditPlan, type FileFacts, type PlanResult} from './fileEdit.js';
import type {AskContext, AskOutcome, AskReferents, CommandBlock} from './types.js';

/**
 * Config files and verified edits for Ask, all deterministic:
 * resolve the file (request, conversation, domain, then asking) → inspect it →
 * build a verified plan → preview the diff → render a guarded command →
 * Run only after the final Yes. Opening is navigation. Removal is not offered.
 */

export interface FileAssistEnvironment {
  inspect(path: string): FileFacts;
  /** Roots NMSh may write in: home and the project. */
  roots: readonly string[];
  runtimes: {python3?: string; node: string};
}

type Target = ConfigTarget & {exists: boolean};
const VAGUE = /^(?:my|the|that|this|our|a|its|it)?\s*$/u;

function display(path: string, context: AskContext): string { return displayConfigPath(path, context.home); }

/** The phrase that names the config: "open my zed config" → "zed"; "add this to my config" → "". */
function configPhrase(text: string): string | undefined {
  const match = /\b(?:config(?:uration)?|settings|rc file|dotfile)\b/u.exec(text);
  if (!match) return undefined;
  const stop = new Set(['open', 'show', 'view', 'edit', 'find', 'where', 'is', 'my', 'the', 'that', 'this', 'our', 'to', 'in', 'into', 'add', 'put', 'set', 'me', 'a', 'it', 'change', 'update', 'of']);
  const words = text.slice(0, match.index).trim().split(/\s+/u).filter(Boolean);
  const named: string[] = [];
  for (let index = words.length - 1; index >= 0 && named.length < 2; index -= 1) { if (stop.has(words[index]!)) break; named.unshift(words[index]!); }
  return named.join(' ');
}

function formatOfPath(path: string): ConfigFormat | 'source' {
  const extension = extname(path).toLowerCase();
  if (extension === '.json') return /tsconfig|jsconfig|settings|keymap|devcontainer/u.test(basename(path)) ? 'jsonc' : 'json';
  if (extension === '.jsonc') return 'jsonc';
  if (extension === '.toml') return 'toml';
  if (/^\.(?:zshrc|bashrc|bash_profile|profile|zprofile)$/u.test(basename(path)) || extension === '.fish' || extension === '.sh') return 'shell';
  if (/\.(?:py|ts|tsx|js|jsx|mjs|go|rs|rb|java|c|h|cpp|swift|kt|lua)$/u.test(extension)) return 'source';
  return 'text';
}

/** An explicit existing path in the request (relative to the working folder), if any. */
function explicitPath(raw: string, context: AskContext, env: FileAssistEnvironment): string | undefined {
  for (const token of raw.split(/\s+/u)) {
    const word = token.replace(/^["'`(]+|["'`),:;.]+$/gu, '');
    if (!/[./]/u.test(word) || word.length < 3 || /^https?:/u.test(word)) continue;
    const path = word.startsWith('~/') ? join(context.home, word.slice(2)) : isAbsolute(word) ? word : resolve(context.cwd, word);
    if (env.inspect(path).content !== undefined || env.inspect(path).refusal !== 'does not exist') return path;
  }
  return undefined;
}

type Resolution = {kind: 'target'; target: Target} | {kind: 'path'; path: string} | {kind: 'choose'; candidates: Target[]} | {kind: 'none'; reason: string};

/**
 * Which config: an explicit path, a named target, the conversation's config,
 * a strong domain (shell words → the shell's config), recent files; otherwise
 * ask among the configs that actually exist (never everything NMSh knows).
 */
function resolveTarget(raw: string, text: string, context: AskContext, env: FileAssistEnvironment): Resolution {
  const path = explicitPath(raw, context, env);
  if (path) return {kind: 'path', path};
  const targets = context.configs ?? [];
  const phrase = configPhrase(text) ?? '';
  const named = (words: string) => {
    let best: Target[] = [];
    let length = 0;
    for (const target of targets) {
      for (const alias of target.aliases) {
        if (!new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:\\s|$)`, 'u').test(` ${words} `)) continue;
        if (alias.length > length) { best = [target]; length = alias.length; } else if (alias.length === length && !best.includes(target)) best.push(target);
      }
    }
    return best;
  };
  const byName = named(text.replace(/\bconfig(?:uration)?\b|\bsettings\b/gu, ' ').trim() || phrase);
  if (byName.length) {
    const present = byName.filter(target => target.exists);
    // "project config" with several project files, "git config" (user or repository): ask among the real ones.
    if (byName.length > 1) {
      const domain = (present.length ? present : byName).filter(target => target.domain?.test(text));
      if (domain.length === 1) return {kind: 'target', target: domain[0]!};
      const fromConversation = (present.length ? present : byName).find(target => target.id === context.referents?.config?.id);
      if (fromConversation) return {kind: 'target', target: fromConversation};
      return present.length === 1 ? {kind: 'target', target: present[0]!} : {kind: 'choose', candidates: present.length ? present : byName};
    }
    return {kind: 'target', target: byName[0]!};
  }
  if (!VAGUE.test(phrase) && phrase) return {kind: 'none', reason: `I don't know a "${phrase}" config here.`};
  // Vague ("my config"): the conversation first, then strong domain words, then a recent config file.
  const conversation = context.referents?.config && targets.find(target => target.id === context.referents!.config!.id);
  if (conversation) return {kind: 'target', target: conversation};
  if (context.referents?.file) return {kind: 'path', path: context.referents.file};
  const domain = targets.filter(target => target.exists && target.domain && target.scope !== 'nmsh' && target.domain.test(text));
  if (domain.length === 1) return {kind: 'target', target: domain[0]!};
  const recent = targets.filter(target => target.exists && context.recentFiles.some(file => file === target.path));
  if (recent.length === 1) return {kind: 'target', target: recent[0]!};
  const present = targets.filter(target => target.exists && target.id !== 'zedKeymap' && target.scope !== 'git');
  if (present.length === 1) return {kind: 'target', target: present[0]!};
  if (!present.length) return {kind: 'none', reason: 'I couldn\'t find a config file here.'};
  return {kind: 'choose', candidates: present};
}

function remember(target: Target | undefined, path: string): AskReferents {
  return {...(target ? {config: {id: target.id, label: target.label, path}} : {}), file: path};
}

function openOutcome(path: string, label: string, context: AskContext, target?: Target): AskOutcome {
  return {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.95, text: `Opening ${label} (${display(path, context)}) in ${context.editor.label}.`,
    action: {kind: 'openFile', path}, referents: remember(target, path)};
}

function missingOutcome(target: Target, context: AskContext, env: FileAssistEnvironment): AskOutcome {
  const text = `${target.label} doesn't exist yet at ${display(target.path!, context)}.`;
  if (!target.create) return {kind: 'answer', capability: 'file.open', text, referents: {config: {id: target.id, label: target.label, path: target.path!}}};
  const created = planCreate(target.path!, target.create, env.roots);
  return {kind: 'answer', capability: 'file.open', text, referents: {config: {id: target.id, label: target.label, path: target.path!}},
    next: created.kind === 'plan' ? [{key: `create:${target.id}`, label: `Create it`, outcome: planOutcome(created.plan, context, env, '', target)}] : []};
}

function chooseTarget(candidates: Target[], context: AskContext, then: (target: Target) => AskOutcome): AskOutcome {
  return {kind: 'choose', reason: 'ambiguous', capability: 'file.open', question: 'Which config do you mean?',
    options: candidates.slice(0, 6).map(target => ({key: `config:${target.id}`, label: target.label, detail: display(target.path!, context), outcome: then(target)}))};
}

/** A verified plan as an answer: file (and real target for a symlink), what changes, the diff, and the guarded command. */
function planOutcome(plan: FileEditPlan, context: AskContext, env: FileAssistEnvironment, content: string, target?: Target): AskOutcome {
  const where = `${display(plan.path, context)}${plan.symlink ? ` → ${display(plan.resolvedPath, context)} (a symlink; the target file is what changes)` : ''}`;
  const script = renderEditCommand(plan, content, env.runtimes);
  const block: CommandBlock = {argv: [], script, provenance: 'context', risk: 'mutate', note: 'Checks the file is unchanged since Ask read it, then writes atomically; it changes nothing if the file changed.',
    run: {kind: 'applyEdit', plan}};
  return {kind: 'answer', capability: 'file.open', text: `${where} · line ${plan.line}\n${plan.reason}\n\n${plan.preview.join('\n')}`, block,
    referents: {...remember(target, plan.path), block}};
}

function resultOutcome(result: PlanResult, facts: FileFacts, context: AskContext, env: FileAssistEnvironment, target: Target | undefined, retry?: (start: number) => AskOutcome): AskOutcome {
  if (result.kind === 'plan') return planOutcome(result.plan, context, env, facts.content ?? '', target);
  if (result.kind === 'noop') return {kind: 'answer', capability: 'file.open', text: result.reason, referents: remember(target, facts.path)};
  if (result.kind === 'matches') {
    return {kind: 'choose', reason: 'ambiguous', capability: 'file.open', question: `${result.reason} Which one?`,
      options: result.matches.slice(0, 8).map(match => ({key: `match:${match.start}`, label: `line ${match.line} · ${match.preview}`, ...(retry ? {outcome: retry(match.start)} : {})}))};
  }
  return {kind: 'answer', capability: 'file.open', text: result.reason, referents: remember(target, facts.path)};
}

/** The snippet a request carries: after a newline or colon, or a {...} object, or a quoted line. */
export function snippetOf(raw: string): string | undefined {
  const newline = raw.indexOf('\n');
  if (newline !== -1) return raw.slice(newline + 1).replace(/^\s*\n/u, '').replace(/\s+$/u, '') || undefined;
  const object = /(\{[\s\S]*\})\s*$/u.exec(raw);
  if (object) return object[1];
  const colon = /:\s+(\S[\s\S]*)$/u.exec(raw);
  if (colon && !/^(?:\/\/|https?)/u.test(colon[1]!)) return colon[1];
  const quoted = /["“]([^"”]+)["”]/u.exec(raw) ?? /`([^`]+)`/u.exec(raw);
  return quoted?.[1];
}

/** "under terminal", "in the [tool.ruff] section", "under scripts". */
function placementOf(text: string): string[] | undefined {
  const match = /\b(?:under|in(?:to)?|inside)\s+(?:the\s+)?["`[]?([\w.-]+)["`\]]?\s*(?:section|table|object|key|block)?\b/u.exec(text);
  if (!match || /^(?:my|this|that|the|config|settings|file|it)$/u.test(match[1]!)) return undefined;
  return match[1]!.split('.');
}

/** Plan an addition/update of a snippet or key=value into a file, by format. */
function planAdd(facts: FileFacts, format: ConfigFormat | 'source', snippet: string, placement: string[] | undefined): PlanResult | {kind: 'where'; reason: string} {
  if (format === 'json' || format === 'jsonc') {
    let parsed: unknown;
    const trimmed = snippet.trim();
    try { parsed = parseJsonc(trimmed.startsWith('{') ? trimmed : `{${trimmed.replace(/,\s*$/u, '')}}`); } catch {
      return {kind: 'refuse', reason: 'That snippet isn\'t valid JSON, so I can\'t place it safely. Paste it as "key": value pairs or a {...} object.'};
    }
    const assignments = flattenJson(parsed);
    if (!assignments.length) return {kind: 'refuse', reason: 'That snippet has no settings to add.'};
    return planJsonSet(facts, format, assignments, placement ?? []);
  }
  if (format === 'toml' || format === 'keyvalue') {
    const lines = snippet.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const pairs = lines.map(line => /^([\w.@-]+)\s*=\s*(.+)$/u.exec(line));
    if (!pairs.length || pairs.some(pair => !pair)) return {kind: 'where', reason: 'I can add key = value lines to this file; that snippet isn\'t in that form.'};
    if (pairs.length > 1) return {kind: 'refuse', reason: 'Add one key = value line at a time to this file, so each is verified.'};
    const [, key, value] = pairs[0]!;
    return planKeyValueSet(facts, format, key!, value!, format === 'toml' ? placement?.join('.') : undefined);
  }
  if (format === 'shell' || format === 'text') return planAppend(facts, format, snippet);
  return {kind: 'where', reason: 'For source files, say exactly what to replace ("replace A with B in file").'};
}

/** "set foo to true", "set terminal.font_size = 14". */
function setRequest(raw: string): {key: string; value: string} | undefined {
  const match = /\bset\s+["'`]?([\w.@-]+)["'`]?\s+(?:to|=)\s+(.+?)(?:\s+(?:in|on)\s+(?:my |the )?[\w.~/+-]+(?: config(?:uration)?| settings)?)?\s*$/iu.exec(raw.split('\n')[0]!);
  return match ? {key: match[1]!, value: match[2]!.replace(/^["'`](.*)["'`]$/u, '$1')} : undefined;
}

/**
 * Config and file requests; undefined leaves the request to the rest of Ask.
 */
export function resolveFileRequest(raw: string, text: string, context: AskContext, env?: FileAssistEnvironment): AskOutcome | undefined {
  if (!env) return undefined;
  const mentionsConfig = /\b(?:config(?:uration)?|settings|rc file|dotfile|zshrc|bashrc|config\.fish|gitconfig)\b/u.test(text);
  const refs = context.referents;
  // Removal is deliberately not part of this feature.
  if (/^(?:please )?(?:remove|delete|erase|unset|drop|get rid of)\b/u.test(text) && (mentionsConfig || refs?.config || /\b(?:setting|line|key|block)\b/u.test(text))) {
    return {kind: 'unsupported', text: 'Removing settings or lines isn\'t something Ask\'s verified editor does. Open the file to remove it yourself.'};
  }
  // "show me the command instead": the current plan's command.
  if (refs?.block?.script && /\b(?:show|give)(?: me)? the command\b|\bcommand instead\b/u.test(text)) {
    return {kind: 'answer', capability: 'file.open', text: 'Here is the command for that edit. Copying or inserting it runs nothing.', block: refs.block};
  }

  // Replace exact text: "in foo.py replace x = 5 with x = 10", or a block form across lines.
  const replace = /^(?:in\s+(\S+)\s+)?replace\s+([\s\S]+?)\s+with\s+([\s\S]+?)(?:\s+in\s+(\S+))?$/iu.exec(raw.trim());
  const block = /^replace (?:this|the|a)? ?(?:block|text|lines?)(?: in (\S+))?:?\s*\n([\s\S]+?)\n\s*with:?\s*\n([\s\S]+)$/iu.exec(raw.trim());
  if (block || (replace && !/\n/u.test(raw))) {
    const file = block ? block[1] : replace![1] ?? replace![4];
    const oldText = block ? block[2]!.replace(/\s+$/u, '') : replace![2]!.replace(/^["'`](.*)["'`]$/u, '$1');
    const newText = block ? block[3]!.replace(/\s+$/u, '') : replace![3]!.replace(/^["'`](.*)["'`]$/u, '$1');
    const path = file ? (isAbsolute(file) ? file : file.startsWith('~/') ? join(context.home, file.slice(2)) : resolve(context.cwd, file)) : refs?.file;
    if (!path) return {kind: 'choose', reason: 'missing', capability: 'file.open', question: 'In which file? Say "in <file> replace … with …".', options: []};
    const facts = env.inspect(path);
    const make = (start?: number): AskOutcome => resultOutcome(planReplace(env.inspect(path), oldText, newText, start), env.inspect(path), context, env, undefined, make);
    return {...resultOutcome(planReplace(facts, oldText, newText), facts, context, env, undefined, make)};
  }

  const set = setRequest(raw);
  const adding = /^(?:please |yeah,? |ok,? )?(?:add|put|insert|append|paste|place)\b/u.test(text) || /\b(?:add|put) (?:this|it|that)\b/u.test(text);
  const changing = /^(?:change|configure|tweak|make|customi[sz]e|adjust|update)\b/u.test(text);
  const opening = /^(?:please )?(?:open|show|view|edit|where is|where's|find)\b/u.test(text);
  if (!mentionsConfig && !set && !(adding && (refs?.config || refs?.file || snippetOf(raw))) && !(opening && (refs?.config && /\b(?:it|that|this)\b/u.test(text)))) return undefined;
  if (!set && !adding && !opening && !(changing && mentionsConfig)) return undefined;

  const resolution = resolveTarget(raw, text, context, env);
  const withTarget = (handle: (target: Target | undefined, path: string, format: ConfigFormat | 'source') => AskOutcome): AskOutcome => {
    if (resolution.kind === 'none') return {kind: 'answer', capability: 'file.open', text: resolution.reason};
    if (resolution.kind === 'choose') return chooseTarget(resolution.candidates, context, target => target.exists ? handle(target, target.path!, target.format) : missingOutcome(target, context, env));
    if (resolution.kind === 'path') {
      const known = (context.configs ?? []).find(target => target.path === resolution.path);
      return handle(known, resolution.path, known?.format ?? formatOfPath(resolution.path));
    }
    if (!resolution.target.exists) return missingOutcome(resolution.target, context, env);
    return handle(resolution.target, resolution.target.path!, resolution.target.format);
  };

  if (opening && !adding && !set) return withTarget((target, path) => openOutcome(path, target?.label ?? basename(path), context, target));

  if (set || adding) {
    const snippet = set ? undefined : snippetOf(raw) ?? refs?.snippet;
    const placement = placementOf(text);
    return withTarget((target, path, format) => {
      const facts = env.inspect(path);
      if (facts.refusal && facts.refusal !== 'does not exist') return {kind: 'answer', capability: 'file.open', text: `${display(path, context)} ${facts.refusal}.`};
      if (set) {
        const result = format === 'json' || format === 'jsonc'
          ? planJsonSet(facts, format, [{path: set.key.split('.'), value: (() => { try { return JSON.parse(set.value); } catch { return set.value; } })()}])
          : format === 'toml' || format === 'keyvalue' ? planKeyValueSet(facts, format, set.key.split('.').at(-1)!, set.value, format === 'toml' && set.key.includes('.') ? set.key.split('.').slice(0, -1).join('.') : undefined)
            : {kind: 'refuse' as const, reason: `I can't set keys in ${basename(path)} safely; give the exact line to add instead.`};
        return resultOutcome(result, facts, context, env, target);
      }
      if (!snippet) {
        return {kind: 'answer', capability: 'file.open', text: `What should I add to ${target?.label ?? basename(path)}? Paste the exact setting or lines.`, referents: remember(target, path)};
      }
      const planned = planAdd(facts, format, snippet, placement);
      if (planned.kind === 'where') return {kind: 'answer', capability: 'file.open', text: planned.reason, referents: {...remember(target, path), snippet}};
      return resultOutcome(planned, facts, context, env, target);
    });
  }
  // "change my Zed terminal settings" without the setting: where the file is, and what NMSh does not know.
  return withTarget((target, path) => ({kind: 'answer', capability: 'file.open',
    text: `${target?.label ?? basename(path)} is at ${display(path, context)}.${target?.schema ? '' : ' NMSh doesn\'t have verified knowledge of its setting keys, so I won\'t guess one. Give me the exact setting or snippet and I can add it safely, or open the file.'}`,
    next: [{key: `open:${path}`, label: 'Open it', outcome: openOutcome(path, target?.label ?? basename(path), context, target)}], referents: remember(target, path)}));
}

export function systemFileAssistEnvironment(home: string, projectRoot: string | undefined, python3: string | undefined, node: string): FileAssistEnvironment {
  const roots = [home, ...(projectRoot ? [projectRoot] : [])];
  return {inspect: path => inspectFile(path, roots), roots, runtimes: {...(python3 ? {python3} : {}), node}};
}

