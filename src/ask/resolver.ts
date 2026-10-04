import {basename, relative} from 'node:path';
import {slashCommands} from '../commands/slashCommands.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {CLEAR_LEAD, matchFiles} from './files.js';
import {resolveGit} from './gitAssist.js';
import {browseOutcome, resolveFiles} from './fileAssist.js';
import {resolveRecipe} from './recipes.js';
import {resolveProject} from './project.js';
import {resolveLocalModel} from './localModel.js';
import {ASK_WORDS, correctRequest, correctWord, type TypoVocabulary} from './fuzzy.js';
import {resolveActivity} from './activity.js';
import {resolvePackage} from './packages.js';
import {resolveFileRequest, type FileAssistEnvironment} from './configAssist.js';
import {askHelpOutcome, GUIDE_REQUEST, guideOutcome, HELP_REQUEST} from './guide.js';
import {answerCommandQuestion, COMMAND_ALIASES, parseCommandQuestion, type CommandEnvironment} from './commands.js';
import {CONCEPTS, conceptDestination, conceptIntent, matchConcepts, type Concept, type ConceptIntent} from './concepts.js';

const CONCEPTS_BY_ID = new Map(CONCEPTS.map(concept => [concept.id, concept]));
import type {AskAction, AskContext, AskOption, AskOutcome, AskTranscript, CapabilityId, ReadCommand, SafetyClass} from './types.js';

/**
 * The deterministic Ask resolver: the primary product, useful with no model.
 * Text is normalized, matched against a typed capability registry, and
 * arguments are resolved only to factual objects from AskContext (files that
 * exist, real worktrees, sessions, transcripts, providers). Nothing here runs
 * anything; executable outcomes carry typed AskActions.
 */

export interface Capability {
  id: CapabilityId;
  title: string;
  safety: SafetyClass;
  /** Phrases a person might use; shown by "what can you do" and given to an optional model as the inventory. */
  examples: string[];
  /** Strong patterns: a match is high confidence. */
  patterns: RegExp[];
  /** Words that suggest the capability: partial overlap is medium confidence. */
  keywords: string[];
}

const SHELL = '(zsh|fish|bash)';
export const CAPABILITIES: readonly Capability[] = [
  {id: 'shell.current', title: 'Which shell this session runs', safety: 'answer', examples: ['what shell am i using'],
    patterns: [/\bwh(?:at|ich) shell\b/u, /\bshell (?:am i|is this|are we)\b/u, /\bcurrent shell\b/u], keywords: ['shell', 'using', 'current', 'which']},
  {id: 'shell.switch', title: 'Switch this session to another shell', safety: 'navigate', examples: ['switch to fish', 'use bash here'],
    patterns: [new RegExp(`\\b(?:switch|change|swap|move|go)\\b.*\\b(?:to|into)\\s+${SHELL}\\b`, 'u'), new RegExp(`\\b(?:use|run|start)\\s+${SHELL}\\b(?!.*\\bdefault\\b)`, 'u'), new RegExp(`^${SHELL}$`, 'u')],
    keywords: ['switch', 'change', 'shell', 'fish', 'bash', 'zsh']},
  {id: 'shell.install', title: 'Install a missing shell', safety: 'install', examples: ['install fish'],
    patterns: [new RegExp(`\\binstall\\s+${SHELL}\\b`, 'u'), new RegExp(`\\bget\\s+${SHELL}\\b`, 'u')], keywords: ['install', 'shell']},
  {id: 'shell.default', title: 'Default shell for new sessions', safety: 'navigate', examples: ['make fish my default shell'],
    patterns: [new RegExp(`\\bdefault\\b.*\\b${SHELL}\\b`, 'u'), new RegExp(`\\b${SHELL}\\b.*\\bdefault\\b`, 'u'), /\bdefault shell\b/u], keywords: ['default', 'shell']},
  {id: 'shell.leave', title: 'Leave NMSh for an ordinary shell (and come back)', safety: 'answer', examples: ['how do i leave nmsh'],
    patterns: [/\b(?:leave|exit|quit|get out of|escape)\b.*\b(?:nmsh|this)\b/u, /\bordinary shell\b/u, /\bcome back\b/u], keywords: ['leave', 'exit', 'quit', 'nmsh']},
  {id: 'session.list', title: 'Show live sessions', safety: 'navigate', examples: ['show my sessions'],
    patterns: [/\b(?:show|list|see|what|which|open)\b.*\b(?:live )?sessions\b/u, /^sessions$/u], keywords: ['sessions', 'session', 'live', 'windows']},
  {id: 'session.resume', title: 'Resume a session or transcript', safety: 'navigate', examples: ['resume yesterday\'s session', 'show old terminal output'],
    patterns: [/\b(?:resume|restore|reopen|continue)\b.*\b(?:session|transcript|terminal)\b/u, /\bold (?:terminal )?output\b/u, /\b(?:yesterday|this morning|last night)\b.*\b(?:session|transcript|output)\b/u,
      /\b(?:session|transcript)\b.*\b(?:yesterday|this morning|last night|earlier)\b/u, /\bprevious (?:session|transcript)\b/u], keywords: ['resume', 'transcript', 'session', 'yesterday', 'old', 'output', 'previous']},
  {id: 'transcript.find', title: 'Find text in the transcript', safety: 'navigate', examples: ['find error in the transcript'],
    patterns: [/\b(?:find|search|look for|grep)\b.+\b(?:in|through) (?:the )?(?:transcript|output|history|terminal)\b/u, /\b(?:find|search for)\s+\S+/u], keywords: ['find', 'search', 'transcript', 'output']},
  {id: 'transcript.filter', title: 'Show only matching output lines', safety: 'navigate', examples: ['only show lines with warning'],
    patterns: [/\bonly show\b.*\blines?\b/u, /\bfilter\b.*\b(?:output|transcript|lines|for|by)\b/u, /\bhide (?:lines|everything)\b/u], keywords: ['filter', 'only', 'lines']},
  {id: 'file.open', title: 'Open a file or folder in your editor', safety: 'navigate', examples: ['open package.json', 'open src config', 'open this in zed'],
    patterns: [/^(?:please )?(?:open|edit|show me|view)\s+(?!.*\b(?:settings|sessions|theme|tools|prompt|providers|screensaver)\b)\S+/u], keywords: ['open', 'file', 'edit']},
  {id: 'editor.status', title: 'Editor bridge status', safety: 'answer', examples: ['why can\'t i open files'],
    patterns: [/\bwhy\b.*\b(?:open|editor)\b/u, /\bwhich editor\b/u, /\beditor\b.*\b(?:work|working|set up|detected)\b/u], keywords: ['editor', 'open', 'zed', 'vscode']},
  {id: 'git.status', title: 'Git status', safety: 'read', examples: ['check git status', 'what changed'],
    patterns: [/\bgit status\b/u, /\b(?:what|which) (?:files )?(?:changed|is modified|did i change)\b/u, /\buntracked\b/u, /\bstatus of (?:the )?repo\b/u], keywords: ['git', 'status', 'changed', 'modified']},
  {id: 'git.diff', title: 'Show the working-tree diff', safety: 'read', examples: ['show git diff', 'show changes in my other worktree'],
    patterns: [/\bgit diff\b/u, /\b(?:show|see|view)\b.*\b(?:diff|changes)\b/u, /\bwhat (?:did i|have i) (?:change|changed)\b/u, /\bsince (?:my |the )?last commit\b/u],
    keywords: ['diff', 'changes', 'changed', 'worktree', 'commit']},
  {id: 'git.branch', title: 'Current Git branch', safety: 'answer', examples: ['what branch am i on'],
    patterns: [/\bwh(?:at|ich) branch\b/u, /\bcurrent branch\b/u, /\bbranch am i\b/u], keywords: ['branch']},
  {id: 'git.log', title: 'Recent commits', safety: 'read', examples: ['show recent commits'],
    patterns: [/\bgit log\b/u, /\b(?:recent|last|latest) commits?\b/u, /\bcommit history\b/u], keywords: ['log', 'commits', 'history']},
  {id: 'git.worktrees', title: 'Git worktrees', safety: 'answer', examples: ['show my worktrees'],
    patterns: [/\bworktrees?\b(?!.*\b(?:diff|changes)\b)/u], keywords: ['worktree', 'worktrees']},
  {id: 'settings.open', title: 'Open Settings', safety: 'navigate', examples: ['open settings'],
    patterns: [/\b(?:open|show|change)\b.*\bsettings\b/u, /^settings$/u, /\bpreferences\b/u], keywords: ['settings', 'preferences', 'config']},
  {id: 'theme.open', title: 'Change the theme', safety: 'navigate', examples: ['change theme'],
    patterns: [/\b(?:change|switch|pick|choose|open)\b.*\b(?:theme|colou?rs|appearance|palette)\b/u, /^(?:theme|appearance)$/u], keywords: ['theme', 'colors', 'appearance']},
  {id: 'prompt.open', title: 'Configure the prompt', safety: 'navigate', examples: ['change my prompt'],
    patterns: [/\b(?:change|configure|edit|customi[sz]e|open)\b.*\bprompt\b(?!.*provider)/u], keywords: ['prompt']},
  {id: 'tools.open', title: 'Optional tools and installs', safety: 'navigate', examples: ['install fastfetch', 'show optional tools'],
    patterns: [/\binstall\s+(?!zsh\b|fish\b|bash\b)\S+/u, /\b(?:optional )?tools\b/u], keywords: ['tools', 'install']},
  {id: 'screensaver.open', title: 'Screensaver', safety: 'navigate', examples: ['open the screensaver'],
    patterns: [/\bscreen ?saver\b/u, /\bidle visuals?\b/u], keywords: ['screensaver', 'idle']},
  {id: 'providers.open', title: 'Providers', safety: 'navigate', examples: ['what providers are installed'],
    patterns: [/\bproviders?\b(?!.*\b(?:using|switch|use)\b)/u], keywords: ['providers', 'provider']},
  {id: 'provider.status', title: 'Which provider is active', safety: 'answer', examples: ['what prompt provider am i using'],
    patterns: [/\bwh(?:at|ich)\b.*\b(?:prompt|suggestions?|history|welcome|picker|navigation)\b.*\bprovider\b/u, /\bprovider am i\b/u], keywords: ['provider', 'using']},
  {id: 'provider.switch', title: 'Switch a provider', safety: 'navigate', examples: ['switch suggestions to deja'],
    patterns: [/\b(?:switch|change|set|use)\b.*\b(?:suggestions?|history|welcome|picker|navigation)\b.*\b(?:to|with)\b\s+\S+/u, /\buse\s+(?:deja|atuin|fzf|television|zoxide|fastfetch|neofetch|starship|powerlevel10k)\b/u],
    keywords: ['switch', 'provider', 'use']},
  {id: 'understanding.set', title: 'Local understanding (optional local model)', safety: 'navigate', examples: ['turn local understanding off', 'use my existing local model'],
    patterns: [/\blocal (?:understanding|model)\b/u, /\buse (?:my )?(?:existing )?(?:local )?model\b/u, /\bqwen\b/u], keywords: ['local', 'model', 'understanding']},
  {id: 'help.capabilities', title: 'What Ask can do', safety: 'answer', examples: ['what can you do'],
    patterns: [/\bwhat can (?:you|ask|nmsh) do\b/u, /^help$/u, /\bwhat (?:are|is) (?:your|the) (?:commands|options)\b/u], keywords: ['help', 'can', 'do']},
  {id: 'help.command', title: 'Explain an NMSh command', safety: 'answer', examples: ['what does /resume do'],
    patterns: [/\/[a-z][\w-]*/u], keywords: []},
  // Product vocabulary (concepts.ts): matched by the concept catalog, not by these patterns.
  {id: 'help.guide', title: 'The NMSh guide', safety: 'answer', examples: ['guide me through nmsh'], patterns: [], keywords: []},
  {id: 'help.feature', title: 'Explain an NMSh feature', safety: 'answer', examples: ['what is chroma', 'what is the difference between completion and suggestions'],
    patterns: [], keywords: []},
  {id: 'feature.open', title: 'Open where an NMSh feature is configured', safety: 'navigate', examples: ['change cursor blink', 'stop folding my output', 'change my ghost text'],
    patterns: [], keywords: []},
];

