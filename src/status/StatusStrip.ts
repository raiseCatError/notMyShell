import {linuxBattery, parseMeminfo, parsePmset, parseVmStat, type SystemStats} from './systemStats.js';
import type {StatusStripSettings, StripZone} from '../prompt/configuration.js';
import type {ContextFacts} from '../context/facts.js';
import {safeContextText} from '../context/facts.js';
import {presentationNow} from '../presentation/environment.js';
import {semanticIcon, type SemanticIconId} from '../prompt/glyphChoices.js';
import {renderPowerlineBlocks, type PowerlineBlock} from '../prompt/powerline.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {displayWidth, stripAnsi} from '../util/text.js';

export {linuxBattery, parseMeminfo, parsePmset, parseVmStat, type SystemStats};

/**
 * The optional NMSh-owned Status Strip: one row of live facts at the top or
 * bottom edge of the NMSh pane, in independent left, center and right groups.
 * It is presentation only (never in the transcript, /copy, prompt snapshots,
 * the session journal or history), hidden during passthrough and on tiny
 * terminals, and it collects nothing itself: its clock, CPU, RAM, battery and
 * uptime are Context Engine facts demanded only while the row is showing, and
 * routed modules are the same resolved facts every surface uses. Rendering is
 * pure: no filesystem, subprocess or network access happens here.
 */

/** Below this width the strip yields its row to the transcript. */
export const STRIP_MIN_COLUMNS = 30;

/** The strip's own items, read from already-resolved Context Engine facts (render-safe, no I/O). */
export function stripStatsFromFacts(facts: ContextFacts): SystemStats & {now?: number} {
  const value = <T>(id: string) => (facts as Record<string, {value: unknown} | undefined>)[id]?.value as T | undefined;
  const cpu = value<{percent: number}>('system.cpu');
  const memory = value<{usedBytes: number; totalBytes: number}>('system.memory');
  const battery = value<{percent: number; charging: boolean}>('system.battery');
  const uptime = value<{seconds: number}>('system.uptime');
  const time = value<{now: number}>('system.time');
  return {
    ...(cpu ? {cpu: cpu.percent} : {}),
    ...(memory && memory.totalBytes > 0 ? {memory: {used: memory.usedBytes, total: memory.totalBytes}} : {}),
    ...(battery ? {battery} : {}),
    ...(uptime ? {uptimeSeconds: uptime.seconds} : {}),
    ...(time ? {now: time.now} : {}),
  };
}

