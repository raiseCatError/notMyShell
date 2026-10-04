import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {displayWidth, repeatToWidth, truncateAnsi} from '../util/text.js';
import {chatColumn} from '../output/TranscriptPresenter.js';
import {filterOptions, pickOption} from './resolver.js';
import type {AskAction, AskOption, AskOutcome, AskReferents, CommandBlock} from './types.js';
import {renderCommand} from './gitAssist.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {CommandEditor} from '../input/CommandEditor.js';
import {applyEditingKey} from '../input/editingKeys.js';
import {graphemes} from '../input/inputLayout.js';

/**
 * The Ask surface. Each turn advances structured state (pending outcome,
 * options, confirmation, rejected interpretations); the conversation is
 * bounded and in memory only. `/ask` and `/ask <text>` open this same state;
 * with text, the request is submitted at once.
 */
export interface AskTurn {role: 'you' | 'ask'; text: string; block?: CommandBlock}

export interface AskState {
  /** The request being typed: a real editor (caret, selection, word movement), shared with the shell composer. */
  editor: CommandEditor;
  /** The editor's text; assigning replaces it with the caret at the end. */
  input: string;
  turns: AskTurn[];
  pending?: AskOutcome;
  selected: number;
  /** Confirmation choice for a proposal; installs start on No. */
  confirm: 'yes' | 'no';
  rejected: Set<string>;
  /** The request clarifications refine, so a follow-up never starts from zero. */
  original?: string;
  /** Waiting for the resolver. */
  busy: boolean;
  /** Something was actually asked; an empty, abandoned Ask leaves no transcript. */
  submitted: boolean;
  /** Conversation rows scrolled up from the newest (0 follows the conversation). */
  scroll: number;
  /** What the conversation is about (files, command, branch): bounded, in memory only, never recorded. */
  referents?: AskReferents;
  /** The repository the conversation's facts came from, so results refresh the same one. */
  repoRoot?: string;
  /** The outcome a transient completion list replaced, restored once a completion is chosen. */
  previous?: AskOutcome;
  /** An action is running inside Ask ("Running git add…"); input waits until its result turn arrives. */
  working?: string;
}

export type AskEvent =
  | {kind: 'resolve'; text: string}
  | {kind: 'execute'; action: AskAction; outcome: AskOutcome}
  /** Copy or insert a shown command block: never executes. */
  | {kind: 'copy'; block: CommandBlock}
  | {kind: 'insert'; block: CommandBlock}
  /** Tab in a request: complete the path or word at the caret from real files (never runs anything). */
  | {kind: 'complete'; text: string; caret: number}
  | {kind: 'close'};

const MAX_TURNS = 24;
export const ASK_GREETING = 'What can I help you with?';
export const ASK_STARTERS = ['open package.json', 'show my sessions', 'switch to fish', 'check git diff', 'find errors in the transcript', 'resume yesterday\'s session'];

export function createAskState(): AskState {
  const editor = new CommandEditor();
  const state = {editor, turns: [], selected: 0, confirm: 'yes', rejected: new Set(), busy: false, submitted: false, scroll: 0} as unknown as AskState;
  Object.defineProperty(state, 'input', {enumerable: true, get: () => editor.text, set: (value: string) => editor.replaceText(value)});
  return state;
}

/** Actions that change what this window shows or launch something outside NMSh are confirmed first. */
export function needsConfirmation(outcome: AskOutcome): boolean {
  if (outcome.kind !== 'proposal') return false;
  if (outcome.direct && (outcome.safety === 'navigate' || outcome.safety === 'read')) return false;
  if (outcome.action.kind === 'pickFile' || outcome.action.kind === 'taskOutput') return false;
  if (outcome.safety === 'read' || outcome.safety === 'mutate' || outcome.safety === 'install') return true;
  return outcome.action.kind !== 'slash';
}

const NONE: AskOption = {key: 'none', label: 'None of these'};

