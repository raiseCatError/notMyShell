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

const RESET = '\u001b[0m';
/** A line already built from scrubbed parts and styled by NMSh; every other line is scrubbed when emitted. */
type Styled = {styled: string};
type Line = string | Styled;

/** What the person is doing in the view, in words; the default (writing to the agent) needs no label. */
const OWNER_WORDS: Partial<Record<string, string>> = {TRANSCRIPT: 'Reviewing the conversation', APPROVAL: 'Permission request', CHOICE: 'Question'};

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
  const model = session.model ? displayText(session.model) : meta.configuredModel ? `${displayText(meta.configuredModel)} · configured` : '';
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
  const tone = stateTone(session);
  const lead = `${tone === 'attention' ? `${marks().attention} ` : ''}${targetStatus(session).label}`;
  // The state is never dropped; the identity, then the start of the path, give way first.
  const separator = 3;
  let facts = identity ? [identity] : [];
  let room = width - INDENT - displayWidth(lead) - facts.reduce((sum, fact) => sum + separator + displayWidth(fact), 0) - separator;
  if (room < 12 && facts.length) { facts = []; room = width - INDENT - displayWidth(lead) - separator; }
  const where = room > 0 ? place(room) : '';
  const tail = [...facts, where].filter(Boolean).map(fact => ` · ${fact}`).join('');
  return [{styled: right(`${color}${glyph} ${name}${RESET}${primary} · ${title}${RESET}`, displayWidth(head))},
    {styled: `  ${paint(toneColor(tone))}${lead}${RESET}${subtle}${tail}${RESET}`}];
}

