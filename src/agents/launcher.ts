import {renderControls} from '../ui/controls.js';
import {getCurrentGlyphMode, GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {colorLevel} from '../presentation/capabilities.js';
import {truncateAnsi} from '../util/text.js';
import {harness, type HarnessDescriptor} from './harnesses.js';
import type {AgentProfile} from './sessions/manager.js';
import type {AgentSession} from './sessions/model.js';
import type {DiscoveredProfile} from './profileDiscovery.js';

/**
 * The provider launcher (`/claude`, `/claude new`, `/ai` → Claude): one place that shows the provider's
 * existing targets and the launch profiles fresh targets start from. Profiles are persistent launch
 * identities; targets are conversations started from one. Selection never activates anything: Enter
 * opens, resumes or starts the selected row, N starts a fresh target, and nothing is chosen for the person.
 */

export type LauncherRow =
  | {kind: 'group'; label: string; detail?: string}
  | {kind: 'target'; session: AgentSession; profile?: AgentProfile}
  | {kind: 'new'; profile?: AgentProfile}
  | {kind: 'found'; profile: DiscoveredProfile}
  | {kind: 'import'}
  | {kind: 'skip'};

export interface LauncherState {
  provider: string;
  selected: number;
  query?: string;
  searching?: boolean;
  message?: string;
  /** Simple existing launch namespaces found passively, awaiting an explicit Import or Skip. */
  found?: DiscoveredProfile[];
}

export const profileLabel = (profile: AgentProfile): string => profile.label ?? profile.name;
const home = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+/u, '~');

/** What can truthfully be done with a target, in words: live states, resumability only with provider evidence. */
export function targetStatus(session: AgentSession): {label: string; live: boolean; resumable: boolean} {
  if (session.level === 'observed') return {label: 'Observed only', live: true, resumable: false};
  const resumable = Boolean(session.reconnectable && session.harnessSessionId);
  switch (session.state) {
    case 'starting': return {label: 'Starting', live: true, resumable};
    case 'working': return {label: session.activity ? `Working · ${session.activity}` : 'Working', live: true, resumable};
    case 'waiting': case 'finished': return {label: 'Waiting for you', live: true, resumable};
    case 'approval': return {label: 'Needs approval', live: true, resumable};
    case 'choice': return {label: 'Question for you', live: true, resumable};
    case 'running': return {label: 'Running', live: true, resumable};
    case 'exited': return {label: resumable ? 'Ended · resume available' : 'Ended · cannot resume', live: false, resumable};
    case 'failed': return {label: resumable ? 'Failed · resume available' : 'Failed · cannot resume', live: false, resumable};
  }
}

export function launcherRows(state: LauncherState, sessions: readonly AgentSession[], profiles: readonly AgentProfile[]): LauncherRow[] {
  const own = profiles.filter(profile => profile.harness === state.provider);
  const query = state.query?.toLowerCase();
  const matches = (text: string) => !query || text.toLowerCase().includes(query);
  const targets = sessions.filter(session => session.harness === state.provider)
    .sort((a, b) => Number(b.attention) - Number(a.attention) || b.updatedAt - a.updatedAt);
  const rows: LauncherRow[] = [];
  if (!own.length && state.found?.length) {
    rows.push({kind: 'group', label: `Found ${harness(state.provider)?.short ?? state.provider} profiles`, detail: 'from simple aliases in your shell files · nothing is saved until you import'});
    for (const profile of state.found) rows.push({kind: 'found', profile});
    rows.push({kind: 'import'}, {kind: 'skip'});
  }
  for (const profile of own) {
    const children = targets.filter(session => session.profileId === profile.name && matches(`${session.title} ${profileLabel(profile)}`));
    if (query && !children.length && !matches(profileLabel(profile))) continue;
    rows.push({kind: 'group', label: profileLabel(profile), detail: [profile.label ? profile.name : undefined, profile.configDir ? home(profile.configDir) : undefined, profile.model ? `model ${profile.model} (configured)` : undefined].filter(Boolean).join(' · ') || undefined});
    for (const session of children) rows.push({kind: 'target', session, profile});
    rows.push({kind: 'new', profile});
  }
  // Targets with no configured profile (the provider's default identity, or observed processes).
  const known = new Set(own.map(profile => profile.name));
  const other = targets.filter(session => !session.profileId || !known.has(session.profileId)).filter(session => matches(session.title));
  if (other.length || !own.length) {
    rows.push({kind: 'group', label: own.length ? 'Other targets' : `${harness(state.provider)?.name ?? state.provider} · default identity`,
      detail: own.length ? 'started without a launch profile, or found running' : 'uses the provider\'s own default configuration'});
    for (const session of other) rows.push({kind: 'target', session});
    // A fresh default-identity target only when no profile exists: configured profiles are never bypassed.
    if (!own.length) rows.push({kind: 'new'});
  }
  return rows;
}

