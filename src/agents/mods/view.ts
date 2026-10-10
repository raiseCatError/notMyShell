import {displayWidth, padCells, truncateAnsi, truncateText} from '../../util/text.js';
import {displayText} from '../transcript/projection.js';
import {renderTabStrip, selectedRowBand, onSelectedBand} from '../../ui/PanelShell.js';
import {renderControlRows} from '../../ui/controls.js';
import {groupedWindow, groupLines} from '../../ui/groupedList.js';
import {foreground, UI_COLORS} from '../../ui/palette.js';
import {getCurrentGlyphMode, GLYPHS} from '../../ui/glyphs.js';
import {harness} from '../harnesses.js';
import {MOD_TABS, type ModsController} from './controller.js';
import type {ModEntry} from './model.js';

/**
 * The /mods (/extensions) inventory as a native NMSh menu: the shared tab strip, a search and provider row,
 * grouped rows with the shared selected band, and a contextual footer. Browsing shows each entry's name, state and
 * scope; the selected entry's execution facts stay visible below the list in one line. Enter opens the full
 * record (execution, then provenance). Nothing here claims an NMSh sandbox: provider-native entries run inside
 * their provider, portable descriptors and Context Packs are not executable.
 */
const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const FIELD = 13;

const color = () => ({
  primary: foreground(UI_COLORS.primary), secondary: foreground(UI_COLORS.secondary), subtle: foreground(UI_COLORS.subtle),
  accent: foreground(UI_COLORS.accent), failure: foreground(UI_COLORS.failure), success: foreground(UI_COLORS.success),
});
const clean = (value: string | undefined, limit = 512) => value ? displayText(value).replace(/\n/gu, ' ').slice(0, limit) : '';

/** Provider display name from the harness registry; NMSh's own entries read as NMSh. */
function providerName(entry: ModEntry): string {
  return entry.provider === 'nmsh' ? 'NMSh' : clean(harness(entry.provider)?.name ?? entry.provider, 40);
}

/** Group title: the kind, and for provider-native entries the provider and launch profile they were listed from. */
export function modGroup(entry: ModEntry): string {
  if (entry.kind !== 'Provider-native') return entry.kind === 'Portable' ? 'Portable descriptors' : 'Context Packs';
  return `${providerName(entry)}${entry.profileId ? ` · ${clean(entry.profileId, 40)}` : ''}`;
}

/** One state word, factual: enabled/disabled only when the source reported it. */
export function modState(entry: ModEntry): {text: string; tone: 'on' | 'off' | 'unknown' | 'inert'} {
  if (entry.sandbox === 'Not executable' && entry.kind === 'Portable') return {text: 'inert', tone: 'inert'};
  if (entry.enabled === 'yes') return {text: 'enabled', tone: 'on'};
  if (entry.enabled === 'no') return {text: 'disabled', tone: 'off'};
  return {text: 'state unknown', tone: 'unknown'};
}

/** Where the entry's code runs, in words, with no implied sandbox. */
export function modExecution(entry: ModEntry): string {
  if (entry.kind === 'Provider-native') return `runs inside ${clean(entry.executesInside, 60)} · no NMSh sandbox · not managed by NMSh`;
  if (entry.kind === 'Portable') return 'inert descriptor · not executable · no privileges granted';
  return 'declarative Context Pack · not executable';
}

function permissions(entry: ModEntry): string {
  if (entry.permissions.length) return entry.permissions.map(item => clean(item, 80)).join(', ');
  return entry.kind === 'Provider-native' ? 'unknown (provider-owned)' : 'none';
}

const INSTALLED_BY: Record<ModEntry['installedBy'], string> = {nmsh: 'NMSh', provider: 'the provider', external: 'outside NMSh', unknown: 'unknown'};
const SCOPE: Record<ModEntry['scope'], string> = {global: 'global', project: 'this project', target: 'per target', unknown: 'unknown scope'};

function stateStyle(tone: ReturnType<typeof modState>['tone'], selected: boolean): string {
  const c = color();
  if (tone === 'on') return c.success;
  if (tone === 'off') return selected ? onSelectedBand() : c.subtle;
  return selected ? onSelectedBand() : c.secondary;
}