/** The options on screen for the pending outcome, with None of these where Ask is guessing. */
export function visibleOptions(state: AskState): AskOption[] {
  const pending = state.pending;
  if (!pending) return [];
  const narrowed = (options: AskOption[]) => {
    if (!state.input.trim() || /^\d+$/u.test(state.input.trim())) return options;
    const keep = filterOptions(state.input, options);
    return keep.length ? keep.map(index => options[index]!) : options;
  };
  if (pending.kind === 'choose' && pending.question === COMPLETE_QUESTION) return pending.options;
  if (pending.kind === 'choose') return pending.options.length ? [...narrowed(pending.options), ...(pending.reason === 'ambiguous' ? [NONE] : [])] : [];
  if (pending.kind === 'unclear') return [...narrowed(pending.categories)];
  if ((pending.kind === 'unsafe' || pending.kind === 'unsupported' || pending.kind === 'answer')) {
    const alternative = pending.kind === 'answer' ? pending.follow : pending.alternative;
    const block = pending.kind === 'answer' ? pending.block : undefined;
    const next = pending.kind === 'answer' ? pending.next ?? [] : [];
    return narrowed([...(block ? blockOptions(block) : []), ...(alternative ? [alternative] : []), ...next]);
  }
  return [];
}

/**
 * The actions a shown command offers. Copy and Insert never execute. Run is
 * offered only when NMSh's policy attached a typed action (never for
 * destructive commands, placeholders or a command the person typed
 * themselves), and choosing it only leads to the final Yes/No.
 */
export function blockOptions(block: CommandBlock): AskOption[] {
  const options: AskOption[] = [{key: 'block:copy', label: 'Copy command'}, {key: 'block:insert', label: 'Insert into the composer, unsent'}];
  if (block.run && !block.literal && !block.placeholders?.length && block.risk !== 'destructive') {
    options.push({key: 'block:run', label: block.risk === 'read' ? 'Run it' : 'Run it (you confirm the exact command next)'});
  }
  return options;
}

/** A command block's Run as a proposal: what the final Yes/No confirms. */
export function runProposal(block: CommandBlock, shell: ShellId = 'zsh'): AskOutcome | undefined {
  if (!block.run || block.literal || block.placeholders?.length || block.risk === 'destructive') return undefined;
  // A file edit's diff and command are already on screen; the final question names the file.
  if (block.run.kind === 'applyEdit') {
    return {kind: 'proposal', capability: 'file.open', safety: 'mutate', confidence: 0.95, text: `Apply this edit to ${block.run.plan.path}?`, action: block.run};
  }
  if (block.run.kind === 'format') {
    return {kind: 'proposal', capability: 'file.open', safety: 'mutate', confidence: 0.95, text: 'Run this formatter? It rewrites the file.', command: renderCommand(block, shell), action: block.run};
  }
  if (block.run.kind === 'project' || block.run.kind === 'startTask') {
    return {kind: 'proposal', capability: 'project.run', safety: 'mutate', confidence: 0.95, text: block.run.kind === 'startTask' ? 'Start this in the background?' : 'Run this in the shell?',
      command: renderCommand(block, shell), action: block.run};
  }
  if (block.run.kind === 'recipe') {
    return {kind: 'proposal', capability: 'help.command', safety: 'read', confidence: 0.95, text: block.run.risk === 'network' ? 'Run this? It contacts the network.' : 'Run this read-only command?',
      command: renderCommand(block, shell), action: block.run};
  }
  return {kind: 'proposal', capability: 'git.status', safety: block.risk === 'read' ? 'read' : 'mutate', confidence: 0.95,
    text: block.risk === 'read' ? 'Run this read-only command?' : 'Run this command? It changes your repository.', command: renderCommand(block, shell), action: block.run};
}

