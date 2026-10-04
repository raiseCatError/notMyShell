import {signatureAccent} from '../../session/signatures.js';
import {renderControls} from '../../ui/controls.js';
import {getCurrentGlyphMode, GLYPHS} from '../../ui/glyphs.js';
import {foreground, UI_COLORS} from '../../ui/palette.js';
import {colorLevel} from '../../presentation/capabilities.js';
import {displayWidth, padCells, truncateAnsi} from '../../util/text.js';
import {harness, type HarnessDescriptor} from '../harnesses.js';
import type {AgentEvent, AgentSession} from './model.js';

/**
 * Agent session presentation: the transient shelf above the composer, the
 * /ai panel, and the agent session view. Text never changes width while a
 * state animates; provider identity reads without color (name + glyph).
 */

const RESET = '\u001b[0m';
const glyphOf = (descriptor: HarnessDescriptor | undefined) => (getCurrentGlyphMode() === 'safe' ? descriptor?.safeGlyph : descriptor?.glyph) ?? '*';
const accent = (descriptor: HarnessDescriptor | undefined) => descriptor && colorLevel() !== 'none' ? foreground(hex(descriptor.color)) : '';
function hex(value: string) { return {red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)}; }

export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Factual state words; activity only when a harness event supplied it. */
export function stateLabel(session: AgentSession, now: number): string {
  switch (session.state) {
    case 'starting': return 'starting';
    case 'working': return session.activity ? `${session.activity.toLowerCase().startsWith('edit') ? 'editing' : session.activity.toLowerCase().startsWith('read') ? 'reading' : 'working'}${session.activity.includes(' ') ? ` ${session.activity.slice(session.activity.indexOf(' ') + 1)}` : ''}` : `working ${elapsedLabel(now - session.startedAt)}`;
    case 'approval': return 'needs approval';
    case 'waiting': return 'waiting for you';
    case 'finished': return 'finished';
    case 'failed': return 'failed';
    case 'exited': return 'ended';
    case 'running': return `running ${elapsedLabel(now - session.startedAt)}`;
  }
}

/** Shelf order: what needs attention first, then newest. */
export function shelfOrder(sessions: readonly AgentSession[]): AgentSession[] {
  return [...sessions].sort((a, b) => Number(b.attention) - Number(a.attention) || b.updatedAt - a.updatedAt);
}

/** One compact row: "✻ Claude · working 4m   ◇ Codex · waiting", narrowing to "✻ Claude · working · +1", then "* Claude". */
export function renderShelf(sessions: readonly AgentSession[], columns: number, now: number, selected?: number, focused = false): string {
  const items = shelfOrder(sessions);
  if (!items.length) return '';
  const subtle = foreground(UI_COLORS.subtle);
  const primary = foreground(UI_COLORS.primary);
  const marker = foreground(UI_COLORS.accent);
  const cell = (session: AgentSession, index: number, withTitle: boolean) => {
    const descriptor = harness(session.harness);
    const chosen = focused && index === selected;
    const title = withTitle && session.level === 'managed' && !session.title.includes(' · ') ? ` · ${session.title}` : '';
    const attention = session.attention ? (getCurrentGlyphMode() === 'safe' ? '! ' : '◆ ') : '';
    return `${chosen ? `${marker}${GLYPHS.selection} ${RESET}` : ''}${signatureChip(session.signature)}${accent(descriptor)}${glyphOf(descriptor)}${RESET} ${chosen ? primary : ''}${descriptor?.short ?? session.harness}${RESET}${subtle}${title} · ${attention}${stateLabel(session, now)}${RESET}`;
  };
  for (const withTitle of [true, false]) {
    const row = items.map((session, index) => cell(session, index, withTitle)).join('   ');
    if (displayWidth(row) <= columns) return row;
  }
  const more = items.length > 1 ? `${subtle} · +${items.length - 1}${RESET}` : '';
  const first = cell(items[0]!, 0, false);
  if (displayWidth(first + more) <= columns) return first + more;
  // Narrow: the state word only ("✻ Claude · editing · +1").
  const head = items[0]!;
  const descriptor = harness(head.harness);
  const short = `${accent(descriptor)}${glyphOf(descriptor)}${RESET} ${descriptor?.short ?? head.harness}${subtle} · ${head.attention ? (getCurrentGlyphMode() === 'safe' ? '! ' : '◆ ') : ''}${stateLabel(head, now).split(' ')[0]}${RESET}`;
  if (displayWidth(short + more) <= columns) return short + more;
  return truncateAnsi(`${glyphOf(descriptor)} ${descriptor?.short ?? head.harness}`, columns);
}

export interface AgentPanelState {
  selected: number;
  /** Renaming the selected session: the draft title. */
  rename?: string;
  message?: string;
}

export type AgentPanelRow = {kind: 'session'; session: AgentSession} | {kind: 'harness'; harness: HarnessDescriptor; executable?: string; controllable: boolean};