const selectable = (row: LauncherRow | undefined) => Boolean(row && row.kind !== 'group' && row.kind !== 'found');

/** `/claude` starts on existing work (what needs attention, else the newest live, else the newest resumable); `/claude new` on a fresh target. */
export function initialSelection(rows: readonly LauncherRow[], mode: 'open' | 'new'): number {
  const importRow = rows.findIndex(row => row.kind === 'import');
  if (importRow >= 0) return importRow;
  const first = (test: (row: LauncherRow) => boolean) => rows.findIndex(test);
  if (mode === 'open') {
    const live = first(row => row.kind === 'target' && targetStatus(row.session).live && row.session.level === 'managed');
    if (live >= 0) return live;
    const resumable = first(row => row.kind === 'target' && targetStatus(row.session).resumable);
    if (resumable >= 0) return resumable;
  }
  const fresh = first(row => row.kind === 'new');
  return fresh >= 0 ? fresh : Math.max(0, first(selectable));
}

export function moveSelection(rows: readonly LauncherRow[], selected: number, direction: number): number {
  if (!rows.some(selectable)) return 0;
  let index = selected;
  for (let step = 0; step < rows.length; step++) {
    index = (index + direction + rows.length) % rows.length;
    if (selectable(rows[index])) return index;
  }
  return selected;
}

const RESET = '\u001b[0m';
const accent = (descriptor: HarnessDescriptor | undefined) => descriptor && colorLevel() !== 'none' ? foreground(hexColor(descriptor.color)) : '';
const glyphOf = (descriptor: HarnessDescriptor | undefined) => (getCurrentGlyphMode() === 'safe' ? descriptor?.safeGlyph : descriptor?.glyph) ?? '*';
export function hexColor(value: string) { return {red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)}; }

export function renderLauncher(state: LauncherState, rows: readonly LauncherRow[], columns: number, height = Infinity): string[] {
  const descriptor = harness(state.provider);
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const provider = accent(descriptor);
  const out = [`  ${provider}${glyphOf(descriptor)} ${descriptor?.name ?? state.provider}${RESET}  ${subtle}targets and launch profiles${RESET}`, ''];
  let selectedLine = 0;
  rows.forEach((row, index) => {
    const chosen = index === state.selected;
    if (chosen) selectedLine = out.length + (row.kind === 'group' && index > 0 ? 1 : 0);
    const pick = chosen ? `${provider || foreground(UI_COLORS.accent)}${GLYPHS.selection}${RESET}` : ' ';
    if (row.kind === 'group') {
      if (index > 0) out.push('');
      out.push(`  ${primary}${row.label}${RESET}${row.detail ? `  ${subtle}${row.detail}${RESET}` : ''}`);
    } else if (row.kind === 'target') {
      const status = targetStatus(row.session);
      const where = [row.session.model, row.session.cwd ? home(row.session.cwd) : undefined].filter(Boolean).join(' · ');
      out.push(`  ${pick} ${chosen ? provider : ''}${glyphOf(descriptor)}${RESET} ${chosen ? primary : secondary}${row.session.signature ? `${row.session.signature} · ` : ''}${row.session.title}${RESET}  ${subtle}${status.label}${where ? ` · ${where}` : ''}${RESET}`);
    } else if (row.kind === 'new') {
      out.push(`  ${pick} ${chosen ? primary : subtle}+ New target${row.profile ? '' : ' (default identity)'}${RESET}`);
    } else if (row.kind === 'found') {
      out.push(`      ${secondary}${row.profile.label}${RESET}  ${subtle}${row.profile.name} · ${home(row.profile.configDir)} · alias ${row.profile.alias}${RESET}`);
    } else {
      out.push(`  ${pick} ${chosen ? primary : subtle}${row.kind === 'import' ? 'Import these launch profiles' : 'Skip for now'}${RESET}`);
    }
  });
  if (state.message) out.push('', `  ${secondary}${state.message}${RESET}`);
  if (state.searching || state.query) out.push('', `  Search: ${state.query ?? ''}${state.searching ? '▏' : ''}`);
  out.push('', renderControls(state.searching ? [['Enter', 'done'], ['Esc', 'clear']] : [['↑↓', 'select'], ['Enter', 'open / resume / start'], ['N', 'new target'], ['/', 'search'], ['Esc', 'shell']]));
  // Bounded height: the header, then a window over the rows that keeps the selection visible, then the footer.
  if (Number.isFinite(height) && out.length > height) {
    const footer = out.slice(-2);
    const room = Math.max(1, height - 4);
    const bodyStart = 2;
    const body = out.slice(bodyStart, out.length - 2);
    const at = Math.max(0, Math.min(body.length - room, selectedLine - bodyStart - Math.floor(room / 2)));
    return [...out.slice(0, 2), ...body.slice(at, at + room), ...footer].map(line => truncateAnsi(line, columns));
  }
  return out.map(line => truncateAnsi(line, columns));
}