function row(entry: ModEntry, selected: boolean, columns: number): string {
  const c = color();
  const state = modState(entry);
  // State is never dropped: narrow rows use its short form.
  const wide = columns >= 44;
  const stateWidth = wide ? 15 : 9;
  const nameWidth = columns >= 90 ? 40 : columns >= 60 ? Math.max(16, columns - 40) : Math.max(4, columns - 4 - stateWidth);
  const short = {on: 'on', off: 'off', unknown: 'unknown', inert: 'inert'} as const;
  const meta = [SCOPE[entry.scope], entry.version ? clean(entry.version, 24) : ''].filter(Boolean).join(' · ');
  const name = padCells(truncateText(clean(entry.name, 200), nameWidth - 2), nameWidth, 0);
  const stateText = padCells(wide ? state.text : short[state.tone], stateWidth, 0);
  const metaText = columns >= 60 ? meta : '';
  if (!selected) return truncateAnsi(`    ${c.secondary}${name}${RESET}${stateStyle(state.tone, false)}${stateText}${RESET}${c.subtle}${metaText}${RESET}`, columns);
  // The shared selected band: pointer, bold name, quiet parts lifted onto the band; state keeps its words.
  return selectedRowBand(`  ${c.accent}${GLYPHS.selection}${RESET} ${BOLD}${c.accent}${name}${RESET}${stateStyle(state.tone, true)}${stateText}${RESET}${onSelectedBand()}${metaText}`, columns);
}

function controls(state: ModsController, columns: number): string[] {
  const safe = getCurrentGlyphMode() === 'safe';
  const pairs: Array<[string, string]> = state.owner === 'SEARCH'
    ? [['type', 'filter'], ['Enter', 'details'], ['Esc', 'clear search']]
    : state.details
      ? [[safe ? 'Up/Down' : '↑↓', 'scroll'], ['R', 'refresh'], ['Esc', 'back to list']]
      : [[safe ? 'Up/Down' : '↑↓', 'select'], ['Tab', 'kind'], ...(state.rows.length ? [['Enter', 'details'] as [string, string]] : []), ['/', 'search'], ['P', 'provider'], ['R', 'refresh'], ['Esc', 'close']];
  return renderControlRows(pairs, columns);
}

function detail(entry: ModEntry, columns: number): string[] {
  const c = color();
  const width = Math.max(1, columns - 2 - FIELD);
  const field = (label: string, value: string, style = c.secondary) => wrapCells(value, width).map((line, index) =>
    `  ${c.subtle}${(index ? '' : label).padEnd(FIELD)}${RESET}${style}${line}${RESET}`);
  const state = modState(entry);
  const head = `  ${BOLD}${c.primary}${clean(entry.name, 200)}${RESET}  ${stateStyle(state.tone, false)}${state.text}${RESET}  ${c.subtle}${entry.kind} · ${providerName(entry)}${RESET}`;
  return [
    head,
    ...(entry.description ? wrapCells(clean(entry.description, 600), Math.max(1, columns - 2)).map(line => `  ${c.subtle}${line}${RESET}`) : []),
    '',
    `  ${c.accent}Execution${RESET}`,
    ...field('Runs', entry.kind === 'Provider-native' ? `inside ${clean(entry.executesInside, 60)}, under the provider's own controls` : entry.kind === 'Portable' ? 'nowhere: an inert descriptor with no executable code' : 'nowhere: a declarative pack NMSh reads as data'),
    ...field('Sandbox', entry.kind === 'Provider-native' ? 'none from NMSh' : 'not applicable (not executable)', entry.kind === 'Provider-native' ? c.failure : c.secondary),
    ...field('Managed', entry.managed ? 'by NMSh' : 'not by NMSh'),
    ...field('Permissions', permissions(entry)),
    ...(entry.kind === 'Portable' ? field('Grants', 'none: files, network, processes, secrets, approvals and other targets are all denied') : []),
    '',
    `  ${c.accent}Provenance${RESET}`,
    ...field('Installed by', INSTALLED_BY[entry.installedBy]),
    ...field('Source', clean(entry.source)),
    ...field('Scope', `${SCOPE[entry.scope]}${entry.profileId ? ` · profile ${clean(entry.profileId, 40)}` : ''}`),
    ...field('Version', entry.version ? clean(entry.version, 40) : 'unknown'),
    ...(entry.reference ? field('Location', clean(entry.reference)) : []),
    ...field('Evidence', clean(entry.evidence)),
    ...field('Trust', 'unknown: listing or integrity is not trust'),
    '',
    ...wrapCells('Enabling or disabling is not available here; use the provider, or the Context Pack workflow for packs.', Math.max(1, columns - 2)).map(line => `  ${c.subtle}${line}${RESET}`),
  ];
}