export function agentPanelRows(sessions: readonly AgentSession[], harnesses: ReadonlyArray<{harness: HarnessDescriptor; executable?: string; controllable: boolean}>): AgentPanelRow[] {
  return [...shelfOrder(sessions).map(session => ({kind: 'session' as const, session})), ...harnesses.map(item => ({kind: 'harness' as const, ...item}))];
}

const levelLabel = (session: AgentSession) => session.level === 'managed' ? 'Managed' : session.level === 'attachable' ? 'Attachable' : 'Observed only';

export function renderAgentPanel(state: AgentPanelState, rows: readonly AgentPanelRow[], columns: number, now: number, height = Infinity): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const marker = foreground(UI_COLORS.accent);
  const out = [`${primary}  Agent sessions${RESET}  ${subtle}external agent harnesses · NMSh launches and supervises; the harness owns models, auth and tools${RESET}`, ''];
  const sessions = rows.filter(row => row.kind === 'session');
  if (!sessions.length) out.push(`  ${subtle}No agent sessions yet. Choose a harness below to start one in the background.${RESET}`);
  const nameWidth = 14;
  rows.forEach((row, index) => {
    if (row.kind === 'harness' && (index === 0 || rows[index - 1]!.kind === 'session')) out.push('', `${primary}  Harnesses${RESET}`);
    const pick = index === state.selected ? `${marker}${GLYPHS.selection}${RESET}` : ' ';
    if (row.kind === 'session') {
      const descriptor = harness(row.session.harness);
      const where = [row.session.cwd ? row.session.cwd.replace(/^\/(?:Users|home)\/[^/]+/u, '~') : undefined, row.session.tty, row.session.pid ? `pid ${row.session.pid}` : undefined].filter(Boolean).join(' · ');
      const title = state.rename !== undefined && index === state.selected ? `${state.rename}${marker}▏${RESET}` : row.session.title;
      out.push(`${pick} ${signatureChip(row.session.signature, 8)}${accent(descriptor)}${glyphOf(descriptor)}${RESET} ${padCells(`${primary}${descriptor?.short ?? row.session.harness}${RESET}`, nameWidth)}${secondary}${title}${RESET}  ${subtle}${row.session.attention ? '◆ ' : ''}${stateLabel(row.session, now)} · ${levelLabel(row.session)}${where ? ` · ${where}` : ''}${RESET}`);
    } else {
      const status = !row.executable ? 'not installed' : row.controllable ? 'installed · Enter starts a managed session' : 'installed · observed only (no supported control channel yet)';
      out.push(`${pick} ${accent(row.harness)}${glyphOf(row.harness)}${RESET} ${padCells(`${primary}${row.harness.name}${RESET}`, nameWidth)}${subtle}${status}${RESET}`);
    }
  });
  if (state.message) out.push('', `  ${secondary}${state.message}${RESET}`);
  out.push('', renderControls(state.rename !== undefined ? [['Enter', 'rename'], ['Esc', 'cancel']] : [['↑↓', 'select'], ['Enter', 'open / start'], ['R', 'rename'], ['A', 'agent usage (/agents)'], ['Esc', 'back']]));
  const bounded = Number.isFinite(height) && out.length > height ? [...out.slice(0, 2), ...out.slice(out.length - (height - 2))] : out;
  return bounded.map(line => truncateAnsi(line, columns));
}

export interface AgentViewState {
  sessionId: string;
  input: string;
  /** Tool blocks the person expanded (Ctrl+O); tool detail starts folded. */
  expanded: Set<string>;
  /** Rows scrolled up from the newest. */
  scroll: number;
  message?: string;
}