/** Record a resolver outcome as the next Ask turn. */
export function receiveOutcome(state: AskState, outcome: AskOutcome): AskEvent | undefined {
  state.busy = false;
  state.pending = outcome;
  const referents = outcome.kind === 'answer' || outcome.kind === 'unsafe' || outcome.kind === 'proposal' || outcome.kind === 'choose' ? outcome.referents : undefined;
  if (referents) state.referents = {...state.referents, ...referents};
  state.selected = 0;
  state.input = '';
  const text = outcome.kind === 'choose' ? outcome.question : outcome.text;
  pushTurn(state, 'ask', outcome.kind === 'proposal' && outcome.command ? `${text}\n  ${outcome.command}` : text, outcome.kind === 'answer' ? outcome.block : undefined);
  if (outcome.kind === 'answer' && outcome.block) state.referents = {...state.referents, block: outcome.block};
  if (outcome.kind === 'proposal') {
    // Anything that changes state starts on No; reads and NMSh navigation start on Yes.
    state.confirm = outcome.safety === 'install' || outcome.safety === 'mutate' ? 'no' : 'yes';
    // Plain navigation inside NMSh is obviously harmless and needs no extra Yes.
    if (!needsConfirmation(outcome)) return {kind: 'execute', action: outcome.action, outcome};
  }
  return undefined;
}

export function pushTurn(state: AskState, role: AskTurn['role'], text: string, block?: CommandBlock): void {
  state.turns.push({role, text, ...(block ? {block} : {})});
  if (state.turns.length > MAX_TURNS) state.turns.splice(0, state.turns.length - MAX_TURNS);
}

