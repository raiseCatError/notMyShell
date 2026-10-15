import type {AgentSession} from '../sessions/model.js';
import type {AgentViewMeta, AgentViewState} from '../sessions/AgentViews.js';
import {displayText, projectObject} from './projection.js';
import {displayWidth, repeatToWidth, truncateAnsi, truncateText} from '../../util/text.js';
import {harness} from '../harnesses.js';
import {hexColor, targetStatus} from '../launcher.js';
import {getCurrentGlyphMode, GLYPHS} from '../../ui/glyphs.js';
import {foreground, UI_COLORS, type RgbColor} from '../../ui/palette.js';
import {renderControlRows, renderControls} from '../../ui/controls.js';
import {colorLevel} from '../../presentation/capabilities.js';
import {layoutInput} from '../../input/inputLayout.js';
import {chatColumn} from '../../output/TranscriptPresenter.js';
import {visibleRows, type PickerState} from '../input/pickers.js';
import {currentModel, effortStatus, modelName} from '../telemetry.js';

/** How the host draws the view: the transcript presentation and composer side it already uses, and whether it shows the terminal's own caret. */
export interface AgentViewOptions {
  presentation?: 'normal' | 'chat';
  composerPosition?: 'top' | 'bottom';
  /** The host places the terminal cursor at {@link AgentViewLayout.caret}; no caret glyph is drawn. */
  hardwareCaret?: boolean;
  /** Filled in by the renderer: where the insertion caret is, in the returned rows. */
  layout?: AgentViewLayout;
}
export interface AgentViewLayout { caret?: {row: number; column: number} }

const RESET = '\u001b[0m';
/** A line already built from scrubbed parts and styled by NMSh; every other line is scrubbed when emitted. */
type Styled = {styled: string};
type Line = string | Styled;

/** What the person is doing in the view, in words; the default (writing to the agent) needs no label. */
const OWNER_WORDS: Partial<Record<string, string>> = {TRANSCRIPT: 'Reviewing the conversation', APPROVAL: 'Permission request', CHOICE: 'Question', PICKER: 'Choosing'};

/** Hanging indent of the conversation: text starts here; turn markers sit in the gutter before it. */
const INDENT = 2;
/** Draft rows shown in the composer before earlier rows collapse into a count. */
const DRAFT_LINES = 5;
/** Marks the caret inside a draft while it is wrapped; a private-use character never present in scrubbed text. */
const CARET = '';

const safe = () => getCurrentGlyphMode() === 'safe';
const paint = (color: RgbColor) => foreground(color);
const marks = () => safe()
  ? {you: '>', tool: '-', attention: '!', caret: '_', ellipsis: '...', rule: '-'}
  : {you: '›', tool: '▸', attention: '◆', caret: '▏', ellipsis: '…', rule: GLYPHS.separator};