/** The visible transcript of a session as plain-text blocks: what /copy and the view share. */
export function agentBlocks(session: AgentSession): Array<{kind: 'user' | 'assistant' | 'tool' | 'note'; text: string; id?: string; detail?: string}> {
  const blocks: Array<{kind: 'user' | 'assistant' | 'tool' | 'note'; text: string; id?: string; detail?: string}> = [];
  const tools = new Map<string, {kind: 'tool'; text: string; id: string; detail?: string}>();
  for (const event of session.events) {
    if (event.kind === 'user') blocks.push({kind: 'user', text: event.text});
    else if (event.kind === 'assistant') {
      const last = blocks.at(-1);
      if (last?.kind === 'assistant') last.text += `\n${event.text}`; else blocks.push({kind: 'assistant', text: event.text});
    } else if (event.kind === 'tool') {
      const existing = tools.get(event.id);
      if (existing) {
        if (event.detail) existing.detail = event.detail;
        if (event.status === 'failed') existing.text += ' · failed';
      } else {
        const block = {kind: 'tool' as const, text: `${event.name}${event.target ? ` ${event.target}` : ''}`, id: event.id, ...(event.detail ? {detail: event.detail} : {})};
        tools.set(event.id, block);
        blocks.push(block);
      }
    } else if (event.kind === 'approval') blocks.push({kind: 'note', text: `Approval requested: ${event.tool}${event.target ? ` ${event.target}` : ''}`});
    else if (event.kind === 'approvalAnswered') blocks.push({kind: 'note', text: event.allowed ? 'You allowed it.' : 'You denied it.'});
    else if (event.kind === 'settled') blocks.push({kind: 'note', text: event.ok ? 'Finished; waiting for you.' : `Run failed${event.message ? ` (${event.message})` : ''}.`});
    else if (event.kind === 'exited') blocks.push({kind: 'note', text: `The harness process ended${event.code ? ` (exit ${event.code})` : ''}.`});
  }
  return blocks;
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (line && displayWidth(line + word) > width && word.trim()) { out.push(line.trimEnd()); line = word.trimStart(); } else line += word;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function renderAgentView(session: AgentSession, state: AgentViewState, columns: number, height: number, now: number): string[] {
  const descriptor = harness(session.harness);
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const marker = foreground(UI_COLORS.accent);
  const width = Math.max(20, columns - 4);
  const header = [`${signatureChip(session.signature)}${accent(descriptor)}${glyphOf(descriptor)}${RESET} ${primary}${descriptor?.short ?? session.harness} · ${session.title}${RESET}`,
    `  ${subtle}${session.cwd ? `${session.cwd.replace(/^\/(?:Users|home)\/[^/]+/u, '~')} · ` : ''}${stateLabel(session, now)}${/\d+[smh]$/u.test(stateLabel(session, now)) ? '' : ` · ${elapsedLabel(now - session.startedAt)}`} · ${session.level === 'managed' ? 'Managed' : 'Observed only'}${RESET}`, ''];
  const body: string[] = [];
  if (session.level === 'observed') {
    body.push(...wrap(`NMSh can see this ${descriptor?.name ?? session.harness} process but has no supported way to read or control its conversation.`, width - 2).map(line => `  ${secondary}${line}${RESET}`),
      `  ${subtle}${[session.tty ? `terminal ${session.tty}` : undefined, session.pid ? `pid ${session.pid}` : undefined, `running ${elapsedLabel(now - session.startedAt)}`].filter(Boolean).join(' · ')}${RESET}`);
    if (descriptor?.controlNote) body.push(...wrap(descriptor.controlNote, width - 2).map(line => `  ${subtle}${line}${RESET}`));
  } else {
    for (const block of agentBlocks(session)) {
      if (block.kind === 'user') body.push(`  ${subtle}You${RESET}`, ...wrap(block.text, width - 2).map(line => `  ${primary}${line}${RESET}`), '');
      else if (block.kind === 'assistant') body.push(`  ${accent(descriptor)}${descriptor?.short ?? 'Agent'}${RESET}`, ...wrap(block.text, width - 2).map(line => `  ${secondary}${line}${RESET}`), '');
      else if (block.kind === 'note') body.push(`  ${subtle}${block.text}${RESET}`, '');
      else {
        body.push(`    ${secondary}${block.text}${RESET}`);
        const lines = block.detail ? block.detail.split('\n') : [];
        if (lines.length) {
          if (state.expanded.has(block.id!)) body.push(...lines.slice(0, 400).map(line => `      ${subtle}${line}${RESET}`));
          else body.push(`    ${subtle}› ${lines.length} detail line${lines.length === 1 ? '' : 's'} hidden · Ctrl+O${RESET}`);
        }
      }
    }
  }
  const footer: string[] = [''];
  if (session.pendingApproval) {
    footer.push(`  ${marker}${descriptor?.short ?? 'The agent'} asks to use ${session.pendingApproval.tool}${session.pendingApproval.target ? ` on ${session.pendingApproval.target}` : ''}.${RESET}`,
      `  ${primary}[A] Allow once${RESET}   ${primary}[D] Deny${RESET}   ${subtle}NMSh never answers for you.${RESET}`);
  }
  if (session.level === 'managed' && session.state !== 'exited' && session.state !== 'failed') {
    footer.push(`  ${marker}›${RESET} ${state.input ? `${primary}${state.input.split('\n')[0]}${RESET}` : `${subtle}type to ${descriptor?.short ?? 'the agent'}… (input goes to the agent, not the shell)${RESET}`}${marker}▏${RESET}`);
  }
  if (state.message) footer.push(`  ${secondary}${state.message}${RESET}`);
  footer.push('', renderControls([...(session.level === 'managed' ? [['Enter', 'send'] as [string, string], ['Ctrl+O', 'details'] as [string, string]] : []),
    ...(session.state === 'working' ? [['Ctrl+C', 'interrupt'] as [string, string]] : []), ['PgUp/PgDn', 'scroll'], ['Esc', 'back to shell']]));
  const room = Math.max(3, height - header.length - footer.length);
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, body.length - room)));
  const end = body.length - state.scroll;
  const visible = body.slice(Math.max(0, end - room), end);
  return [...header, ...visible, ...footer].map(line => truncateAnsi(line, columns));
}

/** A session's familiar name with its subtle accent (plain text without color); the name itself is the cue. */
export function signatureChip(signature: string | undefined, width = 0): string {
  if (!signature) return '';
  const accent = signatureAccent(signature);
  const text = width ? signature.padEnd(width) : signature;
  return `${accent ? foreground(accent) : ''}${text}\u001b[0m `;
}