/** Destructive or authority-escalating requests Ask understands but never performs. */
const UNSAFE = /\b(?:delete|remove|rm|wipe|erase|purge|destroy|nuke|reset --hard|hard reset|git reset|git clean|clean up untracked|force push|push|commit|chmod|chown|sudo|kill|uninstall|drop|format|overwrite|truncate|rewrite history|rebase|checkout --|discard)\b/u;
/** Requests understood as writing or authoring, which Ask has no capability for. */
const AUTHORING = /\b(?:write|create|generate|make|build|compile|refactor|fix|implement|send|email|translate)\b/u;
/** Vague references that need context to resolve. */
const VAGUE = /\b(?:thing|that one|the old one|the other one|from earlier|earlier|before|previous one|last one|it again)\b/u;

export const CONFIDENCE = {high: 0.85, medium: 0.5} as const;

export function normalizeRequest(text: string): string {
  return text.toLowerCase()
    .replace(/[’`]/gu, '\'')
    .replace(/\bcan't\b/gu, 'cannot').replace(/\bwhat's\b/gu, 'what is').replace(/\bi'm\b/gu, 'i am').replace(/\bdon't\b/gu, 'do not')
    .replace(/[?!,;]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function scoreCapabilities(text: string): Array<{capability: Capability; score: number}> {
  const words = new Set(text.split(/[^a-z0-9/.-]+/u).filter(Boolean));
  return CAPABILITIES.map(capability => {
    if (capability.patterns.some(pattern => pattern.test(text))) return {capability, score: 0.95};
    const hits = capability.keywords.filter(keyword => words.has(keyword)).length;
    return {capability, score: capability.keywords.length ? Math.min(0.7, hits * 0.3) : 0};
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
}

export interface ResolveState {
  /** Interpretation keys the person already rejected in this interaction. */
  rejected?: ReadonlySet<string>;
}

const shellIn = (text: string): ShellId | undefined => (/\b(zsh|fish|bash)\b/u.exec(text)?.[1] as ShellId | undefined);
const shellLabel = (context: AskContext, id: ShellId) => context.shells.find(shell => shell.id === id)?.label ?? id;

/**
 * One resolved request. Exact words and aliases first; only when that leaves
 * Ask unsure are clear typos of known vocabulary corrected (fuzzy.ts) and the
 * request resolved again. A correction that changes a command or an action is
 * shown ("Interpreted as: git status"); the original wording wins otherwise.
 */
export function resolveRequest(raw: string, context: AskContext, state: ResolveState = {}, commands?: CommandEnvironment, files?: FileAssistEnvironment): AskOutcome {
  const exact = resolveExact(raw, context, state, commands, files);
  // A broad fallback (a folder list, a transcript search) can hide a typo of a more specific request ("show untrackd files").
  const broad = (outcome: AskOutcome) => (outcome.kind === 'choose' || outcome.kind === 'proposal' || outcome.kind === 'answer') && ['file.browse', 'transcript.find'].includes(outcome.capability ?? '');
  if (!weak(exact) && !broad(exact)) return exact;
  const corrected = correctRequest(normalizeRequest(raw), typoVocabulary(context, commands));
  if (!corrected) return exact;
  const retry = resolveExact(corrected.text, context, state, commands, files);
  if (weak(retry) || (broad(exact) && (broad(retry) || retry.kind === exact.kind && (retry as {capability?: string}).capability === (exact as {capability?: string}).capability))) return exact;
  const note = `Interpreted as: ${corrected.text}`;
  if (retry.kind === 'proposal') return {...retry, text: `${retry.text}\n${note}`};
  if (retry.kind === 'answer') return {...retry, text: `${note}\n${retry.text}`};
  if (retry.kind === 'choose') return {...retry, question: `${note}\n${retry.question}`};
  return retry;
}

const weak = (outcome: AskOutcome) => outcome.kind === 'unclear' || (outcome.kind === 'answer' && /is not an NMSh command/u.test(outcome.text)) || (outcome.kind === 'choose' && outcome.reason === 'ambiguous')
  || (outcome.kind === 'answer' && /^No file matching|doesn't know|I don't know|not a .* subcommand NMSh knows/u.test(outcome.text))
  || (outcome.kind === 'answer' && /\(\S+ is not a .+ subcommand NMSh knows\)/u.test(outcome.text));

let typoWords: string[] | undefined;
function typoVocabulary(context: AskContext, commands?: CommandEnvironment): TypoVocabulary {
  typoWords ??= [...new Set([...ASK_WORDS, ...CONCEPTS.flatMap(concept => concept.aliases).flatMap(alias => alias.split(/\s+/u)).filter(word => /^[a-z][a-z-]{2,}$/u.test(word)),
    ...slashCommands.map(command => command.name.split(' ')[0]!), ...Object.keys(COMMAND_ALIASES), 'zsh', 'fish', 'bash', 'deja', 'atuin', 'fzf', 'television', 'zoxide', 'starship', 'fastfetch', 'neofetch'])];
  const files = (context.files ?? []).map(path => basename(path).toLowerCase());
  const commandNames = () => commands?.reference.commandNames() ?? [];
  const known = new Set<string>([...typoWords, ...files, ...files.map(name => name.replace(/\.[^.]+$/u, ''))]);
  // Command names are known words too (many are English: make, find, open), so they are never "corrected" away.
  const knownCommands = new Set(commandNames());
  return {known: {has: (word: string) => known.has(word) || knownCommands.has(word) || COMMON.has(word)} as ReadonlySet<string>, words: typoWords, commands: commandNames,
    subcommands: command => commands?.reference.lookup([command])?.facts.subcommands.flatMap(item => item.names) ?? []};
}

/** Everyday words that are never typo candidates. */
const COMMON = new Set(['the', 'and', 'for', 'you', 'can', 'how', 'this', 'that', 'with', 'from', 'into', 'about', 'please', 'there', 'here', 'them', 'they', 'are', 'was',
  'have', 'has', 'does', 'did', 'not', 'all', 'any', 'some', 'one', 'two', 'other', 'again', 'just', 'like', 'want', 'need', 'make', 'get', 'set', 'use', 'run', 'see',
  'thing', 'stuff', 'mine', 'yours', 'more', 'less', 'last', 'first', 'second', 'third', 'next', 'previous', 'new', 'old', 'off', 'turn', 'remove', 'add', 'put', 'help',
  'doing', 'done', 'tell', 'give', 'keep', 'every', 'each', 'what', 'when', 'why', 'who', 'way', 'today', 'yesterday', 'broken', 'failed', 'fail', 'error', 'errors']);

function resolveExact(raw: string, context: AskContext, state: ResolveState = {}, commands?: CommandEnvironment, files?: FileAssistEnvironment): AskOutcome {
  const text = normalizeRequest(raw);
  if (!text) return unclear(context, 'What can I help you with?');
  const scored = scoreCapabilities(text);
  // Explaining an NMSh command wins over acting on it.
  const explain = /\b(?:what|how) (?:does|do|is)\b/u.test(text) && /\/[a-z][\w-]*/u.exec(text);
  if (explain) return build('help.command', text, context, raw);
  // Homebrew from its own facts; install/upgrade/uninstall are typed proposals behind the final Yes.
  const packages = resolvePackage(text, context);
  if (packages) return packages;
  // Config files and verified edits (resolve → inspect → plan → preview → confirm); removal is answered, never planned.
  // "find files named config" is a file search, not a config request.
  if (/^(?:please )?(?:find|locate|search for|look for|show(?: me)?|list)\b.*\b(?:files?|folders?)\s+(?:named|called|matching)\b/u.test(text)) {
    const named = resolveFiles(text, raw, context);
    if (named) return named;
  }
  const file = resolveFileRequest(raw, text, context, files);
  if (file) return file;
  // Command knowledge: explaining git push or git clean is an answer, not an action, so it comes before the action-safety check.
  // "how do i X" still lets a strong typed capability act ("how do i open package.json").
  // One guide: /guide, "guide me through nmsh", and /ask help all come from the concept catalog.
  if (GUIDE_REQUEST.test(text)) return guideOutcome(context);
  if (HELP_REQUEST.test(text)) return askHelpOutcome();
  // The optional local model: status and where its actions live (/llm).
  const llm = resolveLocalModel(text, context);
  if (llm) return llm;
  // Recent activity from recorded facts ("what did I just do").
  const activity = resolveActivity(text, context, commands);
  if (activity) return activity;
  // Git from local facts (current branch, real remotes, listed files) and this conversation's referents.
  const git = resolveGit(text, raw, context, commands?.reference);
  if (git) return git;
  // Files from real directory facts: list, browse, find, open, ordinals over listed results.
  const fileResult = resolveFiles(text, raw, context);
  if (fileResult) return fileResult;
  // Project scripts and NMSh-managed background tasks (dev servers).
  const project = resolveProject(text, context);
  if (project) return project;
  // Terminal tasks as typed recipes (archives, ping, disk, ports, processes, addresses, memory, search).
  const recipe = resolveRecipe(text, context, commands);
  if (recipe) return recipe;
  // "what does this command do": the command this conversation shows, else the last one run.
  if (commands && /\b(?:this|that|the|my) (?:last |previous )?command\b/u.test(text) && /^(?:what|explain|how)\b/u.test(text) && !/\b(?:produced|caused|failed|made)\b/u.test(text)) {
    const words = context.referents?.block && !context.referents.block.literal ? context.referents.block.argv : context.recent?.[0]?.command.split(/\s+/u);
    const path = words?.filter(word => /^[\w.+-]+$/u.test(word) && !word.startsWith('-')).slice(0, 2) ?? [];
    if (path.length) {
      const found = commands.reference.lookup(path);
      const target = found ? found.facts.path : path.slice(0, 1);
      const answer = answerCommandQuestion({intent: 'explain', words: target}, context, commands);
      if (answer) return answer;
    }
  }
  const question = commands ? parseCommandQuestion(text) : undefined;
  if (question && commands) {
    const strongAction = scored.find(item => item.score >= CONFIDENCE.high && !item.capability.id.startsWith('help.'));
    const howTo = /^(?:please )?how (?:do|can|would|should) i|^how to/u.test(text);
    if (!(howTo && strongAction && question.intent !== 'option')) {
      const answer = answerCommandQuestion(question, context, commands);
      if (answer) return answer;
    }
  }
  // "remove the input dividers" is a typed NMSh setting, not a deletion: a toggle concept wins over the safety refusal.
  const toggled = matchConcepts(text).concepts.find(concept => concept.toggle);
  if (toggled && (conceptIntent(text) === 'off' || conceptIntent(text) === 'on')) { const product = resolveConcepts(text, context, raw, scored); if (product) return product; }
  if (UNSAFE.test(text) && !scored.some(item => item.score >= CONFIDENCE.high && item.capability.safety === 'answer')) return unsafe(text, context);
  const product = resolveConcepts(text, context, raw, scored);
  if (product) return product;
  const top = scored[0];
  if (top && top.score >= CONFIDENCE.high) {
    const close = scored.filter(item => item.score >= CONFIDENCE.high);
    if (close.length > 1 && !preferFirst(close.map(item => item.capability.id))) {
      return interpretations(close.map(item => build(item.capability.id, text, context, raw)), context, state, 'I can read that a few ways. Did you mean:');
    }
    return build(top.capability.id, text, context, raw);
  }
  if (VAGUE.test(text)) return vague(context, state);
  const medium = scored.filter(item => item.score >= CONFIDENCE.medium);
  if (medium.length) return interpretations(medium.slice(0, 4).map(item => build(item.capability.id, text, context, raw)), context, state, 'I\'m not completely sure what you mean. Did you mean:');
  if (AUTHORING.test(text)) {
    return {kind: 'unsupported', text: 'Ask doesn\'t write or change code or files; it finds, opens, shows and switches things in NMSh.',
      alternative: {key: 'files', label: 'Open a file in your editor', refine: 'open '}};
  }
  return unclear(context, 'I\'m not sure what you mean yet.');
}

/** Some strong matches overlap by design; the more specific one wins. */
function preferFirst(ids: CapabilityId[]): boolean {
  const pairs: Array<[CapabilityId, CapabilityId]> = [['shell.install', 'tools.open'], ['shell.default', 'shell.switch'], ['git.diff', 'git.worktrees'],
    ['provider.switch', 'providers.open'], ['provider.status', 'providers.open'], ['session.resume', 'session.list'], ['transcript.find', 'file.open'],
    ['editor.status', 'file.open'], ['understanding.set', 'providers.open'], ['git.status', 'git.diff'], ['shell.leave', 'shell.current']];
  return pairs.some(([first, second]) => ids[0] === first && ids.includes(second)) || ids.length === 1;
}

function interpretations(outcomes: AskOutcome[], context: AskContext, state: ResolveState, question: string): AskOutcome {
  const options = dedupe(outcomes.map(optionFor)).filter(option => !state.rejected?.has(option.key));
  if (options.length === 1) return options[0]!.outcome!;
  if (!options.length) return unclear(context, 'None of those then. Tell me a little more about what you want.', state);
  return {kind: 'choose', reason: 'ambiguous', question, options: options.slice(0, 5)};
}

function optionFor(outcome: AskOutcome): AskOption {
  const key = outcome.kind === 'proposal' || outcome.kind === 'answer' ? outcome.capability
    : outcome.kind === 'choose' ? `${outcome.capability ?? 'choose'}:${outcome.question}` : outcome.kind;
  const label = outcome.kind === 'proposal' ? outcome.text : outcome.kind === 'answer' ? CAPABILITIES.find(item => item.id === outcome.capability)!.title
    : outcome.kind === 'choose' ? (CAPABILITIES.find(item => item.id === outcome.capability)?.title ?? outcome.question) : outcome.text;
  return {key, label: firstLine(label), outcome};
}

const dedupe = (options: AskOption[]) => options.filter((option, index) => options.findIndex(other => other.key === option.key) === index);
const firstLine = (text: string) => text.split('\n')[0]!;

/** Low confidence: factual categories from what exists here, not a canned menu. */
function unclear(context: AskContext, text: string, state: ResolveState = {}): AskOutcome {
  const categories: AskOption[] = [];
  if (context.repoRoot) categories.push({key: 'cat:git', label: 'Git changes in this repository', refine: 'show git diff'});
  categories.push({key: 'cat:files', label: `Files in ${context.repoRoot ? basename(context.repoRoot) : 'this folder'}`, refine: 'list files'});
  if (context.sessions.length > 1 || context.transcripts.length) categories.push({key: 'cat:sessions', label: 'Sessions and transcripts', refine: 'show my sessions'});
  categories.push({key: 'cat:shell', label: 'Shell or provider settings', refine: 'what providers are installed'});
  return {kind: 'unclear', text: `${text} Based on what you're working on, I can help with:`, categories: categories.filter(option => !state.rejected?.has(option.key))};
}

/** "The thing from earlier": rank real candidates from recent factual context. */
function vague(context: AskContext, state: ResolveState): AskOutcome {
  const options: AskOption[] = [];
  if (context.repoRoot && context.dirty !== false) options.push({key: 'vague:diff', label: 'Show the latest Git diff in this repository', outcome: build('git.diff', 'show git diff', context, 'show git diff')});
  const here = context.transcripts.filter(item => item.startCwd === context.cwd || item.finalCwd === context.cwd)[0] ?? context.transcripts[0];
  if (here) options.push({key: `vague:transcript:${here.id}`, label: `Resume the most recent transcript (${transcriptLabel(here, context)})`, outcome: resumeProposal(here, context)});
  const file = context.recentFiles[0];
  if (file) options.push({key: `vague:file:${file}`, label: `Reopen ${displayPath(file, context)}`, outcome: openProposal(file, context)});
  const remaining = options.filter(option => !state.rejected?.has(option.key));
  if (!remaining.length) return unclear(context, 'I\'m not sure which one you mean.', state);
  return {kind: 'choose', reason: 'ambiguous', question: 'I\'m not completely sure what you mean. Did you mean:', options: remaining};
}

function unsafe(text: string, context: AskContext): AskOutcome {
  const git = /\b(?:git|untracked|commit|push|branch|rebase|reset|clean|checkout|discard|changes)\b/u.test(text);
  const what = /\buntracked\b/u.test(text) ? 'delete untracked files' : /\bpush\b/u.test(text) ? 'push commits' : /\bcommit\b/u.test(text) ? 'commit changes'
    : /\bkill\b/u.test(text) ? 'end processes' : /\bsudo\b/u.test(text) ? 'run commands as root' : 'change or delete things';
  if (git && context.repoRoot) {
    // The affected files become what "them" means next ("show them", "what's the command to delete them").
    if (/\buntracked\b/u.test(text) && context.git) {
      return {kind: 'unsafe', text: `I understand that you want to ${what}, but Ask won't run destructive or history-changing Git commands. I can show the affected files first.`,
        alternative: {key: 'safe:untracked', label: 'Show the untracked files', refine: 'show untracked files'},
        referents: {files: {paths: [...context.git.untracked], kind: 'untracked'}}};
    }
    return {kind: 'unsafe', text: `I understand that you want to ${what}, but Ask won't run destructive or history-changing Git commands. I can show the affected files first.`,
      alternative: {key: 'safe:status', label: 'Show Git status', outcome: build('git.status', 'git status', context, 'git status')}};
  }
  if (/\bkill\b.*\bsession\b/u.test(text)) {
    return {kind: 'unsafe', text: 'Ask won\'t end sessions itself. /sessions can, with its own confirmation (Ctrl+K on a detached session).',
      alternative: {key: 'safe:sessions', label: 'Open /sessions', outcome: build('session.list', 'show sessions', context, 'show sessions')}};
  }
  return {kind: 'unsafe', text: `I understand that you want to ${what}, but that is outside what Ask will do: it never runs destructive, privileged or arbitrary commands.`};
}

const READ_COMMANDS: Record<ReadCommand['id'], (command: ReadCommand) => string[]> = {
  'git.status': command => ['git', ...(command.cwd ? ['-C', command.cwd] : []), 'status'],
  'git.diff': command => ['git', ...(command.cwd ? ['-C', command.cwd] : []), 'diff', ...((command as {staged?: boolean}).staged ? ['--staged'] : [])],
  'git.log': command => ['git', ...(command.cwd ? ['-C', command.cwd] : []), 'log', '--oneline', '-n', '20'],
};

/** The fixed argv for a read-only command; arguments other than a factual path never come from the request. */
export function readArgv(command: ReadCommand): string[] {
  return READ_COMMANDS[command.id](command);
}

function displayPath(path: string, context: AskContext): string {
  const base = context.repoRoot ?? context.cwd;
  const rel = relative(base, path);
  if (!rel.startsWith('..') && rel !== '') return rel;
  return path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path;
}

function transcriptLabel(item: AskTranscript, context: AskContext): string {
  const date = new Date(item.createdAt);
  const day = sameDay(date, new Date(context.now)) ? 'today' : sameDay(date, new Date(context.now - 86_400_000)) ? 'yesterday' : date.toISOString().slice(0, 10);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day} ${time} · ${displayPath(item.finalCwd || item.startCwd, context)} · ${item.commandCount} command${item.commandCount === 1 ? '' : 's'}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function resumeProposal(item: AskTranscript, context: AskContext): AskOutcome {
  return {kind: 'proposal', capability: 'session.resume', safety: 'navigate', confidence: 0.9,
    text: `Resume the transcript from ${transcriptLabel(item, context)}?`, action: {kind: 'resumeTranscript', id: item.id}};
}

function openProposal(path: string, context: AskContext): AskOutcome {
  return {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.92,
    text: `Open ${displayPath(path, context)} in ${context.editor.label}?`, action: {kind: 'openFile', path}, referents: {file: path}};
}

function readProposal(capability: CapabilityId, command: ReadCommand, description: string): AskOutcome {
  return {kind: 'proposal', capability, safety: 'read', confidence: 0.9, text: description, action: {kind: 'read', command}};
}

const navigate = (capability: CapabilityId, text: string, action: AskAction): AskOutcome =>
  ({kind: 'proposal', capability, safety: 'navigate', confidence: 0.95, text, action});

/** The request with filler words and the verb removed, for argument extraction. */
function argumentText(raw: string, verb: RegExp): string {
  return raw.replace(verb, '').replace(/\b(?:the|my|a|an|file|folder|please|in (?:zed|vs ?code|my editor|the editor))\b/giu, ' ').replace(/\s+/gu, ' ').trim();
}

export function build(id: CapabilityId, text: string, context: AskContext, raw: string): AskOutcome {
  const shell = shellIn(text);
  switch (id) {
    case 'shell.current': {
      const current = shellLabel(context, context.shell);
      return {kind: 'answer', capability: id, text: context.shell === context.defaultShell
        ? `This session runs ${current}, which is also your default for new sessions.`
        : `This session runs ${current}. New sessions start ${shellLabel(context, context.defaultShell)} (your default).`};
    }
    case 'shell.switch': {
      if (!shell) return {kind: 'choose', reason: 'missing', capability: id, question: 'Switch this session to which shell?',
        options: context.shells.filter(item => item.id !== context.shell).map(item => ({key: `shell:${item.id}`, label: item.label, refine: `switch to ${item.id}`}))};
      if (shell === context.shell) return {kind: 'answer', capability: id, text: `This session already runs ${shellLabel(context, shell)}.`};
      const info = context.shells.find(item => item.id === shell);
      if (info && !info.installed) return build('shell.install', `install ${shell}`, context, raw);
      return {kind: 'proposal', capability: id, safety: 'navigate', confidence: 0.95, command: `/shell ${shell}`,
        text: `Yes. NMSh can switch this session to ${shellLabel(context, shell)}. Same session and folder; ${shellLabel(context, context.shell)} aliases and variables stay behind.`,
        action: {kind: 'switchShell', shell}};
    }
    case 'shell.install': {
      if (!shell) return {kind: 'choose', reason: 'missing', capability: id, question: 'Install which shell?',
        options: context.shells.filter(item => !item.installed).map(item => ({key: `install:${item.id}`, label: item.label, refine: `install ${item.id}`}))};
      const info = context.shells.find(item => item.id === shell);
      if (info?.installed) return {kind: 'answer', capability: id, text: `${info.label} is already installed. /shell ${shell} switches this session to it.`,
        follow: {key: `switch:${shell}`, label: `Switch to ${info.label}`, outcome: build('shell.switch', `switch to ${shell}`, context, raw)}};
      if (!info?.installable) return {kind: 'answer', capability: id, text: `${shellLabel(context, shell)} is not installed, and NMSh has no safe install recipe here. Install it with your system's package manager, then /shell lists it.`};
      return {kind: 'proposal', capability: id, safety: 'install', confidence: 0.95,
        text: `${shellLabel(context, shell)} is not installed. /shell can install it with its previewed recipe; nothing runs until you confirm there.`,
        action: {kind: 'installShell', shell}};
    }
    case 'shell.default': {
      if (!shell) return {kind: 'answer', capability: id, text: `New sessions start ${shellLabel(context, context.defaultShell)}. Say "make fish my default shell" to change it.`};
      if (shell === context.defaultShell) return {kind: 'answer', capability: id, text: `${shellLabel(context, shell)} is already your default shell.`};
      return {kind: 'proposal', capability: id, safety: 'navigate', confidence: 0.9,
        text: `Make ${shellLabel(context, shell)} the default for new sessions? This session keeps ${shellLabel(context, context.shell)} until /shell changes it.`,
        action: {kind: 'setting', setting: 'shellBackend', value: shell, label: `Default shell: ${shellLabel(context, shell)}`}};
    }
    case 'shell.leave':
      return {kind: 'answer', capability: id, text: `Use /${context.shell === 'zsh' ? 'zsh' : context.shell} (or /exit for your default shell). It leaves NMSh for an ordinary shell`
        + (context.sessionMode === 'service' ? ' and keeps this session; running `nmsh` there returns to it.' : '; this in-process session ends.')};
    case 'session.list': return navigate(id, 'Opening /sessions.', {kind: 'slash', slash: {kind: 'sessions'}, label: '/sessions'});
    case 'session.resume': return resolveTranscript(text, context);
    case 'transcript.find': {
      const query = argumentText(raw, /^(?:please )?(?:find|search(?: for)?|look for|grep)\s+/iu).replace(/\b(?:in|through) (?:the )?(?:transcript|output|history|terminal)\b.*$/iu, '').trim().replace(/^-+/u, '');
      if (!query) return {kind: 'choose', reason: 'missing', capability: id, question: 'Find what?', options: []};
      return navigate(id, `Finding "${query}" in the transcript.`, {kind: 'slash', slash: {kind: 'find', arguments: query}, label: `/find ${query}`});
    }
    case 'transcript.filter': {
      const query = argumentText(raw, /^.*?\b(?:only show(?: lines)?(?: with| containing)?|filter(?: (?:the )?(?:output|transcript))?(?: (?:for|by))?)\s+/iu).replace(/^lines? (?:with|containing)\s+/iu, '').replace(/^-+/u, '');
      if (!query) return {kind: 'choose', reason: 'missing', capability: id, question: 'Show only lines with what?', options: []};
      return navigate(id, `Showing only lines with "${query}" in the latest output.`, {kind: 'slash', slash: {kind: 'filter', arguments: query}, label: `/filter ${query}`});
    }
    case 'file.open': return resolveFile(raw, text, context);
    case 'file.list': case 'file.browse': return resolveFiles(text, raw, context) ?? browseOutcome(context.cwd, context);
    case 'project.run': case 'project.task': return resolveProject(text, context) ?? {kind: 'answer', capability: id, text: 'Say which script to run, e.g. "run the tests".'};
    case 'file.find': return resolveFiles(text, raw, context) ?? {kind: 'choose', reason: 'missing', capability: id, question: 'Find which file?', options: []};
    case 'editor.status':
      return {kind: 'answer', capability: id, text: context.editor.available ? `Files open in ${context.editor.label} (/open, Settings → Open with).` : context.editor.reason ?? 'No editor is available for /open here.'};
    case 'git.status': case 'git.diff': case 'git.log': {
      if (!context.repoRoot) return {kind: 'answer', capability: id, text: 'This folder is not in a Git repository.'};
      const worktree = /\bworktree\b/u.test(text) ? resolveWorktree(text, context, id) : undefined;
      if (worktree && 'kind' in worktree) return worktree;
      const cwd = worktree?.path;
      const command: ReadCommand = id === 'git.diff' ? {id, ...(cwd ? {cwd} : {}), ...(/\bstaged\b/u.test(text) ? {staged: true} : {})} : {id, ...(cwd ? {cwd} : {})};
      const where = cwd ? ` in ${displayPath(cwd, context)}` : '';
      const description = id === 'git.status' ? `I can show Git status${where}.` : id === 'git.diff' ? `I can show the ${/\bstaged\b/u.test(text) ? 'staged' : 'working-tree'} diff${where}.` : `I can show the last 20 commits${where}.`;
      return readProposal(id, command, description);
    }
    case 'git.branch':
      return {kind: 'answer', capability: id, text: context.branch ? `You are on ${context.branch}.` : context.repoRoot ? 'HEAD is detached (no branch).' : 'This folder is not in a Git repository.'};
    case 'git.worktrees':
      if (!context.repoRoot) return {kind: 'answer', capability: id, text: 'This folder is not in a Git repository.'};
      return {kind: 'answer', capability: id, text: context.worktrees.length <= 1 ? 'This repository has one worktree (this one).'
        : `Worktrees:\n${context.worktrees.map(item => `  ${item.current ? '›' : ' '} ${displayPath(item.path, context)}${item.branch ? `  ${item.branch}` : ''}`).join('\n')}`};
    case 'settings.open': return navigate(id, 'Opening Settings.', {kind: 'slash', slash: {kind: 'settings', view: 'config'}, label: '/settings'});
    case 'theme.open': return navigate(id, 'Opening Appearance (themes).', {kind: 'slash', slash: {kind: 'appearance'}, label: '/appearance'});
    case 'prompt.open': return navigate(id, 'Opening /prompt.', {kind: 'slash', slash: {kind: 'prompt'}, label: '/prompt'});
    case 'tools.open': return navigate(id, 'Opening /tools: installs there are previewed and start on No.', {kind: 'slash', slash: {kind: 'tools'}, label: '/tools'});
    case 'screensaver.open': return navigate(id, 'Opening /screensaver.', {kind: 'slash', slash: {kind: 'screensaver', start: false}, label: '/screensaver'});
    case 'providers.open': return navigate(id, 'Opening /providers.', {kind: 'slash', slash: {kind: 'providers'}, label: '/providers'});
    case 'provider.status': return providerStatus(text, context);
    case 'provider.switch': return providerSwitch(text, context);
    case 'understanding.set': return understanding(text, context);
    case 'help.capabilities':
      return {kind: 'answer', capability: id, text: `Ask finds, opens, shows and switches things in NMSh. For example:\n${['open package.json', 'show my sessions', 'switch to fish',
        'check git diff', 'find error in the transcript', 'resume yesterday\'s session', 'what providers are installed'].map(example => `  ${example}`).join('\n')}\nIt never runs destructive or arbitrary commands.`};
    case 'help.guide': return guideOutcome(context);
    case 'help.feature': case 'feature.open':
      return resolveConcepts(text, context, raw, []) ?? unclear(context, 'I\'m not sure which part of NMSh you mean.');
    case 'help.command': {
      const name = /\/[a-z][\w-]*/u.exec(text)?.[0];
      const known = slashCommands.find(command => command.name === name);
      return {kind: 'answer', capability: id, text: known ? `${known.name}: ${known.description}.` : `${name ?? 'That'} is not an NMSh command. /help lists them.`};
    }
  }
}

/** Capabilities that only open a broad surface: a named product concept is more specific than they are. */
const GENERIC: ReadonlySet<CapabilityId> = new Set(['settings.open', 'theme.open', 'prompt.open', 'providers.open', 'file.open', 'tools.open', 'screensaver.open', 'help.capabilities']);
/** Broad concepts: when a request names one of these and something more specific, the specific one is meant. */
const UMBRELLA = new Set(['settings', 'theme', 'prompt', 'transcript', 'help', 'providers', 'shell', 'sessions', 'history']);

/**
 * Concept first, then intent: which NMSh feature the request names (from the
 * product vocabulary), then what to do with it. Undefined leaves the request
 * to the capability patterns: a strong, specific capability (switch to fish,
 * git diff, find X) keeps priority unless a concept explicitly overrides it.
 */
function resolveConcepts(text: string, context: AskContext, raw: string, scored: ReadonlyArray<{capability: Capability; score: number}>): AskOutcome | undefined {
  const match = matchConcepts(text);
  if (!match.concepts.length && !match.ambiguous.length) return undefined;
  const intent = conceptIntent(text);
  const strong = scored.find(item => item.score >= CONFIDENCE.high);
  const named = [...match.concepts, ...match.ambiguous.flat()];
  // "open X" is a file request unless X itself names an NMSh feature ("open the palette", not "open this in zed").
  if (strong?.capability.id === 'file.open') {
    const object = matchConcepts(normalizeRequest(argumentText(raw, /^(?:please )?(?:open|edit|show me|view)\s+/iu)));
    if (!object.concepts.length && !object.ambiguous.length) return undefined;
  }
  if (strong && !GENERIC.has(strong.capability.id) && !named.some(concept => concept.overrides?.includes(strong.capability.id))
    && (intent !== 'explain' || strong.capability.safety === 'answer')) return undefined;
  // An ambiguous phrase settles by intent ("open the palette"), else it is the question, unless only broad concepts compete with it.
  const settled: Concept[] = [];
  const open: Concept[][] = [];
  for (const group of match.ambiguous) {
    const preferred = group.filter(concept => concept.prefers?.includes(intent));
    if (preferred.length === 1) settled.push(preferred[0]!); else open.push(group);
  }
  const specific = [...match.concepts, ...settled].filter(concept => !UMBRELLA.has(concept.id));
  if (intent === 'explain') {
    const explained = [...(specific.length ? specific : [...match.concepts, ...settled]), ...open.flat()].filter((concept, index, all) => all.indexOf(concept) === index).slice(0, 3);
    const single = explained.length === 1 ? explained[0]! : undefined;
    const follow = single && single.support !== 'unsupported' && conceptDestination(single) ? {key: `concept:${single.id}`, label: `Open ${single.configure ?? single.open}`, outcome: actOn(single, 'change', text, context, raw)} : undefined;
    return {kind: 'answer', capability: 'help.feature', text: explained.map(concept => explained.length === 1 ? concept.description : `${concept.label}: ${concept.description}`).join('\n'), ...(follow ? {follow} : {})};
  }
  if (open.length && !specific.length) {
    const group = open[0]!;
    const verb = intent === 'off' ? 'turn off' : intent === 'on' ? 'turn on' : intent === 'open' ? 'open' : 'change';
    return {kind: 'choose', reason: 'ambiguous', capability: 'feature.open', question: `What do you want to ${verb}?`,
      options: group.map(concept => ({key: `concept:${concept.id}`, label: concept.label, outcome: actOn(concept, intent, text, context, raw)}))};
  }
  const concept = specific[0] ?? match.concepts[0] ?? settled[0]!;
  return actOn(concept, intent, text, context, raw);
}

/** What Ask does with one concept for one intent: only existing capabilities, NMSh's own slash surfaces, or typed settings. */
function actOn(concept: Concept, intent: ConceptIntent, text: string, context: AskContext, raw: string): AskOutcome {
  if (concept.support === 'unsupported') return {kind: 'unsupported', text: concept.description};
  if ((intent === 'on' || intent === 'off') && concept.toggle) {
    const value = intent === 'on' ? concept.toggle.on : concept.toggle.off;
    return {kind: 'proposal', capability: 'feature.open', safety: 'navigate', confidence: 0.9,
      text: `Turn ${concept.label.split(' /')[0]!.toLowerCase()} ${intent}?`, action: {kind: 'setting', setting: concept.toggle.setting, value, label: `${concept.label}: ${intent === 'on' ? 'On' : 'Off'}`}};
  }
  if (concept.support === 'no-ui') {
    const related = concept.id === 'completion' ? CONCEPT_FOLLOW.suggestions : undefined;
    return {kind: 'answer', capability: 'help.feature', text: `${concept.description} ${concept.where ?? ''}`.trim(),
      ...(related ? {follow: {key: 'concept:suggestions', label: 'Change ghost suggestions instead', outcome: actOn(related, 'change', text, context, raw)}} : {})};
  }
  if (concept.capability && intent !== 'off' && intent !== 'on' && !GENERIC.has(concept.capability)) return build(concept.capability, text, context, raw);
  const target = intent === 'open' ? concept.open ?? concept.configure : concept.configure ?? concept.open;
  const slash = target ? conceptDestination({...concept, open: target}) : undefined;
  if (intent === 'off' || intent === 'on' || concept.support === 'settings') {
    const where = concept.where ?? `${concept.label} is in ${target ?? 'Settings'}.`;
    return {kind: 'answer', capability: 'help.feature', text: where,
      ...(slash ? {follow: {key: `concept:${concept.id}`, label: `Open ${target}`, outcome: navigate('feature.open', `Opening ${target}.`, {kind: 'slash', slash, label: target!})}} : {})};
  }
  if (slash) return navigate('feature.open', `Opening ${target}${concept.where && target === '/providers' ? ` (${concept.label})` : ''}.`, {kind: 'slash', slash, label: target!});
  if (concept.capability) return build(concept.capability, text, context, raw);
  return {kind: 'answer', capability: 'help.feature', text: concept.where ?? concept.description};
}

const CONCEPT_FOLLOW = {get suggestions() { return CONCEPTS_BY_ID.get('suggestions')!; }};

function resolveFile(raw: string, text: string, context: AskContext): AskOutcome {
  const query = argumentText(raw, /^(?:please )?(?:open|edit|show me|view)\s+/iu);
  // "this", "that" and "it" mean the most recent file NMSh saw in output.
  if (/^(?:this|that|it|the last one)?$/iu.test(query)) {
    const recent = context.recentFiles[0];
    if (recent) return openProposal(recent, context);
    return {kind: 'choose', reason: 'missing', capability: 'file.open', question: 'Open which file?', options: []};
  }
  const root = context.repoRoot ?? context.cwd;
  const matches = matchFiles(query, context.files ?? [], context.cwd, root);
  const recent = context.recentFiles.filter(file => basename(file).toLowerCase().includes(query.toLowerCase().replace(/\s+/gu, '')));
  const strong = matches.filter(match => match.score >= 0.88);
  if (strong.length === 1 || (matches.length === 1 && matches[0]!.score >= 0.5)) return openProposal((strong[0] ?? matches[0])!.path, context);
  // Several words that pick one file clearly ("src config") resolve; a single word ("config") asks.
  if (!strong.length && query.trim().split(/\s+/u).length > 1 && matches.length > 1 && matches[0]!.score - matches[1]!.score >= CLEAR_LEAD) return openProposal(matches[0]!.path, context);
  const candidates = [...new Set([...recent, ...(strong.length ? strong : matches).map(match => match.path)])].slice(0, 6);
  if (!candidates.length) {
    // A clear near miss of a real file is offered, never substituted: "Did you mean package.json?"
    const names = (context.files ?? []).map(path => basename(path));
    const near = correctWord(query.toLowerCase().replace(/\s+/gu, ''), names.map(name => name.toLowerCase()));
    const match = near ? (context.files ?? []).find(path => basename(path).toLowerCase() === near) : undefined;
    if (match) {
      const path = `${root}/${match}`;
      return {kind: 'choose', reason: 'missing', capability: 'file.open', question: `No file named "${query}". Did you mean ${displayPath(path, context)}?`,
        options: [{key: `file:${path}`, label: displayPath(path, context), outcome: openProposal(path, context)}]};
    }
    return {kind: 'answer', capability: 'file.open', text: `No file matching "${query}" under ${displayPath(root, context) || root}. /open <path> opens a path directly.`};
  }
  return {kind: 'choose', reason: 'ambiguous', capability: 'file.open', question: `I found ${candidates.length} matches. Which one?`,
    options: candidates.map(path => ({key: `file:${path}`, label: displayPath(path, context), outcome: openProposal(path, context)}))};
}

function resolveWorktree(text: string, context: AskContext, id: CapabilityId): AskOutcome | {path: string} | undefined {
  const others = context.worktrees.filter(item => !item.current);
  const word = (value: string) => new RegExp(`(?:^|[\\s/])${value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[\\s/])`, 'u').test(text);
  const named = context.worktrees.find(item => !item.current && (word(basename(item.path)) || (item.branch && word(item.branch))));
  if (named) return {path: named.path};
  if (!/\bother\b/u.test(text) && !others.length) return undefined;
  if (others.length === 1) return {path: others[0]!.path};
  if (!others.length) return {kind: 'answer', capability: id, text: 'This repository has no other worktrees.'};
  return {kind: 'choose', reason: 'missing', capability: id, question: 'Which worktree?',
    options: others.map(item => ({key: `worktree:${item.path}`, label: `${displayPath(item.path, context)}${item.branch ? `  ${item.branch}` : ''}`,
      outcome: build(id, `${id.replace('git.', 'git ')} worktree ${basename(item.path).toLowerCase()}`, context, '')}))};
}

function resolveTranscript(text: string, context: AskContext): AskOutcome {
  const now = new Date(context.now);
  const yesterday = new Date(context.now - 86_400_000);
  let candidates = context.transcripts;
  let when = '';
  if (/\byesterday|last night\b/u.test(text)) { candidates = candidates.filter(item => sameDay(new Date(item.createdAt), yesterday)); when = ' from yesterday'; }
  else if (/\bthis morning\b/u.test(text)) { candidates = candidates.filter(item => sameDay(new Date(item.createdAt), now) && new Date(item.createdAt).getHours() < 12); when = ' from this morning'; }
  else if (/\btoday\b/u.test(text)) { candidates = candidates.filter(item => sameDay(new Date(item.createdAt), now)); when = ' from today'; }
  if (/\b(?:this|the) (?:repo|repository|project|folder)\b|\bhere\b/u.test(text)) {
    const root = context.repoRoot ?? context.cwd;
    candidates = candidates.filter(item => [item.startCwd, item.finalCwd].some(path => path === root || path.startsWith(`${root}/`)));
    when += ' in this project';
  }
  // A live detached session named by its shell ("the bash one") is a factual match too.
  const shell = shellIn(text);
  const live = context.sessions.filter(session => !session.current && session.state === 'detached' && (!shell || session.shell === shell));
  if (shell && live.length) {
    if (live.length === 1) return {kind: 'proposal', capability: 'session.resume', safety: 'navigate', confidence: 0.9,
      text: `Switch this window to the detached ${shell} session in ${displayPath(live[0]!.cwd, context)}?`, action: {kind: 'attachSession', id: live[0]!.id}};
  }
  if (!/\bresume|restore|reopen|continue|yesterday|morning|today|last|latest|previous\b/u.test(text)) {
    return navigate('session.resume', 'Opening /resume (live sessions and archived transcripts).', {kind: 'slash', slash: {kind: 'resume'}, label: '/resume'});
  }
  if (/\b(?:last|latest|previous|most recent)\b/u.test(text)) candidates = candidates.slice(0, 1);
  if (candidates.length === 1) return resumeProposal(candidates[0]!, context);
  if (!candidates.length) return {kind: 'answer', capability: 'session.resume', text: `No archived transcript${when}. /resume lists them all.`,
    follow: {key: 'open:resume', label: 'Open /resume', outcome: navigate('session.resume', 'Opening /resume.', {kind: 'slash', slash: {kind: 'resume'}, label: '/resume'})}};
  return {kind: 'choose', reason: 'ambiguous', capability: 'session.resume', question: `${candidates.length} transcripts${when}. Which one?`,
    options: candidates.slice(0, 5).map(item => ({key: `transcript:${item.id}`, label: transcriptLabel(item, context), outcome: resumeProposal(item, context)}))};
}

const FAMILY_WORDS: Record<string, string> = {prompt: 'prompt', suggestion: 'suggestions', suggestions: 'suggestions', history: 'history', welcome: 'welcome', picker: 'picker', navigation: 'navigation'};

function providerStatus(text: string, context: AskContext): AskOutcome {
  const family = Object.entries(FAMILY_WORDS).find(([word]) => new RegExp(`\\b${word}\\b`, 'u').test(text))?.[1];
  const active = context.providers.filter(provider => provider.active && (!family || provider.family === family));
  if (!active.length) return {kind: 'answer', capability: 'provider.status', text: 'No provider information is available. /providers lists them.'};
  return {kind: 'answer', capability: 'provider.status', text: active.map(provider => `${provider.family}: ${provider.label}`).join('\n')};
}

function providerSwitch(text: string, context: AskContext): AskOutcome {
  const target = context.providers.find(provider => new RegExp(`\\b${provider.id.toLowerCase()}\\b|\\b${provider.label.toLowerCase().replace(/[^a-z0-9 ]/gu, '')}\\b`, 'u').test(text)
    && !provider.active);
  if (!target) return {kind: 'answer', capability: 'provider.switch', text: 'I couldn\'t match that to a provider NMSh knows. /providers lists them.',
    follow: {key: 'open:providers', label: 'Open /providers', outcome: build('providers.open', '', context, '')}};
  if (!target.available) return {kind: 'answer', capability: 'provider.switch', text: `${target.label} is not installed. /providers can install it with a previewed recipe.`,
    follow: {key: 'open:providers', label: 'Open /providers', outcome: build('providers.open', '', context, '')}};
  return {kind: 'proposal', capability: 'provider.switch', safety: 'navigate', confidence: 0.9, text: `Use ${target.label} for ${target.family}?`,
    action: {kind: 'setting', setting: target.family as 'suggestions', value: target.id, label: `${target.family}: ${target.label}`}};
}

function understanding(text: string, context: AskContext): AskOutcome {
  const mode = /\b(?:off|disable|stop|never|no)\b/u.test(text) ? 'off' : /\balways\b/u.test(text) ? 'always' : /\b(?:on|auto|enable|use|turn on)\b/u.test(text) ? 'auto' : undefined;
  if (!mode) return navigate('understanding.set', 'Opening /llm (Local Intelligence).', {kind: 'slash', slash: {kind: 'llm'}, label: '/llm'});
  return {kind: 'proposal', capability: 'understanding.set', safety: 'navigate', confidence: 0.9,
    text: mode === 'off' ? 'Turn local understanding off? Ask and Smart Folding keep working without a model.' : `Set local understanding to ${mode === 'auto' ? 'Auto' : 'Always'}? It is used only for the features you enable in /providers, and only locally.`,
    action: {kind: 'setting', setting: 'localUnderstanding', value: mode, label: `Local understanding: ${mode}`}};
}

/** Pick an option from a reply: a number, an ordinal, or words that match exactly one label. */
export function pickOption(reply: string, options: readonly AskOption[]): number | undefined {
  const text = normalizeRequest(reply);
  const number = /^(\d+)$/u.exec(text);
  if (number) { const index = Number(number[1]) - 1; return index >= 0 && index < options.length ? index : undefined; }
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const ordinal = ordinals.findIndex(word => new RegExp(`\\b${word}\\b`, 'u').test(text));
  if (ordinal !== -1 && ordinal < options.length) return ordinal;
  if (/\blast\b/u.test(text) && options.length) return options.length - 1;
  const words = text.replace(/\b(?:the|one|please|that|this|use|open|pick)\b/gu, ' ').split(/\s+/u).filter(word => word.length > 1);
  if (!words.length) return undefined;
  const hits = options.map((option, index) => ({index, ok: words.every(word => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(word))})).filter(item => item.ok);
  return hits.length === 1 ? hits[0]!.index : undefined;
}

/** Options whose label contains every typed word: typing narrows a picker. */
export function filterOptions(filter: string, options: readonly AskOption[]): number[] {
  const words = normalizeRequest(filter).split(/\s+/u).filter(Boolean);
  return options.flatMap((option, index) => words.every(word => option.label.toLowerCase().includes(word)) ? [index] : []);
}

/** What the optional model returned, already strictly validated (see understanding/tasks.ts). */
export interface ValidatedInterpretation {
  capability: CapabilityId | null;
  confidence: number;
  arguments: Partial<Record<'shell' | 'target' | 'worktree' | 'when' | 'query' | 'provider', string>>;
}

export const MODEL_CONFIDENCE = 0.6;

/**
 * Typed intents the optional model may choose besides capability ids: each
 * maps to a canonical request NMSh's deterministic resolver already handles,
 * with only bounded arguments (a file name, host, port, branch, script) slotted
 * in and then validated by that resolver. The model never supplies a command.
 */
type IntentArgs = ValidatedInterpretation['arguments'];
const WORD = /^[\w./@:-]{1,80}$/u;
const arg = (value: string | undefined) => value && WORD.test(value) ? value : undefined;
export const MODEL_INTENTS: ReadonlyArray<{id: string; title: string; phrase: (args: IntentArgs) => string | undefined}> = [
  {id: 'files.list', title: 'List the files in this folder or repository', phrase: () => 'list files'},
  {id: 'files.find', title: 'Find files by name (target: name)', phrase: args => arg(args.target) ? `find files named ${arg(args.target)}` : undefined},
  {id: 'files.pick', title: 'Pick a file to open', phrase: () => 'open'},
  {id: 'git.changes', title: 'Show what changed (the diff)', phrase: () => 'show me the diff'},
  {id: 'git.push', title: 'Push the current branch', phrase: () => 'push this branch'},
  {id: 'git.pull', title: 'Pull the current branch', phrase: () => 'pull this branch'},
  {id: 'git.newBranch', title: 'Create a branch (target: name)', phrase: args => arg(args.target) ? `make a new branch called ${arg(args.target)}` : undefined},
  {id: 'git.lastCommit', title: 'Show the last commit', phrase: () => 'what did my last commit do'},
  {id: 'project.dev', title: 'Start the dev server / run the app', phrase: () => 'run the dev server'},
  {id: 'project.test', title: 'Run the tests', phrase: () => 'run the tests'},
  {id: 'project.scripts', title: 'List project scripts', phrase: () => 'what scripts does this project have'},
  {id: 'task.stop', title: 'Stop the background task NMSh started', phrase: () => 'stop the dev server'},
  {id: 'network.ping', title: 'Check a host is reachable (target: host)', phrase: args => arg(args.target) ? `ping ${arg(args.target)}` : undefined},
  {id: 'system.disk', title: 'Disk usage', phrase: () => 'show my disk usage'},
  {id: 'system.memory', title: 'Memory use', phrase: () => 'how much memory am i using'},
  {id: 'process.port', title: 'What is using a port (target: port number)', phrase: args => /^\d{1,5}$/u.test(args.target ?? '') ? `what is using port ${args.target}` : undefined},
  {id: 'process.list', title: 'Running processes (target: optional name)', phrase: args => arg(args.target) ? `show running ${arg(args.target)} processes` : 'show running processes'},
  {id: 'search.text', title: 'Search file contents (query: text)', phrase: args => arg(args.query) ? `grep for ${arg(args.query)}` : undefined},
  {id: 'activity.failed', title: 'What failed recently', phrase: () => 'what\'s broken'},
  {id: 'activity.recent', title: 'What I did recently', phrase: () => 'what have i been doing'},
  {id: 'llm.status', title: 'Local model status', phrase: () => 'show local model status'},
];

/** The capability inventory handed to the model: capabilities plus the typed intents above (ids and titles only). */
export function modelInventory(): Array<{id: string; title: string}> {
  return [...CAPABILITIES.filter(item => item.patterns.length).map(item => ({id: item.id, title: item.title})), ...MODEL_INTENTS.map(item => ({id: item.id, title: item.title}))];
}

/**
 * A typed intent from the model, resolved by the deterministic resolver
 * through its canonical phrase. Undefined when the phrase can't be built from
 * the arguments or the resolver isn't sure either.
 */
export function resolveModelIntent(interpretation: {capability: string | null; confidence: number; arguments: IntentArgs}, context: AskContext, state: ResolveState,
  commands?: CommandEnvironment, files?: FileAssistEnvironment): AskOutcome | undefined {
  if (!interpretation.capability || interpretation.confidence < MODEL_CONFIDENCE) return undefined;
  const intent = MODEL_INTENTS.find(item => item.id === interpretation.capability);
  const phrase = intent?.phrase(interpretation.arguments);
  if (!phrase) return undefined;
  const outcome = resolveRequest(phrase, context, state, commands, files);
  return outcome.kind === 'unclear' ? undefined : outcome;
}

/**
 * Turn a model interpretation into an outcome without trusting it with
 * objects: the capability must exist, and its arguments are words that the
 * deterministic builders resolve against facts (files that exist, real
 * worktrees, sessions, providers). A model cannot introduce a path, session
 * or command; a low-confidence or empty interpretation yields undefined, so
 * the caller keeps the deterministic outcome.
 */
export function resolveWithInterpretation(raw: string, interpretation: ValidatedInterpretation, context: AskContext, state: ResolveState = {}): AskOutcome | undefined {
  const id = interpretation.capability;
  if (!id || interpretation.confidence < MODEL_CONFIDENCE || !CAPABILITIES.some(capability => capability.id === id)) return undefined;
  const args = interpretation.arguments;
  const words = [args.shell, args.worktree ? `worktree ${args.worktree}` : undefined, args.when, args.provider].filter(Boolean).join(' ');
  const text = normalizeRequest(`${raw} ${words}`);
  const phrased = id === 'file.open' && args.target ? `open ${args.target}`
    : id === 'transcript.find' && args.query ? `find ${args.query}`
    : id === 'transcript.filter' && args.query ? `only show lines with ${args.query}`
    : raw;
  const outcome = build(id, text, context, phrased);
  if (outcome.kind === 'proposal' || outcome.kind === 'answer') {
    const option = {key: outcome.capability, label: ''};
    if (state.rejected?.has(option.key)) return undefined;
  }
  return outcome;
}