/** The person's home reads as `~` (display only). */
function homeRelative(path: string): string {
  const home = process.env.HOME;
  if (home && home !== '/' && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path.replace(/^\/(?:Users|home)\/[^/]+/u, '~');
}

/** Keep the end of a path (the project) when it must shorten: `…/Projects/demo`. */
function truncateStart(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  const mark = marks().ellipsis;
  if (width <= displayWidth(mark)) return truncateText(text, width);
  const characters = [...text];
  let tail = '';
  while (characters.length && displayWidth(characters.at(-1)! + tail) <= width - displayWidth(mark)) tail = characters.pop()! + tail;
  return mark + tail;
}

/** Word wrap with hard breaks for words wider than the line; widths are display cells. Input must already be scrubbed. */
function wrapCells(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (!word) continue;
      if (displayWidth(line + word) <= max) { line += word; continue; }
      if (!word.trim()) { out.push(line.trimEnd()); line = ''; continue; }
      if (line.trim()) out.push(line.trimEnd());
      let rest = word;
      while (displayWidth(rest) > max) {
        let head = '';
        for (const character of rest) { if (displayWidth(head + character) > max) break; head += character; }
        if (!head) head = [...rest][0]!;
        out.push(head);
        rest = rest.slice(head.length);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}
const wrapText = (text: string, width: number) => wrapCells(displayText(text), width);

/** One turn: the first row carries the gutter marker, continuation rows align under the text. */
function turn(text: string, width: number, textStyle: string, marker = '', markerStyle = ''): Styled[] {
  const lead = Math.min(INDENT, Math.max(0, width - 1));
  return wrapText(text, width - lead).map((line, index) => ({styled: index === 0 && marker
    ? `${markerStyle}${marker}${RESET}${' '.repeat(Math.max(0, lead - displayWidth(marker)))}${textStyle}${line}${RESET}`
    : `${' '.repeat(lead)}${textStyle}${line}${RESET}`}));
}

type Tone = 'active' | 'attention' | 'calm' | 'failure';
function stateTone(session: AgentSession): Tone {
  if (session.state === 'approval' || session.state === 'choice') return 'attention';
  if (session.state === 'failed') return 'failure';
  if (session.state === 'working' || session.state === 'starting' || session.state === 'running') return 'active';
  return 'calm';
}
const toneColor = (tone: Tone): RgbColor => tone === 'failure' ? UI_COLORS.failure : tone === 'calm' ? UI_COLORS.secondary : UI_COLORS.accent;

/**
 * The provider identity header. Before the first message it is a welcome (provider, launch identity,
 * directory, a prompt to start); afterwards two compact rows: provider · title (model on the right), then the
 * target's state first and the context it runs in. Only the provider glyph and name carry the provider's
 * registry accent, and meaning never depends on color. The model is shown only as the provider reported it at
 * runtime, or as a profile's explicitly configured model labeled "configured"; effort is never shown, since no
 * structured event reports a level.
 */
function providerHeader(session: AgentSession, meta: AgentViewMeta, width: number): Line[] {
  const descriptor = harness(session.harness);
  const color = descriptor && colorLevel() !== 'none' ? foreground(hexColor(descriptor.color)) : '';
  const primary = paint(UI_COLORS.primary);
  const subtle = paint(UI_COLORS.subtle);
  const glyph = (safe() ? descriptor?.safeGlyph : descriptor?.glyph) ?? '*';
  const name = displayText(descriptor?.name ?? session.harness);
  const telemetry = session.telemetry;
  const running = telemetry ? currentModel(telemetry, session.model) : undefined;
  // Effort only as acknowledged, set at launch or read from the account's settings: never invented.
  const effort = telemetry ? effortStatus(telemetry, meta.settingsEffort) : undefined;
  const effortText = effort?.value && ['acknowledged', 'launch', 'settings'].includes(effort.state) ? ` · ${displayText(effort.value)} effort` : '';
  const model = running ? `${displayText(modelName(running.value, telemetry))}${running.source === 'requested' ? ' (requested)' : ''}${effortText}`
    : session.model ? displayText(session.model) : meta.configuredModel ? `${displayText(meta.configuredModel)} · configured` : '';
  const identity = displayText(meta.profileLabel ?? meta.identity ?? '');
  const cwd = session.cwd ? homeRelative(displayText(session.cwd)) : '';
  const branch = meta.branch ? displayText(meta.branch) : '';
  const right = (left: string, leftWidth: number) => model && leftWidth + displayWidth(model) + 2 <= width
    ? `${left}${' '.repeat(width - leftWidth - displayWidth(model))}${subtle}${model}${RESET}` : left;
  /** Directory and branch in the cells left; the path shortens from its start so the project name stays. */
  const place = (room: number) => {
    const suffix = branch ? ` · ${branch}` : '';
    if (!cwd) return truncateText(branch, Math.max(0, room));
    if (displayWidth(cwd + suffix) <= room) return cwd + suffix;
    // The project folder outranks the branch: keep the branch only while the folder name stays whole.
    const leaf = cwd.slice(cwd.lastIndexOf('/') + 1);
    const pathRoom = room - displayWidth(suffix);
    if (pathRoom >= displayWidth(leaf) + displayWidth(marks().ellipsis) + 1) return truncateStart(cwd, pathRoom) + suffix;
    return truncateStart(cwd, Math.max(1, room));
  };
  const started = session.events.some(event => event.kind === 'user');
  if (!started) {
    const title = `${glyph} ${name}`;
    const where = place(width - INDENT);
    return [{styled: right(`${color}${title}${RESET}`, displayWidth(title))},
      ...(identity ? [{styled: `  ${primary}${identity}${RESET}`}] : []),
      ...(where ? [{styled: `  ${subtle}${where}${RESET}`}] : []),
      ...(!model ? [] : displayWidth(`${title}  ${model}`) > width ? [{styled: `  ${subtle}${model}${RESET}`}] : []),
      '', {styled: `  ${primary}What would you like to work on?${RESET}`}];
  }
  const title = displayText(session.title);
  const head = `${glyph} ${name} · ${title}`;
  // The target's state is on the composer rule, always visible; the header only says what and where.
  // The project folder outranks the identity: the identity gives way when both cannot be whole.
  const leaf = cwd.slice(cwd.lastIndexOf('/') + 1);
  const withIdentity = identity ? place(width - INDENT - displayWidth(identity) - 3) : '';
  const tail = identity && displayWidth(withIdentity) > 0 && (!leaf || withIdentity.includes(leaf)) && displayWidth(`${identity} · ${withIdentity}`) <= width - INDENT
    ? `${identity} · ${withIdentity}` : place(width - INDENT) || identity;
  return [{styled: right(`${color}${glyph} ${name}${RESET}${primary} · ${title}${RESET}`, displayWidth(head))},
    ...(tail ? [{styled: `  ${subtle}${tail}${RESET}`}] : [])];
}

/** The composer rule: the target's state on the left (attention marked in words, not color only), the rule after it. */
function stateRule(session: AgentSession, width: number): Styled {
  const tone = stateTone(session);
  const label = `${tone === 'attention' ? `${marks().attention} ` : ''}${displayText(targetStatus(session).label)}`;
  const text = truncateText(label, Math.max(1, width - 4));
  const rule = paint(UI_COLORS.separator);
  return {styled: `${rule}${marks().rule}${RESET} ${paint(toneColor(tone))}${text}${RESET} ${rule}${repeatToWidth(marks().rule, Math.max(0, width - displayWidth(text) - 3))}${RESET}`};
}

/** Your turn in Chat: a right-aligned block in the chat column, labelled on its right edge (as the shell and Ask transcripts). */
function chatTurn(text: string, width: number, column: number, label: string, style: string, labelStyle: string): Styled[] {
  const lines = wrapText(text, column);
  const widest = Math.max(displayWidth(label), ...lines.map(line => displayWidth(line)));
  const left = Math.max(0, width - widest);
  return [{styled: `${' '.repeat(left + widest - displayWidth(label))}${labelStyle}${label}${RESET}`},
    ...lines.map(line => ({styled: `${' '.repeat(left + widest - displayWidth(line))}${style}${line}${RESET}`}))];
}

/** The conversation: user turns lead with a marker, the agent's text is the body, tools and outcomes stay quiet. */
function conversation(session: AgentSession, width: number, presentation: 'normal' | 'chat' = 'normal'): Line[] {
  const source = session.transcript;
  const g = marks();
  const primary = paint(UI_COLORS.primary), secondary = paint(UI_COLORS.secondary), subtle = paint(UI_COLORS.subtle);
  const accent = paint(UI_COLORS.accent), failure = paint(UI_COLORS.failure), success = paint(UI_COLORS.success);
  // The whole (bounded) source, oldest first: scrollback reaches the start of the conversation.
  const items = source ? source.objects.map(object => ({kind: object.kind, text: object.text, long: object.text.length >= 400}))
    : session.events.flatMap(event => event.kind === 'assistant' || event.kind === 'user' ? [{kind: event.kind as string, text: event.text, long: false}] : []);
  // Chat: your turns are a right-aligned block, the agent's prose a left column with its name; tools stay quiet rows.
  const column = presentation === 'chat' ? chatColumn(width - INDENT) : undefined;
  const lines: Line[] = [];
  let previous = '';
  for (const item of items) {
    // A blank row separates turns and sets prose apart from activity rows; consecutive tools stay together.
    if (lines.length && (item.kind === 'user' || item.kind !== previous) && !(item.kind === 'tool' && previous === 'tool')) lines.push('');
    if (item.kind === 'user' && column) lines.push(...chatTurn(item.text, width, column, 'You', primary, subtle));
    else if (item.kind === 'user') lines.push(...turn(item.text, width, primary, g.you, accent));
    else if (item.kind === 'assistant' && column) {
      if (previous !== 'assistant') lines.push({styled: `${' '.repeat(INDENT)}${accent}${displayText(harness(session.harness)?.short ?? session.harness)}${RESET}`});
      lines.push(...turn(item.text, Math.min(width, column + INDENT), primary));
    } else if (item.kind === 'assistant') lines.push(...turn(item.text, width, primary));
    else if (item.kind === 'tool') {
      const failed = item.text.endsWith(' · failed');
      const text = failed ? item.text.slice(0, -' · failed'.length) : item.text;
      const space = text.indexOf(' ');
      const [tool, target] = space < 0 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)];
      const label = truncateAnsi(`${secondary}${tool}${RESET}${target ? ` ${subtle}${target}${RESET}` : ''}${failed ? ` ${failure}· failed${RESET}` : ''}`, Math.max(1, width - INDENT - 2));
      lines.push({styled: `${' '.repeat(INDENT)}${failed ? failure : subtle}${g.tool}${RESET} ${label}`});
    } else if (item.kind === 'settled') {
      const failedRun = item.text.startsWith('Run failed');
      const finished = item.text.startsWith('Finished');
      lines.push(...turn(`${failedRun ? GLYPHS.failure : finished ? GLYPHS.success : '·'} ${item.text}`, width, failedRun ? failure : finished ? success : subtle));
    } else if (item.kind === 'approval' || item.kind === 'choice') lines.push(...turn(`${g.attention} ${item.text}`, width, accent));
    else lines.push(...turn(item.text, width, item.kind === 'incomplete' ? failure : subtle));
    if (item.long) lines.push({styled: `${' '.repeat(INDENT)}${subtle}[excerpt · Tab for full source]${RESET}`});
    previous = item.kind;
  }
  return lines;
}