/** Submit text: a new request, a reply that picks an option, or a clarification of the original request. */
export function submitText(state: AskState, text: string): AskEvent | undefined {
  const reply = text.trim();
  if (!reply) return undefined;
  pushTurn(state, 'you', reply);
  // Sending returns to the newest exchange.
  state.scroll = 0;
  state.submitted = true;
  state.input = '';
  const pending = state.pending;
  if (pending?.kind === 'proposal' && needsConfirmation(pending)) {
    if (/^(?:y|yes|ok|sure|do it|go)$/iu.test(reply)) return confirmProposal(state, 'yes');
    if (/^(?:n|no|cancel|don't|dont|stop)$/iu.test(reply)) return confirmProposal(state, 'no');
  }
  // "copy it", "insert that", "run it": the command block this conversation is about.
  const block = state.referents?.block;
  if (block && /^(?:please )?(?:copy|insert|paste|run|execute|do) (?:it|that|this|the command|that command)(?: please)?$/iu.test(reply)) {
    const verb = reply.toLowerCase().replace(/^please /u, '').split(' ')[0]!;
    if (verb === 'copy') return {kind: 'copy', block};
    if (verb === 'insert' || verb === 'paste') return {kind: 'insert', block};
    const proposal = runProposal(block);
    if (proposal) return receiveOutcome(state, proposal);
    pushTurn(state, 'ask', block.risk === 'destructive' ? 'Ask won\'t run that: it is destructive. Copy or insert it to run it yourself.' : 'That command can\'t be run from Ask; copy or insert it instead.');
    return undefined;
  }
  const options = visibleOptions(state);
  if (options.length) {
    const index = pickOption(reply, options);
    if (index !== undefined) return chooseOption(state, options[index]!, options);
  }
  // "what does that command do": the shown command's own path.
  if (block && /\b(?:that|this|the) command\b/iu.test(reply) && /\b(?:what|explain|how)\b/iu.test(reply) && !block.literal) {
    state.busy = true;
    return {kind: 'resolve', text: `what does ${block.argv.slice(0, block.argv[0] === 'git' ? 2 : 1).join(' ')} do`};
  }
  // A follow-up keeps the original request: "open the old config" + "the bash one".
  const clarifying = pending && (pending.kind === 'choose' || pending.kind === 'unclear');
  if (!state.original || !clarifying) state.original = reply;
  state.busy = true;
  return {kind: 'resolve', text: clarifying ? `${state.original} ${reply}` : reply};
}

function chooseOption(state: AskState, option: AskOption, shown: AskOption[]): AskEvent | undefined {
  const block = state.pending?.kind === 'answer' ? state.pending.block : undefined;
  if (block && option.key === 'block:copy') return {kind: 'copy', block};
  if (block && option.key === 'block:insert') return {kind: 'insert', block};
  if (block && option.key === 'block:run') {
    // Choosing Run selects the action; anything that changes state still needs the final Yes/No.
    const proposal = runProposal(block);
    return proposal ? receiveOutcome(state, proposal) : undefined;
  }
  if (option.key === 'none') {
    // Remember the rejection for this interaction only; ask for more detail.
    for (const item of shown) if (item.key !== 'none') state.rejected.add(item.key);
    state.pending = undefined;
    pushTurn(state, 'ask', 'None of those, then. Tell me a little more about what you want.');
    return undefined;
  }
  if (option.fill !== undefined) { state.input = option.fill; state.pending = state.previous; state.previous = undefined; return undefined; }
  if (option.outcome) return receiveOutcome(state, option.outcome);
  if (option.refine !== undefined) {
    if (option.refine.endsWith(' ')) { state.input = option.refine; state.pending = undefined; return undefined; }
    state.original = option.refine;
    state.busy = true;
    return {kind: 'resolve', text: option.refine};
  }
  return undefined;
}

function confirmProposal(state: AskState, choice: 'yes' | 'no'): AskEvent | undefined {
  const pending = state.pending;
  if (pending?.kind !== 'proposal') return undefined;
  if (choice === 'yes') return {kind: 'execute', action: pending.action, outcome: pending};
  pushTurn(state, 'ask', 'Okay, nothing was done.');
  state.pending = undefined;
  return undefined;
}

export function askKey(state: AskState, key: Key, columnsHint = 80): AskEvent | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (state.busy || state.working) return undefined;
  const pending = state.pending;
  const options = visibleOptions(state);
  const confirming = pending?.kind === 'proposal' && needsConfirmation(pending);
  if (key.kind === 'text' && confirming && !state.input && /^[yn]$/iu.test(key.value)) return confirmProposal(state, key.value.toLowerCase() === 'y' ? 'yes' : 'no');
  // The editor wins whenever there is text to edit: ←→ move the caret, never the choice.
  const empty = !state.input;
  if ((key.kind === 'left' || key.kind === 'right') && empty && confirming) { state.confirm = state.confirm === 'yes' ? 'no' : 'yes'; return undefined; }
  if ((key.kind === 'up' || key.kind === 'down' || ((key.kind === 'left' || key.kind === 'right') && empty)) && options.length) {
    const back = key.kind === 'up' || key.kind === 'left';
    state.selected = (state.selected + (back ? -1 : 1) + options.length) % options.length;
    return undefined;
  }
  const completing = pending?.kind === 'choose' && pending.question === COMPLETE_QUESTION;
  if (completing && key.kind === 'enter' && options.length) return chooseOption(state, options[state.selected]!, options);
  if (key.kind === 'complete') return state.input.trim() ? {kind: 'complete', text: state.input, caret: state.editor.cursorIndex} : undefined;
  if (applyEditingKey(state.editor, key, Math.max(20, columnsHint - 6))) {
    // Editing dismisses a completion list; the conversation's own choices come back.
    if (completing) { state.pending = state.previous; state.previous = undefined; }
    if (key.kind !== 'left' && key.kind !== 'right' && !key.kind.startsWith('select') && !key.kind.startsWith('word') && !key.kind.startsWith('line') && !key.kind.startsWith('buffer')) state.selected = 0;
    return undefined;
  }
  // The conversation scrolls; the title, choices, input and controls stay put.
  if (key.kind === 'pageUp' || key.kind === 'wheelUp') { state.scroll += key.kind === 'pageUp' ? ASK_PAGE : 3; return undefined; }
  if (key.kind === 'pageDown' || key.kind === 'wheelDown') { state.scroll = Math.max(0, state.scroll - (key.kind === 'pageDown' ? ASK_PAGE : 3)); return undefined; }
  if (key.kind === 'enter') {
    if (state.input.trim()) return submitText(state, state.input);
    if (confirming) return confirmProposal(state, state.confirm);
    if (options.length) {
      if (options[state.selected]!.fill !== undefined) return chooseOption(state, options[state.selected]!, options);
      pushTurn(state, 'you', options[state.selected]!.label);
      state.submitted = true;
      state.scroll = 0;
      return chooseOption(state, options[state.selected]!, options);
    }
  }
  return undefined;
}

/** The visible conversation as transcript text (the first request is the command line). Never model data. */
export function askTranscriptText(state: AskState, shell: ShellId = 'zsh'): {request: string; body: string; turns: AskTurn[]} | undefined {
  if (!state.submitted) return undefined;
  const first = state.turns.findIndex(turn => turn.role === 'you');
  if (first === -1) return undefined;
  // Only the visible role and text are kept: no outcomes, options, rejected keys or model data.
  const turns = state.turns.slice(first + 1).map(turn => ({role: turn.role, text: turn.block ? `${turn.text}\n  ${turn.block.literal ?? turn.block.script ?? renderCommand(turn.block, shell)}` : turn.text}));
  const body = turns.map(turn => `${turn.role === 'you' ? 'You' : 'Ask'}: ${turn.text}`).join('\n');
  return {request: state.turns[first]!.text, body, turns};
}

/** Word wrap by display width; long words are left for truncation. */
function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/(\s+)/u)) {
    if (line && displayWidth(line + word) > width && word.trim()) { lines.push(line.trimEnd()); line = word.trimStart(); }
    else line += word;
  }
  lines.push(line.trimEnd());
  return lines;
}