/** The conversation: user turns lead with a marker, the agent's text is the body, tools and outcomes stay quiet. */
function conversation(session: AgentSession, width: number): Line[] {
  const source = session.transcript;
  const g = marks();
  const primary = paint(UI_COLORS.primary), secondary = paint(UI_COLORS.secondary), subtle = paint(UI_COLORS.subtle);
  const accent = paint(UI_COLORS.accent), failure = paint(UI_COLORS.failure), success = paint(UI_COLORS.success);
  const items = source ? source.objects.slice(-20).map(object => ({kind: object.kind, text: object.text, long: object.text.length >= 400}))
    : session.events.flatMap(event => event.kind === 'assistant' || event.kind === 'user' ? [{kind: event.kind as string, text: event.text, long: false}] : []);
  const lines: Line[] = [];
  let previous = '';
  for (const item of items) {
    // A blank row separates turns and sets prose apart from activity rows; consecutive tools stay together.
    if (lines.length && (item.kind === 'user' || item.kind !== previous) && !(item.kind === 'tool' && previous === 'tool')) lines.push('');
    if (item.kind === 'user') lines.push(...turn(item.text, width, primary, g.you, accent));
    else if (item.kind === 'assistant') lines.push(...turn(item.text, width, primary));
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

/** The agent draft: prompt glyph, the text as edited (paste atoms by label), a caret at the cursor, continuation rows aligned. */
function composer(session: AgentSession, view: AgentViewState, width: number): Styled[] {
  const c = view.controller!;
  const g = marks();
  const accent = paint(UI_COLORS.accent), primary = paint(UI_COLORS.primary), subtle = paint(UI_COLORS.subtle);
  const synced = c.editor.text === view.input;
  const text = synced ? c.editor.displayText : view.input;
  const cursor = synced ? c.editor.displayCursorIndex : text.length;
  const gap = ' '.repeat(Math.max(1, INDENT - displayWidth(GLYPHS.prompt)));
  const prompt = `${accent}${GLYPHS.prompt}${RESET}${gap}`;
  const lead = displayWidth(GLYPHS.prompt) + gap.length;
  if (!text) {
    const short = displayText(harness(session.harness)?.short ?? 'the agent');
    return [{styled: `${prompt}${accent}${g.caret}${RESET}${subtle}${truncateText(`Message ${short}${g.ellipsis}`, Math.max(1, width - lead - 1))}${RESET}`}];
  }
  const clean = (part: string) => displayText(part).replaceAll(CARET, '');
  const rows = wrapCells(`${clean(text.slice(0, cursor))}${CARET}${clean(text.slice(cursor))}`, Math.max(1, width - lead - 1));
  const caretRow = Math.max(0, rows.findIndex(row => row.includes(CARET)));
  const start = Math.max(0, Math.min(rows.length - DRAFT_LINES, caretRow - DRAFT_LINES + 1));
  const out: Styled[] = [];
  if (start > 0) out.push({styled: `${' '.repeat(lead)}${subtle}${start} earlier line${start === 1 ? '' : 's'}${RESET}`});
  rows.slice(start, start + DRAFT_LINES).forEach((row, index) => {
    const body = row.replace(CARET, `${RESET}${accent}${g.caret}${RESET}${primary}`);
    out.push({styled: `${index === 0 && start === 0 ? prompt : ' '.repeat(lead)}${primary}${body}${RESET}`});
  });
  return out;
}

/** What the keys do right now, with the shared footer styling (keys accent, actions muted); controls are dropped whole, never cut. */
function hints(session: AgentSession, view: AgentViewState, width: number): Line[] {
  const c = view.controller!;
  const pairs: Array<[string, string]> = c.owner === 'TRANSCRIPT'
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
export function renderSemanticAgentView(session: AgentSession, view: AgentViewState, columns: number, height: number, meta: AgentViewMeta = {}): string[] {
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

  const footer: Line[] = [];
  if (session.pendingChoice) footer.push({styled: `${accent}${marks().attention} Question pending${RESET}${subtle} · Shift+Tab to answer${RESET}`});
  if (session.pendingApproval) footer.push(c.owner === 'APPROVAL'
    ? {styled: `${accent}${marks().attention} Permission: ${displayText(session.pendingApproval.tool)}${RESET}  ${renderControls([['Ctrl+O', 'allow once'], ['Ctrl+C', 'deny'], ['Esc', 'back']])}`}
    : {styled: `${accent}${marks().attention} Permission pending${RESET}${subtle} · Shift+Tab or /approval to review${RESET}`});
  if (view.message) footer.push(...wrap(view.message, secondary));
  if (c.feedback && Date.now() < c.feedbackUntil) footer.push(...wrap(c.feedback, secondary));
  const source = session.transcript;
  if (source?.incomplete) footer.push(...wrap(`Incomplete: ${source.incomplete}`, paint(UI_COLORS.failure)));
  footer.push({styled: `${paint(UI_COLORS.separator)}${repeatToWidth(marks().rule, width)}${RESET}`});
  if (c.owner === 'AGENT_MESSAGE' && session.level === 'managed' && !['exited', 'failed'].includes(session.state)) footer.push(...composer(session, view, width));
  if (session.level === 'managed') footer.push(...hints(session, view, width));
  else footer.push(...wrap('Observed metadata only · Esc shell', subtle));

  let body: Line[];
  if (c.owner === 'APPROVAL' && session.pendingApproval) {
    body = wrap(JSON.stringify(session.pendingApproval.input ?? {tool: session.pendingApproval.tool, target: session.pendingApproval.target}, null, 2));
  } else if (c.owner === 'TRANSCRIPT' && view.focusedObject) {
    body = [...wrap(`Object ${c.selected + 1}/${source?.objects.length ?? 0} · ${view.focusedObject.kind}`, subtle), ...wrap(projectObject(view.focusedObject, c.depth).text)];
  } else body = conversation(session, width);
  const room = Math.max(1, height - header.length - footer.length - 1);
  const scroll = Math.min(view.scroll, Math.max(0, body.length - room));
  const start = c.owner === 'TRANSCRIPT' || c.owner === 'APPROVAL' ? scroll : Math.max(0, body.length - room - scroll);
  const visible = body.slice(start, start + room);
  // The view owns its full height: the conversation runs down from the header, the composer keeps the bottom edge.
  const filler: Line[] = Array.from({length: Math.max(0, room - visible.length)}, () => '');
  return [...header, '', ...visible, ...filler, ...footer].slice(0, height).map(emit);
}