/** Word wrap in display cells; hard-breaks only words wider than the line. */
function wrapCells(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/(\s+)/u)) {
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
  return out;
}

export function renderMods(state: ModsController, columns: number, height: number): string[] {
  const width = Math.max(1, columns);
  const c = color();
  const status = state.refreshing ? `${c.subtle}refreshing…${RESET}` : state.stale ? `${c.failure}stale${RESET}` : '';
  // The subtitle shortens by whole clauses, never mid-phrase; the refresh state always keeps its place.
  const reserve = status ? displayWidth(status) + 2 : 0;
  const subtitle = ['provider extensions and NMSh packs · inventory only; nothing runs from here', 'inventory only; nothing runs from here', '']
    .find(text => !text || 8 + displayWidth(text) + reserve <= width)!;
  const title = `${c.primary}  Mods${RESET}${subtitle ? `  ${c.subtle}${subtitle}${RESET}` : ''}${status ? `  ${status}` : ''}`;
  const head = [title,
    renderTabStrip([...MOD_TABS], MOD_TABS.indexOf(state.tab), width, state.owner === 'PANEL' && !state.details)];
  const searching = state.owner === 'SEARCH';
  const caret = getCurrentGlyphMode() === 'safe' ? '_' : '▏';
  const search = searching ? `${c.primary}${clean(state.query, 256)}${c.accent}${caret}${RESET}` : state.query ? `${c.primary}${clean(state.query, 256)}${RESET}` : `${c.subtle}/ to filter${RESET}`;
  const provider = state.provider ? clean(harness(state.provider)?.name ?? state.provider, 40) : 'All';
  head.push(`  ${c.subtle}Search${RESET}  ${search}${RESET}   ${c.subtle}Provider${RESET}  ${c.secondary}${provider}${RESET}`, '');
  const footer = controls(state, width);
  const message = state.message ? wrapCells(clean(state.message, 400), Math.max(1, width - 2)).map(line => `  ${c.secondary}${line}${RESET}`) : [];
  const rows = state.rows;
  const selected = rows[state.selected];

  let body: string[];
  if (state.details && selected) {
    const lines = detail(selected, width);
    const room = Math.max(1, height - head.length - message.length - footer.length - 1);
    const offset = Math.min(state.scroll, Math.max(0, lines.length - room));
    body = lines.slice(offset, offset + room);
    if (offset + room < lines.length) body[body.length - 1] = `  ${c.subtle}${getCurrentGlyphMode() === 'nerd' ? '↓ more · ↑↓ scroll' : 'v more · Up/Down scroll'}${RESET}`;
  } else if (!rows.length) {
    body = [`  ${c.subtle}${state.refreshing ? 'Reading the inventory…' : state.query || state.provider || state.tab !== 'All' ? 'No matching mods.' : 'No mods found.'}${RESET}`];
  } else {
    // Below the list: a more cue, then the selected entry's execution facts and evidence.
    // The execution facts wrap rather than truncate: they are never cut at narrow widths. Evidence is secondary.
    const summary = selected ? [
      ...wrapCells(modExecution(selected), Math.max(1, width - 2)).map(line => `  ${c.secondary}${line}${RESET}`),
      `  ${c.subtle}${truncateText(clean(selected.evidence), Math.max(1, width - 2))}${RESET}`,
    ] : [];
    const lines = groupLines(rows, modGroup);
    const budget = Math.max(1, height - head.length - summary.length - message.length - footer.length - 3);
    const line = lines.findIndex(item => item.kind === 'item' && item.index === state.selected);
    const {start, end} = groupedWindow(lines, line, budget);
    body = lines.slice(start, end).map(item => item.kind === 'header' ? `  ${c.accent}${clean(item.title, 120)}${RESET}` : row(item.item, item.index === state.selected, width));
    const more = lines.slice(end).filter(item => item.kind === 'item').length;
    if (more) body.push(`  ${c.subtle}${getCurrentGlyphMode() === 'nerd' ? '↓' : 'v'} ${more} more${RESET}`);
    body.push('', ...summary);
  }
  const content = [...head, ...body, ...(message.length ? ['', ...message] : [])];
  const room = Math.max(1, height - footer.length - 1);
  return [...content.slice(0, room), '', ...footer].slice(0, Math.max(1, height)).map(line => truncateAnsi(line, width));
}
