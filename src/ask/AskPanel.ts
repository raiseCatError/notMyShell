import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {displayWidth, repeatToWidth, truncateAnsi} from '../util/text.js';
import {chatColumn} from '../output/TranscriptPresenter.js';
import {filterOptions, pickOption} from './resolver.js';
import type {AskAction, AskOption, AskOutcome} from './types.js';

/**
 * The Ask surface. Each turn advances structured state (pending outcome,
 * options, confirmation, rejected interpretations); the conversation is
 * bounded and in memory only. `/ask` and `/ask <text>` open this same state;
 * with text, the request is submitted at once.
 */
export interface AskTurn {role: 'you' | 'ask'; text: string}

export interface AskState {
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
}

export type AskEvent =
  | {kind: 'resolve'; text: string}
  | {kind: 'execute'; action: AskAction; outcome: AskOutcome}
  | {kind: 'close'};

const MAX_TURNS = 24;
export const ASK_GREETING = 'What can I help you with?';
export const ASK_STARTERS = ['open package.json', 'show my sessions', 'switch to fish', 'check git diff', 'find errors in the transcript', 'resume yesterday\'s session'];

export function createAskState(): AskState {
  return {input: '', turns: [], selected: 0, confirm: 'yes', rejected: new Set(), busy: false, submitted: false, scroll: 0};
}

/** Actions that change what this window shows or launch something outside NMSh are confirmed first. */
export function needsConfirmation(outcome: AskOutcome): boolean {
  if (outcome.kind !== 'proposal') return false;
  if (outcome.safety === 'read' || outcome.safety === 'install') return true;
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
  if (pending.kind === 'choose') return pending.options.length ? [...narrowed(pending.options), ...(pending.reason === 'ambiguous' ? [NONE] : [])] : [];
  if (pending.kind === 'unclear') return [...narrowed(pending.categories)];
  if ((pending.kind === 'unsafe' || pending.kind === 'unsupported' || pending.kind === 'answer')) {
    const alternative = pending.kind === 'answer' ? pending.follow : pending.alternative;
    return alternative ? [alternative] : [];
  }
  return [];
}

/** Record a resolver outcome as the next Ask turn. */
export function receiveOutcome(state: AskState, outcome: AskOutcome): AskEvent | undefined {
  state.busy = false;
  state.pending = outcome;
  state.selected = 0;
  state.input = '';
  const text = outcome.kind === 'choose' ? outcome.question : outcome.text;
  pushTurn(state, 'ask', outcome.kind === 'proposal' && outcome.command ? `${text}\n  ${outcome.command}` : text);
  if (outcome.kind === 'proposal') {
    state.confirm = outcome.safety === 'install' ? 'no' : 'yes';
    // Plain navigation inside NMSh is obviously harmless and needs no extra Yes.
    if (!needsConfirmation(outcome)) return {kind: 'execute', action: outcome.action, outcome};
  }
  return undefined;
}

function pushTurn(state: AskState, role: AskTurn['role'], text: string): void {
  state.turns.push({role, text});
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
  const options = visibleOptions(state);
  if (options.length) {
    const index = pickOption(reply, options);
    if (index !== undefined) return chooseOption(state, options[index]!, options);
  }
  // A follow-up keeps the original request: "open the old config" + "the bash one".
  const clarifying = pending && (pending.kind === 'choose' || pending.kind === 'unclear');
  if (!state.original || !clarifying) state.original = reply;
  state.busy = true;
  return {kind: 'resolve', text: clarifying ? `${state.original} ${reply}` : reply};
}

function chooseOption(state: AskState, option: AskOption, shown: AskOption[]): AskEvent | undefined {
  if (option.key === 'none') {
    // Remember the rejection for this interaction only; ask for more detail.
    for (const item of shown) if (item.key !== 'none') state.rejected.add(item.key);
    state.pending = undefined;
    pushTurn(state, 'ask', 'None of those, then. Tell me a little more about what you want.');
    return undefined;
  }
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

export function askKey(state: AskState, key: Key): AskEvent | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (state.busy) return undefined;
  const pending = state.pending;
  const options = visibleOptions(state);
  const confirming = pending?.kind === 'proposal' && needsConfirmation(pending);
  if (key.kind === 'text') {
    if (confirming && !state.input && /^[yn]$/iu.test(key.value)) return confirmProposal(state, key.value.toLowerCase() === 'y' ? 'yes' : 'no');
    state.input += key.value.replace(/[\u0000-\u001f\u007f]/gu, '');
    state.selected = 0;
    return undefined;
  }
  if (key.kind === 'paste') { state.input += key.value.replace(/[\u0000-\u001f\u007f]+/gu, ' '); return undefined; }
  if (key.kind === 'backspace') { state.input = [...state.input].slice(0, -1).join(''); state.selected = 0; return undefined; }
  if ((key.kind === 'left' || key.kind === 'right') && confirming && !state.input) { state.confirm = state.confirm === 'yes' ? 'no' : 'yes'; return undefined; }
  // ←→ and ↑↓ both move through choices, as elsewhere in NMSh.
  if ((key.kind === 'up' || key.kind === 'down' || ((key.kind === 'left' || key.kind === 'right') && !state.input)) && options.length) {
    const back = key.kind === 'up' || key.kind === 'left';
    state.selected = (state.selected + (back ? -1 : 1) + options.length) % options.length;
    return undefined;
  }
  // The conversation scrolls; the title, choices, input and controls stay put.
  if (key.kind === 'pageUp' || key.kind === 'wheelUp') { state.scroll += key.kind === 'pageUp' ? ASK_PAGE : 3; return undefined; }
  if (key.kind === 'pageDown' || key.kind === 'wheelDown') { state.scroll = Math.max(0, state.scroll - (key.kind === 'pageDown' ? ASK_PAGE : 3)); return undefined; }
  if (key.kind === 'enter') {
    if (state.input.trim()) return submitText(state, state.input);
    if (confirming) return confirmProposal(state, state.confirm);
    if (options.length) {
      pushTurn(state, 'you', options[state.selected]!.label);
      state.submitted = true;
      state.scroll = 0;
      return chooseOption(state, options[state.selected]!, options);
    }
  }
  return undefined;
}

/** The visible conversation as transcript text (the first request is the command line). Never model data. */
export function askTranscriptText(state: AskState): {request: string; body: string; turns: AskTurn[]} | undefined {
  if (!state.submitted) return undefined;
  const first = state.turns.findIndex(turn => turn.role === 'you');
  if (first === -1) return undefined;
  // Only the visible role and text are kept: no outcomes, options, rejected keys or model data.
  const turns = state.turns.slice(first + 1).map(turn => ({role: turn.role, text: turn.text}));
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
  /** Rows the panel may use; the conversation gets what the pinned rows leave. */
  height?: number;
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
export function askConversationRows(turns: readonly AskTurn[], columns: number, presentation: AskPresentation = 'chat'): string[] {
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
      }
    }
  });
  return rows;
}

export function renderAsk(state: AskState, columns: number, options: AskRenderOptions = {}): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const top = [`${primary}  Ask NMSh${reset}`, ''];
  const conversation = state.turns.length ? askConversationRows(state.turns, columns, options.presentation ?? 'chat')
    : [`  ${secondary}${ASK_GREETING}${reset}`, '', `  ${subtle}For example: ${ASK_STARTERS.slice(0, 4).join(' · ')}${reset}`];
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
  bottom.push('', `  ${accent}›${reset} ${primary}${state.input}${reset}${state.busy ? `  ${subtle}…${reset}` : `${accent}▏${reset}`}`);
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
