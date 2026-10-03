import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
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
}

export type AskEvent =
  | {kind: 'resolve'; text: string}
  | {kind: 'execute'; action: AskAction; outcome: AskOutcome}
  | {kind: 'close'};

const MAX_TURNS = 24;
export const ASK_GREETING = 'What can I help you with?';
export const ASK_STARTERS = ['open package.json', 'show my sessions', 'switch to fish', 'check git diff', 'find errors in the transcript', 'resume yesterday\'s session'];

export function createAskState(): AskState {
  return {input: '', turns: [], selected: 0, confirm: 'yes', rejected: new Set(), busy: false, submitted: false};
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
  if ((key.kind === 'up' || key.kind === 'down') && options.length) {
    state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + options.length) % options.length;
    return undefined;
  }
  if (key.kind === 'enter') {
    if (state.input.trim()) return submitText(state, state.input);
    if (confirming) return confirmProposal(state, state.confirm);
    if (options.length) {
      pushTurn(state, 'you', options[state.selected]!.label);
      state.submitted = true;
      return chooseOption(state, options[state.selected]!, options);
    }
  }
  return undefined;
}

/** The visible conversation as transcript text (the first request is the command line). Never model data. */
export function askTranscriptText(state: AskState): {request: string; body: string} | undefined {
  if (!state.submitted) return undefined;
  const first = state.turns.findIndex(turn => turn.role === 'you');
  if (first === -1) return undefined;
  const body = state.turns.slice(first + 1).map(turn => `${turn.role === 'you' ? 'You' : 'Ask'}: ${turn.text}`).join('\n');
  return {request: state.turns[first]!.text, body};
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

export function renderAsk(state: AskState, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const width = Math.max(20, columns - 6);
  const rows = [`${primary}  Ask NMSh${reset}`, ''];
  const wrap = (text: string, indent: string, color: string) => text.split('\n').flatMap(line => wrapText(line, width).map(part => `${indent}${color}${part}${reset}`));
  if (!state.turns.length) {
    rows.push(`  ${secondary}${ASK_GREETING}${reset}`, '', `  ${subtle}For example: ${ASK_STARTERS.slice(0, 4).join(' · ')}${reset}`);
  }
  for (const turn of state.turns.slice(-10)) {
    rows.push(`  ${subtle}${turn.role === 'you' ? 'You' : 'Ask'}${reset}`);
    rows.push(...wrap(turn.text, '    ', turn.role === 'you' ? primary : secondary));
  }
  const options = visibleOptions(state);
  const pending = state.pending;
  if (options.length) {
    rows.push('');
    options.forEach((option, index) => {
      const selected = index === state.selected;
      const number = option.key === 'none' ? ' ' : String(index + 1);
      rows.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${subtle}${number}${reset}  ${selected ? primary : secondary}${option.label}${reset}${option.detail ? `  ${subtle}${option.detail}${reset}` : ''}`);
    });
    rows.push('', `  ${subtle}Type a number, keep typing to narrow or clarify, or Esc to cancel.${reset}`);
  } else if (pending?.kind === 'proposal' && needsConfirmation(pending)) {
    const yes = pending.safety === 'read' ? 'Run' : pending.safety === 'install' ? 'Install' : 'Yes';
    rows.push('', `  ${state.confirm === 'yes' ? `${accent}[ Y ${yes} ]${reset}` : `${subtle}  Y ${yes}  ${reset}`}   ${state.confirm === 'no' ? `${accent}[ N Don't ]${reset}` : `${subtle}  N Don't  ${reset}`}`);
  }
  rows.push('', `  ${accent}›${reset} ${primary}${state.input}${reset}${state.busy ? `  ${subtle}…${reset}` : `${accent}▏${reset}`}`);
  rows.push('', renderControls([['Enter', 'send'], ['↑↓', 'choose'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