function gigabytes(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface StripItem {icon: SemanticIconId | undefined; text: string; priority: number; compact?: string}

/** The strip's own items in display order; text always carries the meaning, icons are optional. */
export function stripItems(settings: StatusStripSettings, stats: SystemStats, now: Date = presentationNow()): StripItem[] {
  const items: StripItem[] = [];
  if (settings.uptime && stats.uptimeSeconds !== undefined) {
    const text = formatUptime(stats.uptimeSeconds);
    items.push({icon: 'uptime', text: `up ${text}`, compact: text.split(' ')[0], priority: 4});
  }
  if (settings.cpu && stats.cpu !== undefined) items.push({icon: 'cpu', text: `CPU ${Math.round(stats.cpu)}%`, priority: 3});
  if (settings.ram && stats.memory) {
    const percent = `${Math.round(100 * stats.memory.used / stats.memory.total)}%`;
    const absolute = `${gigabytes(stats.memory.used)}/${gigabytes(stats.memory.total)} GB`;
    items.push({icon: 'memory', priority: 2,
      text: `RAM ${settings.ramDisplay === 'percent' ? percent : settings.ramDisplay === 'absolute' ? absolute : `${percent} · ${absolute}`}`,
      ...(settings.ramDisplay === 'percent' ? {} : {compact: `RAM ${percent}`})});
  }
  // No battery hardware means no battery item, never a fake one.
  if (settings.battery && stats.battery) {
    items.push({icon: stats.battery.charging ? 'batteryCharging' : 'battery', text: `${stats.battery.percent}%`, priority: 1});
  }
  if (settings.clock) items.push({icon: 'clock', text: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, priority: 0});
  return items;
}

/** Keep Awake in the strip: present whenever it is active and the strip is on; its forms from widest to narrowest. */
export interface StripAwake {full: string; short: string; glyph: string}

/** A module routed to the strip: already rendered plain text, its role (failure is emphasized), its module priority 0..100, its group and narrower forms. */
export interface StripModuleItem {text: string; failure?: boolean; priority: number; zone?: StripZone; compact?: readonly string[]; id?: string}

/** One fitted item: its forms from widest to narrowest and which one is in use. */
interface Entry {
  zone: StripZone;
  forms: string[];
  form: number;
  icon?: string;
  /** Lower is kept longer. */
  rank: number;
  tone: 'secondary' | 'failure' | 'accent';
  /** Keep Awake narrows only after everything else has gone (it outranks every other item). */
  last?: boolean;
}

/** Hostile module text loses whole control sequences, then is bounded like every other display string. */
const clean = (text: string) => safeContextText(stripTerminalControls(text), 120);

function entries(settings: StatusStripSettings, stats: SystemStats, now: Date | undefined, awake: StripAwake | undefined, modules: readonly StripModuleItem[]): Entry[] {
  // Routed modules outlast the strip's own items; among them, higher module priority stays longest.
  const routed: Entry[] = modules.map(module => ({zone: module.zone ?? 'right', forms: [...new Set([clean(module.text), ...(module.compact ?? []).map(clean)])].filter(Boolean),
    form: 0, rank: -1 - module.priority / 1000, tone: module.failure ? 'failure' as const : 'secondary' as const})).filter(entry => entry.forms.length);
  const native: Entry[] = stripItems(settings, stats, now).map(item => {
    const icon = item.icon ? semanticIcon(item.icon) : '';
    return {zone: settings.nativeZone, forms: item.compact ? [item.text, item.compact] : [item.text], form: 0, ...(icon ? {icon} : {}), rank: item.priority, tone: 'secondary' as const};
  });
  const forms = awake ? [...new Set([awake.full, awake.short, awake.glyph])].filter(Boolean) : [];
  return [...routed, ...native, ...(forms.length ? [{zone: settings.nativeZone, forms, form: 0, rank: -Infinity, tone: 'accent' as const, last: true}] : [])];
}

const text = (entry: Entry) => `${entry.icon ? `${entry.icon} ` : ''}${entry.forms[entry.form]!}`;

/** Plain separators; Divided's bar has a Safe-glyph spelling. */
function separator(settings: StatusStripSettings): string {
  if (settings.separator === 'space') return '  ';
  if (settings.separator === 'bar') return getCurrentGlyphMode() === 'nerd' ? ' │ ' : ' | ';
  return ' · ';
}

const POWERLINE_TONES: Record<Entry['tone'], {foreground: RgbColor; background: RgbColor}> = {
  secondary: {foreground: UI_COLORS.projectForeground, background: UI_COLORS.cwdBackground},
  accent: {foreground: UI_COLORS.projectForeground, background: UI_COLORS.projectBackground},
  failure: {foreground: UI_COLORS.projectForeground, background: UI_COLORS.failure},
};

/** One group's painted text. Powerline reuses the prompt's own block geometry; the right group is mirrored toward the edge. */
function paintZone(zone: StripZone, list: readonly Entry[], settings: StatusStripSettings): string {
  if (!list.length) return '';
  if (settings.style === 'powerline') {
    const blocks: PowerlineBlock[] = list.map(entry => ({text: text(entry), ...POWERLINE_TONES[entry.tone]}));
    return renderPowerlineBlocks(blocks, 0, 1, 'wedge', false, 'wedge', 'wedge', undefined, 'previous', zone === 'right' ? 'mirrored' : 'normal');
  }
  const subtle = foreground(UI_COLORS.subtle);
  const tones = {secondary: foreground(UI_COLORS.secondary), failure: foreground(UI_COLORS.failure), accent: foreground(UI_COLORS.accent)};
  return list.map(entry => `${entry.icon ? `${subtle}${entry.icon} ` : ''}${tones[entry.tone]}${entry.forms[entry.form]!}`).join(`${subtle}${separator(settings)}`) + '\u001B[0m';
}

const ZONES: readonly StripZone[] = ['left', 'center', 'right'];
/** Space kept between groups, and at each end of the row. */
const GROUP_GAP = 2;
const MARGIN = 1;

/** Width of a group as painted (Powerline caps included), measured in display cells. */
function zoneWidth(zone: StripZone, list: readonly Entry[], settings: StatusStripSettings): number {
  if (!list.length) return 0;
  if (settings.style === 'powerline') return displayWidth(stripAnsi(paintZone(zone, list, settings)));
  return list.reduce((sum, entry, index) => sum + displayWidth(text(entry)) + (index ? displayWidth(separator(settings)) : 0), 0);
}

function fits(all: readonly Entry[], settings: StatusStripSettings, columns: number): boolean {
  const widths = ZONES.map(zone => zoneWidth(zone, all.filter(entry => entry.zone === zone), settings)).filter(width => width > 0);
  return widths.reduce((sum, width) => sum + width, 0) + GROUP_GAP * Math.max(0, widths.length - 1) + 2 * MARGIN <= columns;
}

/**
 * Deterministic width fitting: first every item that has a narrower form uses
 * it (lowest priority first), then the lowest-priority items drop, the center
 * group before the edge groups so the left and right anchors survive longest.
 * Keep Awake narrows (full, short, glyph) only once nothing else is left.
 */
function fit(all: Entry[], settings: StatusStripSettings, columns: number): Entry[] {
  let list = all.map(entry => ({...entry}));
  const lowest = (candidates: Entry[]) => candidates.reduce((worst, entry) => entry.rank > worst.rank ? entry : worst);
  while (list.length && !fits(list, settings, columns)) {
    const compactable = list.filter(entry => !entry.last && entry.form < entry.forms.length - 1);
    if (compactable.length) { lowest(compactable).form += 1; continue; }
    const droppable = list.filter(entry => !entry.last);
    if (droppable.length) {
      const center = droppable.filter(entry => entry.zone === 'center');
      const drop = lowest(center.length ? center : droppable);
      list = list.filter(entry => entry !== drop);
      continue;
    }
    const last = list.find(entry => entry.last && entry.form < entry.forms.length - 1);
    if (last) { last.form += 1; continue; }
    list = [];
  }
  return list;
}

/**
 * The strip row for `columns`, or '' when it is off, too narrow or empty. The
 * same function paints the live row and the /strip preview, so they cannot
 * disagree. Groups never overlap: the center group is centered when there is
 * room and otherwise pushed between its neighbours.
 */
export function renderStatusStrip(settings: StatusStripSettings, stats: SystemStats & {now?: number}, columns: number, now?: Date, awake?: StripAwake,
  modules: readonly StripModuleItem[] = []): string {
  if (!settings.enabled || columns < STRIP_MIN_COLUMNS) return '';
  const time = now ?? (stats.now !== undefined ? new Date(stats.now) : undefined);
  const list = fit(entries(settings, stats, time, awake, modules), settings, columns);
  if (!list.length) return '';
  const group = (zone: StripZone) => list.filter(entry => entry.zone === zone);
  const [left, center, right] = ZONES.map(zone => ({zone, painted: paintZone(zone, group(zone), settings), width: zoneWidth(zone, group(zone), settings)}));
  const leftEnd = left!.width ? MARGIN + left!.width : 0;
  const rightStart = right!.width ? columns - MARGIN - right!.width : columns;
  let centerStart = Math.floor((columns - center!.width) / 2);
  if (center!.width) centerStart = Math.max(leftEnd + (leftEnd ? GROUP_GAP : MARGIN), Math.min(centerStart, rightStart - (right!.width ? GROUP_GAP : MARGIN) - center!.width));
  let row = '';
  let at = 0;
  const place = (start: number, painted: string, width: number) => {
    if (!width) return;
    row += ' '.repeat(Math.max(0, start - at)) + painted;
    at = Math.max(at, start) + width;
  };
  place(MARGIN, left!.painted, left!.width);
  place(centerStart, center!.painted, center!.width);
  place(rightStart, right!.painted, right!.width);
  return row;
}

/** Whether the strip owns a row at this size. Content refreshes never change it, so facts arriving cannot make the screen jump. */
export function stripVisible(settings: StatusStripSettings, columns: number, rows: number): boolean {
  return settings.enabled && columns >= STRIP_MIN_COLUMNS && rows >= 8;
}