/**
 * The agent draft, laid out by the shell composer's own geometry (`layoutInput`: prompt prefix, continuation
 * indent, wrapping, caret cell). Returns its rows and the caret within them; with a hardware caret no glyph is drawn.
 */
function composer(session: AgentSession, view: AgentViewState, width: number, hardwareCaret: boolean): {rows: Styled[]; caret: {row: number; column: number}} {
  const c = view.controller!;
  const g = marks();
  const accent = paint(UI_COLORS.accent), primary = paint(UI_COLORS.primary), subtle = paint(UI_COLORS.subtle);
  const synced = c.editor.text === view.input;
  const text = displayText(synced ? c.editor.displayText : view.input);
  const cursor = synced ? c.editor.displayCursorIndex : [...text].length;
  const prefix = `${GLYPHS.prompt} `;
  c.composerColumns = width;
  c.composerPrefix = prefix;
  const layout = layoutInput(text, cursor, width, Number.POSITIVE_INFINITY, prefix);
  const all = layout.allRows;
  const begin = Math.max(0, Math.min(all.length - DRAFT_LINES, layout.caretRow - DRAFT_LINES + 1));
  const out: Styled[] = [];
  if (begin > 0) out.push({styled: `${' '.repeat(displayWidth(prefix))}${subtle}${begin} earlier line${begin === 1 ? '' : 's'}${RESET}`});
  const caret = {row: out.length + layout.caretRow - begin, column: layout.caretColumn};
  if (!text) {
    const short = displayText(harness(session.harness)?.short ?? 'the agent');
    const mark = hardwareCaret ? ' ' : `${accent}${g.caret}${RESET}`;
    out.push({styled: `${accent}${prefix}${RESET}${mark}${subtle}${truncateText(`Message ${short}${g.ellipsis}`, Math.max(1, width - displayWidth(prefix) - 1))}${RESET}`});
    return {rows: out, caret: {row: out.length - 1, column: displayWidth(prefix)}};
  }
  all.slice(begin, begin + DRAFT_LINES).forEach((row, index) => {
    const lead = row.prefix === prefix ? `${accent}${prefix}${RESET}` : row.prefix;
    let body = row.text;
    if (!hardwareCaret && begin + index === layout.caretRow) {
      const at = Math.max(0, layout.caretColumn - displayWidth(row.prefix));
      let head = '', taken = 0;
      for (const ch of row.text) { if (taken + displayWidth(ch) > at) break; head += ch; taken += displayWidth(ch); }
      body = `${head}${RESET}${accent}${g.caret}${RESET}${primary}${row.text.slice(head.length)}`;
    }
    out.push({styled: `${lead}${primary}${body}${RESET}`});
  });
  return {rows: out, caret};
}