const ASK_PAGE = 8;

/** How Ask lays out its conversation: Chat puts your turns on the right; Normal keeps both on the left. */
export type AskPresentation = 'chat' | 'normal';
export const ASK_PRESENTATIONS: readonly AskPresentation[] = ['chat', 'normal'];
export const ASK_PRESENTATION_LABELS: Record<AskPresentation, string> = {chat: 'Chat', normal: 'Normal'};

export interface AskRenderOptions {
  presentation?: AskPresentation;
  /** The active shell, for quoting shown commands. */
  shell?: ShellId;
  /** Rows the panel may use; the conversation gets what the pinned rows leave. */
  height?: number;
  /** The live activity line while Ask works (already styled; transient, never recorded). */
  activity?: string;
}

/** The conversation as exchanges: each of your turns opens one, and Ask's replies belong to it. */
export function askExchanges(turns: readonly AskTurn[]): AskTurn[][] {
  const exchanges: AskTurn[][] = [];
  for (const turn of turns) {
    if (turn.role === 'you' || !exchanges.length) exchanges.push([]);
    exchanges[exchanges.length - 1]!.push(turn);
  }
  return exchanges;
}

/** Conversation rows (no pinned chrome): role-labelled turns, your turns on the right in Chat, a faint rule between exchanges. */
export function askConversationRows(turns: readonly AskTurn[], columns: number, presentation: AskPresentation = 'chat', shell: ShellId = 'zsh'): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const rule = foreground(UI_COLORS.separator);
  const reset = '\u001b[0m';
  const inner = Math.max(20, columns - 4);
  const column = presentation === 'chat' ? chatColumn(inner) : undefined;
  const rows: string[] = [];
  askExchanges(turns).forEach((exchange, index) => {
    if (index > 0) rows.push(`  ${rule}${repeatToWidth('─', inner)}${reset}`);
    for (const turn of exchange) {
      const you = turn.role === 'you';
      if (you && column) {
        // Right-aligned block: its widest wrapped line sets the left edge, the label sits on that edge's right.
        const lines = turn.text.split('\n').flatMap(line => wrapText(line, column));
        const widest = Math.max(3, ...lines.map(line => displayWidth(line)));
        const left = 2 + inner - widest;
        rows.push(`${' '.repeat(left + widest - 3)}${subtle}You${reset}`);
        for (const line of lines) rows.push(`${' '.repeat(left + widest - displayWidth(line))}${primary}${line}${reset}`);
      } else {
        rows.push(`  ${you ? subtle : accent}${you ? 'You' : 'Ask'}${reset}`);
        for (const line of turn.text.split('\n').flatMap(part => wrapText(part, inner))) rows.push(`  ${you ? primary : secondary}${line}${reset}`);
        if (turn.block) rows.push(...commandBlockRows(turn.block, inner, shell));
      }
    }
  });
  return rows;
}

