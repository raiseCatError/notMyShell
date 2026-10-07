import {displayWidth, truncateAnsi} from '../../util/text.js';
import {displayText} from '../transcript/projection.js';
import {MOD_TABS, type ModsController} from './controller.js';

function wrap(text: string, columns: number): string[] {
  const out: string[] = []; let line = '';
  for (const c of displayText(text)) {if (displayWidth(line + c) > columns) {out.push(line); line = '';} line += c;}
  out.push(line); return out;
}
/** Plain, width-aware owned panel. Risk fields precede optional details. */
export function renderMods(state: ModsController, columns: number, height: number): string[] {
  const width = Math.max(1, columns);
  const lines = ['Mods / extensions', MOD_TABS.map(t => t === state.tab ? `[${t}]` : t).join(' | '),
    `Provider: ${state.provider ?? 'All'} · P changes filter`,
    `${state.owner === 'SEARCH' ? 'Search: ' : '/ search: '}${state.query}${state.refreshing ? ' · Refreshing' : state.stale ? ' · Stale' : ''}`];
  const rows = state.rows;
  if (!rows.length) lines.push('No matches');
  else {
    const start = Math.max(0, state.selected - 1);
    lines.push(...rows.slice(start, start + 3).map((i, n) => truncateAnsi(`${start + n === state.selected ? '>' : ' '} ${i.name} · ${i.kind}`, width)));
    const item = rows[state.selected]!;
    for (const label of [`${item.kind} · ${item.provider} · Scope: ${item.scope}`, ...(item.profileId ? [`Profile: ${item.profileId}`] : []), `Enabled: ${item.enabled} · Trust: unknown`,
      `Managed by NMSh: ${item.managed ? 'Yes' : 'No'}`, `Executes inside: ${item.executesInside}`, `NMSh sandbox: ${item.sandbox}`,
      `Installed by: ${item.installedBy}`, `Source: ${item.source}`,
      `Permissions: ${item.permissions.length ? item.permissions.join(', ') : item.kind === 'Provider-native' ? 'unknown (provider-owned)' : 'none'}`,
      ...(item.kind === 'Portable' ? ['Files: none · Network: none', 'Processes: none · Secrets: none', 'Approvals: none · Other targets: none'] : []),
      ...(state.details ? [`Source: ${item.source}`, `Version: ${item.version ?? 'unknown'}`, `Installed by: ${item.installedBy}`, `Reference: ${item.reference ?? 'none'}`, item.description ?? '', item.evidence, 'Enable/disable: unavailable here; use the provider or existing Context Pack workflow.'] : [])]) lines.push(...wrap(label, width));
  }
  if (state.message) lines.push(...wrap(state.message, width));
  const footer = [state.details ? 'Up/Down scroll · Esc back' : 'Up/Down select · Enter details', 'PgUp/PgDn scroll · R refresh', '/ search · Tab tabs · P provider'];
  const room = Math.max(1, height - footer.length);
  const offset = Math.min(state.scroll, Math.max(0, lines.length - room));
  return [...lines.slice(offset, offset + room), ...footer].slice(0, height).map(line => truncateAnsi(line, width));
}