/**
 * The /model or /effort picker in the composer's place: a title with the current value and its source, the rows
 * (selection marker, current and default marks in words so nothing depends on color), the selected row's description,
 * when the change applies, and the picker's own message. Bounded to `room` rows; the selection stays visible.
 */
function pickerRows(picker: PickerState, width: number, room: number): Line[] {
  const g = marks();
  const primary = paint(UI_COLORS.primary), secondary = paint(UI_COLORS.secondary), subtle = paint(UI_COLORS.subtle), accent = paint(UI_COLORS.accent);
  const title = picker.kind === 'model' ? 'Model' : 'Effort';
  const head: Line[] = [{styled: `${accent}${title}${RESET}${subtle} · ${truncateText(picker.status, Math.max(1, width - displayWidth(title) - 3))}${RESET}`}];
  if (picker.query) head.push({styled: `${subtle}Filter: ${RESET}${primary}${truncateText(picker.query, Math.max(1, width - 8))}${RESET}`});
  const rows = visibleRows(picker);
  const tail: Line[] = [];
  const chosen = rows[picker.selected];
  if (chosen?.detail) tail.push({styled: `${secondary}${truncateText(chosen.detail, width)}${RESET}`});
  tail.push({styled: `${subtle}${truncateText(picker.busy ? 'Waiting for Claude to acknowledge' + g.ellipsis : picker.timing, width)}${RESET}`});
  if (picker.message) tail.push({styled: `${paint(UI_COLORS.failure)}${truncateText(picker.message, width)}${RESET}`});
  const listRoom = Math.max(1, room - head.length - tail.length);
  const start = Math.max(0, Math.min(picker.selected - listRoom + 1, rows.length - listRoom));
  const list: Line[] = rows.length ? rows.slice(start, start + listRoom).map((row, offset) => {
    const index = start + offset;
    const selected = index === picker.selected;
    const lead = selected ? `${accent}${GLYPHS.selection}${RESET} ` : '  ';
    const tags = [row.current ? 'current' : '', row.isDefault && picker.kind === 'model' ? 'default' : ''].filter(Boolean).join(', ');
    const tag = tags ? `  ${subtle}(${tags})${RESET}` : '';
    const label = truncateText(row.label, Math.max(1, width - 2 - (tags ? tags.length + 4 : 0)));
    return {styled: `${lead}${selected ? primary : secondary}${label}${RESET}${tag}`};
  }) : [{styled: `${subtle}  Nothing matches "${truncateText(picker.query, Math.max(1, width - 20))}"${RESET}`}];
  return [...head, ...list, ...tail].slice(0, Math.max(1, room));
}

