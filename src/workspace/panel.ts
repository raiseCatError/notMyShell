import type {ContextFact} from '../context/facts.js';
import {projectFactValue, safeContextText} from '../context/facts.js';
import {parsePatch, type DiffLine} from '../githubWorkspace/diff.js';
import {sanitizePatchLine} from '../githubWorkspace/sanitize.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateText} from '../util/text.js';
import {checkoutLabel, stateWords, type WorktreeRecord} from '../worktrees/model.js';
import {bindingHelp, DEFAULT_BINDINGS, type Binding, type WorkspaceActionId} from './keymap.js';
import {isStale, resourceText, type ActivationIntent, type WorkspaceResource} from './resources.js';

/**
 * Contextual detail panel (#332): explains what is selected or current
 * without becoming an editor. Content is typed, bounded and read-only;
 * providers are pure functions over data the caller already has (a sidebar
 * resource, a worktree record, a diff text, a Context Engine fact), so the
 * panel never performs I/O and never interprets arbitrary PTY output.
 * Opening or editing a file is a hand-off to the person's editor.
 *
 * Every content names its source and, when known, when it was observed;
 * partial content says what is missing.
 */

export type PanelLine =
  | {kind: 'heading' | 'text' | 'muted' | 'warning'; text: string}
  | {kind: 'field'; label: string; value: string}
  | {kind: 'diff'; line: DiffLine}
  | {kind: 'blank'};

export interface PanelContent {
  /** Stable identity: the same content refreshed keeps its scroll position. */
  id: string;
  title: string;
  /** Where the content came from, in words (`tmux list-panes`, `git worktree list`, `Context Engine: runtime.node`). */
  source: string;
  observedAt?: number;
  /** Why the content is incomplete, when it is. */
  partial?: string;
  lines: PanelLine[];
}

export const MAX_PANEL_LINES = 2000;
const text = (value: string, limit = 240) => resourceText(value, limit);

function describeIntent(intent: ActivationIntent): string {
  switch (intent.kind) {
    case 'tmux': return `tmux selects this ${intent.scope} and switches your client to it`;
    case 'changeDirectory': return `the shell changes directory to ${text(intent.path)}`;
    case 'nmshSession': return 'NMSh switches to this session';
    case 'managedTarget': return 'NMSh switches to this agent target';
    case 'openManager': return `opens ${intent.command}${intent.argument ? ` ${text(intent.argument, 80)}` : ''}`;
  }
}

/** What a sidebar resource is and what opening it would do; shown on selection (a preview), never acting. */
export function resourceDetail(resource: WorkspaceResource): PanelContent {
  const lines: PanelLine[] = [{kind: 'field', label: 'Kind', value: resource.kind}];
  if (resource.detail) lines.push({kind: 'field', label: 'Detail', value: text(resource.detail)});
  if (resource.active) lines.push({kind: 'field', label: 'State', value: 'active'});
  if (resource.attention) lines.push({kind: 'warning', text: `Needs attention: ${resource.attention}`});
  lines.push({kind: 'blank'});
  if (resource.support === 'activatable' && resource.activation) lines.push({kind: 'text', text: `Enter: ${describeIntent(resource.activation)}.`});
  else lines.push({kind: 'muted', text: `Cannot be opened here: ${text(resource.reason ?? 'no supported path')}.`});
  if (resource.children?.length) lines.push({kind: 'muted', text: `${resource.children.length} item${resource.children.length === 1 ? '' : 's'} inside.`});
  return {id: `resource:${resource.id}`, title: text(resource.label, 120), source: 'sidebar listing', ...(resource.observedAt !== undefined ? {observedAt: resource.observedAt} : {}), lines};
}

/** A Git worktree as `/worktrees` discovered it: every field is Git's or the filesystem's, nothing inferred. */
export function worktreeDetail(worktree: WorktreeRecord, observedAt: number): PanelContent {
  const lines: PanelLine[] = [
    {kind: 'field', label: 'Path', value: text(worktree.path)},
    {kind: 'field', label: 'Checkout', value: checkoutLabel(worktree)},
    ...(worktree.head ? [{kind: 'field' as const, label: 'HEAD', value: worktree.head.slice(0, 12)}] : []),
  ];
  const status = worktree.status;
  if (status.kind === 'dirty') {
    const counts = Object.entries(status.counts).filter(([, count]) => typeof count === 'number' && count > 0).map(([name, count]) => `${count} ${name}`);
    lines.push({kind: 'field', label: 'Status', value: counts.join(', ') || 'changes'});
  } else lines.push({kind: 'field', label: 'Status', value: status.kind === 'clean' ? 'clean' : `unknown (${text(status.reason, 120)})`});
  const words = stateWords(worktree).filter(word => !/^(clean|dirty)/u.test(word));
  if (words.length) lines.push({kind: 'muted', text: words.join(' · ')});
  lines.push({kind: 'blank'}, {kind: 'muted', text: 'Diff, creation and removal: /worktrees.'});
  return {id: `worktree:${worktree.id}`, title: checkoutLabel(worktree), source: 'git worktree list and git status', observedAt, lines};
}