/** A shown command: on its own indented line (not buried in prose), its note, and the facts that filled it. */
export function commandBlockRows(block: CommandBlock, width: number, shell: ShellId = 'zsh'): string[] {
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const reset = '\u001b[0m';
  const command = block.literal ?? block.script ?? renderCommand(block, shell);
  const rows = ['', ...wrapText(command, width - 4).map(line => `    ${primary}${line}${reset}`)];
  if (block.note) rows.push(...wrapText(block.note, width - 4).map(line => `    ${subtle}${line}${reset}`));
  if (block.facts?.length) rows.push(`    ${subtle}${block.facts.map(([key, value]) => `${key} ${value}`).join(' · ')}${reset}`);
  if (block.risk === 'destructive') rows.push(`    ${subtle}Destructive: Ask won't run it; copy or insert it to run it yourself.${reset}`);
  return [...rows, ''];
}

export function renderAsk(state: AskState, columns: number, options: AskRenderOptions = {}): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const top = [`${primary}  Ask NMSh${reset}`, ''];
  const conversation = state.turns.length ? askConversationRows(state.turns, columns, options.presentation ?? 'chat', options.shell)
    : [`  ${secondary}${ASK_GREETING}${reset}`, ...(state.pending ? [] : ['', `  ${subtle}For example: ${ASK_STARTERS.slice(0, 4).join(' · ')}${reset}`])];
  // Choices and confirmations belong to the newest Ask reply: they follow it directly.
  const bottom: string[] = [];
  const choices = visibleOptions(state);
  const pending = state.pending;
  const confirming = pending?.kind === 'proposal' && needsConfirmation(pending);
  if (choices.length) {
    bottom.push('');
    choices.forEach((option, index) => {
      const selected = index === state.selected;
      const number = option.key === 'none' ? ' ' : String(index + 1);
      bottom.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${subtle}${number}${reset}  ${selected ? primary : secondary}${option.label}${reset}${option.detail ? `  ${subtle}${option.detail}${reset}` : ''}`);
    });
  } else if (confirming) {
    const yes = pending.safety === 'read' ? 'Run' : pending.safety === 'install' ? 'Install' : 'Yes';
    bottom.push('', `  ${state.confirm === 'yes' ? `${accent}[ Y ${yes} ]${reset}` : `${subtle}  Y ${yes}  ${reset}`}   ${state.confirm === 'no' ? `${accent}[ N Don't ]${reset}` : `${subtle}  N Don't  ${reset}`}`);
  }
  bottom.push('', ...(state.working ? [`  ${subtle}${state.working}${reset}`] : askInputRows(state, columns - 4, options.activity)));
  // The footer lists only what works right now.
  const controls: Array<[string, string]> = [['Enter', 'send']];
  if (choices.length || confirming) controls.push(['←→/↑↓', 'choose']);
  const room = options.height === undefined ? Infinity : Math.max(3, options.height - top.length - bottom.length - 2);
  const overflow = conversation.length > room;
  if (overflow) controls.push(['PgUp/PgDn', 'scroll']);
  controls.push(['Esc', 'close']);
  let visible = conversation;
  if (overflow) {
    // Offset from the newest row: redraws keep the reader's place; a resize clamps it.
    state.scroll = Math.max(0, Math.min(state.scroll, conversation.length - (room - 2)));
    const span = room - 1 - (state.scroll > 0 ? 1 : 0);
    const end = conversation.length - state.scroll;
    const start = Math.max(0, end - span);
    visible = [start ? `  ${subtle}↑ ${start} earlier row${start === 1 ? '' : 's'} · PgUp${reset}` : '', ...conversation.slice(start, end),
      ...(state.scroll > 0 ? [`  ${subtle}↓ ${state.scroll} newer row${state.scroll === 1 ? '' : 's'} · PgDn${reset}`] : [])];
  } else state.scroll = 0;
  return [...top, ...visible, ...bottom, '', renderControls(controls)].map(row => truncateAnsi(row, columns));
}

/**
 * The Ask input as rows: the text with its real caret and selection (inverse),
 * multiline text on its own rows. While Ask resolves, a live activity line
 * replaces the caret (supplied by the app from the shared activity clock).
 */
export function askInputRows(state: AskState, width: number, activity?: string): string[] {
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  if (state.busy) return [`  ${accent}›${reset} ${primary}${state.input.split('\n')[0]}${reset}`, ...(activity ? [`  ${activity}`] : [])];
  const chars = graphemes(state.editor.text);
  const caret = state.editor.cursorIndex;
  const selection = state.editor.selection;
  const rows: string[] = [];
  let row = '';
  let rowWidth = 0;
  const flush = () => { rows.push(row); row = ''; rowWidth = 0; };
  for (let index = 0; index <= chars.length; index += 1) {
    if (index === caret && !selection) row += `${reset}\u001b[7m${index < chars.length && chars[index] !== '\n' ? chars[index] : ' '}\u001b[27m${primary}`;
    if (index === chars.length) break;
    const char = chars[index]!;
    if (char === '\n') { if (index === caret && !selection) { /* caret drawn as a space above */ } flush(); continue; }
    if (index === caret && !selection) { rowWidth += displayWidth(char); continue; }
    const selected = selection && index >= selection.start && index < selection.end;
    row += selected ? `\u001b[7m${char}\u001b[27m` : char;
    rowWidth += displayWidth(char);
    if (rowWidth >= width) flush();
  }
  rows.push(row);
  return rows.map((line, index) => `  ${index === 0 ? `${accent}›${reset}` : `${subtle}·${reset}`} ${primary}${line}${reset}`);
}

/**
 * Apply a path completion to the Ask input: the unique or common part is
 * typed in; when several remain they are offered as a transient list (↑↓,
 * Enter fills, typing narrows). Choosing never sends or opens anything.
 */
export function applyAskCompletion(state: AskState, completion: {text: string; caret: number; candidates: Array<{value: string; directory: boolean}>}): void {
  state.editor.replaceText(completion.text);
  state.editor.setCursor(completion.caret);
  if (!completion.candidates.length) return;
  const before = [...completion.text].slice(0, completion.caret).join('');
  const word = /(\S*)$/u.exec(before)?.[1] ?? '';
  const head = before.slice(0, before.length - word.length);
  const tail = [...completion.text].slice(completion.caret).join('');
  if (state.pending?.kind !== 'choose' || state.pending.question !== COMPLETE_QUESTION) state.previous = state.pending;
  state.pending = {kind: 'choose', reason: 'missing', question: COMPLETE_QUESTION,
    options: completion.candidates.map(candidate => ({key: `path:${candidate.value}`, label: candidate.value, detail: candidate.directory ? 'folder' : undefined,
      fill: `${head}${candidate.value}${candidate.directory ? '' : ' '}${tail.replace(/^ /u, '')}`}))} as AskOutcome;
  state.selected = 0;
}
const COMPLETE_QUESTION = 'Complete the path';