/** What the keys do right now, with the shared footer styling (keys accent, actions muted); controls are dropped whole, never cut. */
function hints(session: AgentSession, view: AgentViewState, width: number): Line[] {
  const c = view.controller!;
  const pairs: Array<[string, string]> = c.owner === 'PICKER'
    ? [['Enter', 'apply'], ['↑↓', 'choose'], ['Esc', 'cancel'], ['type', 'filter']]
    : c.owner === 'TRANSCRIPT'
    ? [['↑↓', 'objects'], ['←→', 'zoom'], ['1-5', 'detail'], ['c', 'copy visible'], ['C', 'copy full'], ['Esc', 'shell']]
    : [['Enter', 'send'], ...(session.state === 'working' || session.state === 'approval' ? [['Ctrl+C', 'interrupt'] as [string, string]] : []), ['Tab', 'transcript'], ['Esc', 'shell']];
  const keys = safe() ? pairs.map(([key, label]) => [key.replace('↑↓', 'Up/Down').replace('←→', 'Left/Right'), label] as [string, string]) : pairs;
  const owner = OWNER_WORDS[c.owner];
  const ownerLabel = owner ? `${paint(UI_COLORS.secondary)}${owner}${RESET}${paint(UI_COLORS.subtle)} · ${RESET}` : '';
  for (let count = keys.length; count > 0; count -= 1) {
    const row = `${ownerLabel}${renderControls(keys.slice(0, count))}`;
    if (displayWidth(row) <= width) return [{styled: row}];
  }
  return [{styled: renderControls(keys.slice(0, 1))}];
}