/**
 * A local unified diff (`git diff` output) as bounded, read-only lines. Hunks go through the same parser and line
 * sanitizer as the GitHub review diff; file headers become headings. Binary and over-budget content is named, not shown.
 */
export function diffContent(id: string, title: string, diff: string, source: string, observedAt?: number, budget = 1500): PanelContent {
  const lines: PanelLine[] = [];
  let used = 0, cut = false;
  const sections = diff.split(/^(?=diff --git )/mu).filter(section => section.trim());
  for (const section of sections) {
    if (lines.length >= MAX_PANEL_LINES || used >= budget) { cut = true; break; }
    const header = /^diff --git a\/(.{1,1024}?) b\/(.{1,1024})$/mu.exec(section);
    lines.push({kind: 'heading', text: header ? (header[1] === header[2] ? text(header[2]!) : `${text(header[1]!)} → ${text(header[2]!)}`) : 'diff'});
    if (/^Binary files .* differ$/mu.test(section)) { lines.push({kind: 'muted', text: 'binary file: not shown'}); continue; }
    const start = section.search(/^@@ /mu);
    if (start === -1) { lines.push({kind: 'muted', text: 'no content changes (mode or rename only)'}); continue; }
    const parsed = parsePatch(section.slice(start), budget - used);
    used += parsed.lines;
    for (const hunk of parsed.hunks) {
      lines.push({kind: 'muted', text: sanitizePatchLine(hunk.header, 240).text});
      for (const line of hunk.lines) lines.push({kind: 'diff', line});
    }
    if (parsed.cut) { cut = true; lines.push({kind: 'warning', text: 'cut here: the rest is not shown'}); }
  }
  if (!sections.length) lines.push({kind: 'muted', text: 'no changes'});
  return {id, title: text(title, 120), source, ...(observedAt !== undefined ? {observedAt} : {}),
    ...(cut ? {partial: `diff shown up to ${budget} lines; open it in your diff tool for the rest`} : {}), lines: lines.slice(0, MAX_PANEL_LINES)};
}

/**
 * A Context Engine fact as a module's detail: its displayable value, provenance, freshness and policy. Only what the fact
 * carries; diagnostics (why a module shows, timings, engine health) are #365's explain view, which the panel should
 * present instead at integration.
 */
export function factDetail(capabilityId: string, title: string, reads: readonly string[], fact: ContextFact<unknown> | undefined, now: number): PanelContent {
  const lines: PanelLine[] = [];
  const value = fact ? projectFactValue(fact, 'display') : undefined;
  if (!fact) lines.push({kind: 'muted', text: 'Not collected: the module is hidden, not demanded here, or nothing applies.'});
  else if (value === undefined) lines.push({kind: 'muted', text: 'Collected, but not displayable under its privacy policy.'});
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 32)) lines.push({kind: 'field', label: key, value: safeContextText(String(item), 120)});
  } else lines.push({kind: 'field', label: 'value', value: safeContextText(String(value), 120)});
  if (fact) {
    lines.push({kind: 'blank'},
      {kind: 'field', label: 'Evidence', value: safeContextText(fact.source.evidence, 160)},
      {kind: 'field', label: 'Collected', value: fact.collectedAt ? `${Math.max(0, Math.round((now - fact.collectedAt) / 1000))} s ago` : 'unknown'},
      {kind: 'field', label: 'Freshness', value: fact.freshness},
      {kind: 'field', label: 'Policy', value: `${fact.sensitivity}, ${fact.persistence}`});
  }
  lines.push({kind: 'blank'}, {kind: 'heading', text: 'Reads'}, ...reads.slice(0, 16).map(read => ({kind: 'muted' as const, text: text(read, 240)})));
  return {id: `fact:${capabilityId}`, title: text(title, 120), source: `Context Engine: ${capabilityId}`, ...(fact?.collectedAt ? {observedAt: fact.collectedAt} : {}), lines};
}

export class PanelController {
  content?: PanelContent;
  scroll = 0;
  /** Recently shown content by id, so moving the sidebar selection can show a preview without asking anyone again. */
  private readonly cache = new Map<string, PanelContent>();