/** Source has been loaded on semantic actions; render never reads disk/provider config. */
export function renderSemanticAgentView(session: AgentSession, view: AgentViewState, columns: number, height: number, meta: AgentViewMeta = {}, options: AgentViewOptions = {}): string[] {
  const c = view.controller!;
  const width = Math.max(1, columns);
  const header = providerHeader(session, meta, width);
  const emit = (line: Line) => typeof line === 'string' ? truncateAnsi(displayText(line), width) : truncateAnsi(line.styled, width);
  const subtle = paint(UI_COLORS.subtle), secondary = paint(UI_COLORS.secondary), accent = paint(UI_COLORS.accent);
  const wrap = (text: string, style = ''): Line[] => wrapText(text, width).map(line => style ? {styled: `${style}${line}${RESET}`} : line);
  if (c.owner === 'CHOICE' && session.pendingChoice) {
    const q = session.pendingChoice.questions[c.choiceQuestion];
    if (!q) return header.map(emit);
    const keys: Array<[string, string]> = q.multiSelect ? [['↑↓', 'options'], ['Enter', 'answer'], ['Tab', 'toggle'], ['Esc', 'back']] : [['↑↓', 'options'], ['Enter', 'answer'], ['Esc', 'back']];
    const controls: Line[] = [...renderControlRows(safe() ? keys.map(([key, label]) => [key.replace('↑↓', 'Up/Down'), label]) : keys, width).map(row => ({styled: row})), ...wrap('Type to answer Other', subtle)];
    const prefix: Line[] = [...wrap(`Question ${c.choiceQuestion + 1}/${session.pendingChoice.questions.length}`, accent), ...wrap(q.question.slice(0, width * 2)),
      ...(q.question.length > width * 2 ? [{styled: `${subtle}[question excerpt]${RESET}`}] : [])];
    const option = q.options[c.choiceSelected]!;
    const body: Line[] = [...wrap(`${marks().you} ${c.choiceSelected + 1}/${q.options.length} ${c.choiceToggled.has(option.label) ? '[x] ' : ''}${option.label.slice(0, width * 2)}`),
      ...wrap(option.description.slice(0, width * 2), secondary)];
    const other = `Other: ${c.choiceEditor.text.slice(-Math.max(1, width - 7))}`;
    const room = Math.max(1, height - controls.length - header.length - prefix.length - 2);
    return [...header, '', ...prefix, ...body.slice(0, room), other, ...controls].slice(0, height).map(emit);
  }

  const notices: Line[] = [];
  if (session.pendingChoice) notices.push({styled: `${accent}${marks().attention} Question pending${RESET}${subtle} · Shift+Tab to answer${RESET}`});
  if (session.pendingApproval) notices.push(c.owner === 'APPROVAL'
    ? {styled: `${accent}${marks().attention} Permission: ${displayText(session.pendingApproval.tool)}${RESET}  ${renderControls([['Ctrl+O', 'allow once'], ['Ctrl+C', 'deny'], ['Esc', 'back']])}`}
    : {styled: `${accent}${marks().attention} Permission pending${RESET}${subtle} · Shift+Tab or /approval to review${RESET}`});
  if (view.message) notices.push(...wrap(view.message, secondary));
  if (c.feedback && Date.now() < c.feedbackUntil) notices.push(...wrap(c.feedback, secondary));
  const source = session.transcript;
  if (source?.incomplete) notices.push(...wrap(`Incomplete: ${source.incomplete}`, paint(UI_COLORS.failure)));
  const composing = c.owner === 'AGENT_MESSAGE' && session.level === 'managed' && !['exited', 'failed'].includes(session.state);
  const draft = composing ? composer(session, view, width, Boolean(options.hardwareCaret)) : undefined;
  const picking = c.owner === 'PICKER' && c.picker ? pickerRows(c.picker, width, Math.max(3, Math.min(14, Math.floor(height / 2)))) : undefined;
  const controls: Line[] = session.level === 'managed' ? hints(session, view, width) : wrap('Observed metadata only · Esc shell', subtle);
  const rule = stateRule(session, width);
  const top = options.composerPosition === 'top';

  // Approval input and a focused object read from their start; the conversation is a stream whose newest rows meet the composer.
  let body: Line[];
  let stream = false;
  if (c.owner === 'APPROVAL' && session.pendingApproval) {
    body = wrap(JSON.stringify(session.pendingApproval.input ?? {tool: session.pendingApproval.tool, target: session.pendingApproval.target}, null, 2));
  } else if (c.owner === 'TRANSCRIPT' && view.focusedObject) {
    body = [...header, '', ...wrap(`Object ${c.selected + 1}/${source?.objects.length ?? 0} · ${view.focusedObject.kind}`, subtle), ...wrap(projectObject(view.focusedObject, c.depth).text)];
  } else {
    // The welcome (or the compact header) is the start of the stream: it sits on the composer until messages push it up.
    body = [...header, '', ...conversation(session, width, options.presentation)];
    while (body.at(-1) === '') body.pop();
    stream = true;
  }
  const draftRows = picking ?? draft?.rows ?? [];
  const room = Math.max(1, height - notices.length - 1 - draftRows.length - controls.length);
  if (stream) {
    // Scrolled back: rows that arrive below keep the visible ones where they are.
    if (view.scroll > 0 && view.seenRows !== undefined && body.length > view.seenRows) view.scroll += body.length - view.seenRows;
    view.seenRows = body.length;
  }
  const scroll = Math.min(view.scroll, Math.max(0, body.length - room));
  c.scroll = scroll; view.scroll = scroll;
  const first = stream ? Math.max(0, body.length - room - scroll) : scroll;
  const visible = body.slice(first, first + room);
  const filler: Line[] = Array.from({length: Math.max(0, room - visible.length)}, () => '');
  const rows: Line[] = top
    ? [...draftRows, rule, ...visible, ...filler, ...notices, ...controls]
    : [...(stream ? [...filler, ...visible] : [...visible, ...filler]), ...notices, rule, ...draftRows, ...controls];
  if (options.layout) {
    const at = top ? 0 : rows.length - controls.length - draftRows.length;
    options.layout.caret = draft && !picking && at + draft.caret.row < height ? {row: at + draft.caret.row, column: Math.min(width - 1, draft.caret.column)} : undefined;
  }
  return rows.slice(0, height).map(emit);
}