  show(content: PanelContent): void {
    if (this.content?.id !== content.id) this.scroll = 0;
    this.content = {...content, lines: content.lines.slice(0, MAX_PANEL_LINES)};
    this.cache.delete(content.id);
    this.cache.set(content.id, this.content);
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Cached content for an id (a preview), or undefined: the caller decides whether fetching is worth it. */
  cached(id: string): PanelContent | undefined {
    return this.cache.get(id);
  }

  clear(): void { this.content = undefined; this.scroll = 0; }

  dispatch(action: WorkspaceActionId, viewRows: number): void {
    const page = Math.max(1, viewRows - 1);
    const delta = action === 'panel.up' ? -1 : action === 'panel.down' ? 1 : action === 'panel.pageUp' ? -page : action === 'panel.pageDown' ? page : 0;
    this.scroll = Math.max(0, this.scroll + delta);
  }
}

export interface PanelRenderOptions {
  width: number;
  rows: number;
  focused: boolean;
  safe: boolean;
  color: boolean;
  now: number;
  /** Content older than this is labelled stale. */
  freshnessMs?: number;
  bindings?: readonly Binding[];
}

function age(now: number, at: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.round(seconds / 60)}m ago` : `${Math.round(seconds / 3600)}h ago`;
}

/** Long text wraps at the width; diff lines are cut (their columns matter), keeping the +/- marker. */
function layoutLine(line: PanelLine, width: number): Array<{text: string; tone: 'primary' | 'secondary' | 'subtle' | 'warning' | 'add' | 'del'; bold?: boolean}> {
  const wrap = (value: string, tone: 'primary' | 'secondary' | 'subtle' | 'warning', bold = false) => {
    const out: Array<{text: string; tone: typeof tone; bold: boolean}> = [];
    let rest = value;
    while (displayWidth(rest) > width && out.length < 64) {
      let cut = truncateText(rest, width + 1).replace(/…$/u, '');
      const space = cut.lastIndexOf(' ');
      if (space > width / 2) cut = cut.slice(0, space);
      out.push({text: cut, tone, bold});
      rest = rest.slice(cut.length).trimStart();
    }
    out.push({text: rest, tone, bold});
    return out;
  };
  switch (line.kind) {
    case 'blank': return [{text: '', tone: 'primary'}];
    case 'heading': return wrap(line.text, 'primary', true);
    case 'text': return wrap(line.text, 'primary');
    case 'muted': return wrap(line.text, 'subtle');
    case 'warning': return wrap(`! ${line.text}`, 'warning');
    case 'field': return wrap(`${line.label}: ${line.value}`, 'secondary');
    case 'diff': {
      const mark = line.line.kind === 'add' ? '+' : line.line.kind === 'del' ? '-' : line.line.kind === 'note' ? '\\ ' : ' ';
      return [{text: truncateText(`${mark}${line.line.text}`, width), tone: line.line.kind === 'add' ? 'add' : line.line.kind === 'del' ? 'del' : 'subtle'}];
    }
  }
}

/** Exactly `rows` lines of at most `width` cells; pure. The title marks focus; the second row names the source and age. */
export function renderPanel(controller: PanelController, options: PanelRenderOptions): string[] {
  const width = Math.max(1, options.width);
  const rows = Math.max(1, options.rows);
  const reset = options.color ? '\u001b[0m' : '';
  const colors = {primary: UI_COLORS.primary, secondary: UI_COLORS.secondary, subtle: UI_COLORS.subtle, warning: UI_COLORS.failure, add: UI_COLORS.success, del: UI_COLORS.failure};
  const paint = (value: string, tone: keyof typeof colors, bold = false) => options.color ? `${bold ? '\u001b[1m' : ''}${foreground(colors[tone])}${value}${reset}` : value;
  const content = controller.content;
  const focusMark = options.focused ? (options.safe ? '>' : '▸') : ' ';
  const header: string[] = [];
  const titleText = truncateText(`${focusMark} ${content?.title ?? 'Details'}`, width);
  header.push(options.focused && options.color ? `\u001b[1m${foreground(UI_COLORS.accent)}${titleText}${reset}` : paint(titleText, 'primary', options.focused));
  if (content) {
    const stale = content.observedAt === undefined || isStale(content, options.now, options.freshnessMs ?? 60_000);
    const when = content.observedAt === undefined ? 'time unknown' : `${age(options.now, content.observedAt)}${stale ? ', stale' : ''}`;
    header.push(paint(truncateText(`${content.source} · ${when}`, width), 'subtle'));
    if (content.partial) header.push(paint(truncateText(`partial: ${content.partial}`, width), 'warning'));
  }
  const body = content ? content.lines.flatMap(line => layoutLine(line, width)) : [{text: 'Select something to see its details.', tone: 'subtle' as const}];
  const footer: string[] = [];
  const height = Math.max(0, rows - header.length - (options.focused ? 1 : 0));
  controller.scroll = Math.min(controller.scroll, Math.max(0, body.length - height));
  if (options.focused) {
    const position = body.length > height ? `${controller.scroll + 1}-${Math.min(body.length, controller.scroll + height)}/${body.length} · ` : '';
    const help = bindingHelp(options.bindings ?? DEFAULT_BINDINGS, 'panel').filter(([, label]) => ['scroll down', 'close panel', 'back to the composer'].includes(label))
      .map(([chord, label]) => `${chord} ${label}`).join(' · ');
    footer.push(paint(truncateText(`${position}${help}`, width), 'subtle'));
  }
  const lines = [...header];
  for (const item of body.slice(controller.scroll, controller.scroll + height)) lines.push(paint(truncateText(item.text, width), item.tone, item.bold));
  while (lines.length < rows - footer.length) lines.push('');
  lines.push(...footer);
  return lines.slice(0, rows);
}
