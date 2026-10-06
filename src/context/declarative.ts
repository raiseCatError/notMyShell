import {projectFactValue, safeContextText, type ContextFacts} from './facts.js';
import {isModuleIcon, MODULE_ICONS} from './icons.js';
import {PACK_ROLE_THEME, type ContextModuleDefinition} from './modules.js';
import type {PackFormat, PackSegment, PackWhen} from './packs/schema.js';
import {truncateText} from '../util/text.js';

/**
 * Pure presentation of a declarative (pack) module: resolved facts in, plain
 * text segments with semantic roles out. No I/O, no clock reads (the caller
 * passes `now`), no evaluation of anything a pack wrote: literal strings,
 * fixed formatters and field comparisons only. Every value has already passed
 * the engine's sanitization boundary and passes the display boundary again.
 */
export interface DeclarativeOptions {
  /** Module icons On/Off (NMSh Native setting). */
  icons: 'nerd' | 'off';
  /** Current glyph mode: Safe never uses icon code points. */
  glyphs: 'nerd' | 'safe';
  now: number;
  purpose: 'display' | 'snapshot';
}

export interface DeclarativeSegment {
  text: string;
  role: typeof PACK_ROLE_THEME[keyof typeof PACK_ROLE_THEME];
}

type Values = (fact: string) => Record<string, unknown> | undefined;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatValue(value: unknown, format: PackFormat, now: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const number = typeof value === 'number' ? value : undefined;
  const text = String(value);
  switch (format) {
    case 'text': return text;
    case 'version': return text.replace(/^v(?=\d)/u, '').slice(0, 32);
    case 'percent': return number === undefined ? undefined : `${Math.round(number)}%`;
    case 'count': return number === undefined ? undefined : String(Math.round(number));
    case 'tokens': return number === undefined ? undefined : number >= 1e6 ? `${(number / 1e6).toFixed(1)}M` : number >= 1e3 ? `${(number / 1e3).toFixed(1)}k` : String(Math.round(number));
    case 'duration': return number === undefined ? undefined : elapsed(number);
    case 'since': return number === undefined ? undefined : elapsed(now - number);
    case 'ago': return number === undefined ? undefined : `${elapsed(now - number)} ago`;
    case 'until': return number === undefined ? undefined : number <= now ? 'expired' : `${elapsed(number - now)} left`;
    case 'clock': {
      if (number === undefined) return undefined;
      const date = new Date(number);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    case 'basename': return text.replace(/[/\\]+$/u, '').split(/[/\\]/u).at(-1) || text;
    case 'toolchain': return text.replace(/-(?:x86_64|aarch64|arm64|i686|i586|armv7|riscv64gc|powerpc64le|s390x)-[\w-]+$/u, '');
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'title': return text.charAt(0).toUpperCase() + text.slice(1);
  }
}

function present(value: unknown): boolean { return value !== undefined && value !== null && value !== ''; }

function holds(when: PackWhen, partFact: string | undefined, partField: string | undefined, values: Values): boolean {
  const fact = when.fact ?? partFact, field = when.field ?? partField;
  const value = fact && field ? values(fact)?.[field] : undefined;
  if (when.present !== undefined) return when.present === present(value);
  if (when.equals !== undefined) return value === when.equals;
  return present(value) && value !== when.notEquals;
}

function emphasized(segment: PackSegment, values: Values, now: number): boolean {
  const emphasis = segment.emphasis;
  if (!emphasis) return false;
  const value = values(emphasis.fact)?.[emphasis.field];
  if (typeof value !== 'number') return false;
  if (emphasis.past) return value <= now;
  if (emphasis.atLeast !== undefined) return value >= emphasis.atLeast;
  return emphasis.atMost !== undefined && value <= emphasis.atMost;
}

export function declarativeSegments(definition: ContextModuleDefinition, facts: ContextFacts, options: DeclarativeOptions): DeclarativeSegment[] {
  const spec = definition.pack?.module;
  if (!spec) return [];
  const cache = new Map<string, Record<string, unknown> | undefined>();
  const values: Values = fact => {
    if (!cache.has(fact)) {
      const value = projectFactValue((facts as Record<string, Parameters<typeof projectFactValue>[0]>)[fact], options.purpose);
      cache.set(fact, typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
    }
    return cache.get(fact);
  };
  if (spec.stale === 'hide' && [...definition.facts.keys()].some(fact => (facts as Record<string, {freshness?: string} | undefined>)[fact]?.freshness === 'stale')) return [];
  const segments: DeclarativeSegment[] = [];
  for (const segment of spec.segments) {
    let text = '', rendered = false, complete = true;
    for (const part of segment.parts) {
      let content: string | undefined;
      if (part.when && !holds(part.when, part.fact, part.field, values)) content = undefined;
      else if (part.text !== undefined) content = part.text;
      else {
        const record = values(part.fact!);
        let raw = record?.[part.field!];
        const until = part.until ? record?.[part.until] : undefined;
        if (typeof until === 'number' && until <= options.now) raw = undefined;
        if (part.minAgeMs !== undefined && (typeof raw !== 'number' || options.now - raw < part.minAgeMs)) raw = undefined;
        content = formatValue(raw, part.format ?? 'text', options.now);
      }
      if (!content) {
        if (part.optional) continue;
        complete = false;
        break;
      }
      if (part.maxCells) content = truncateText(content, part.maxCells);
      text += `${rendered && part.join ? part.join : ''}${part.prefix ?? ''}${content}${part.suffix ?? ''}`;
      rendered = true;
    }
    if (!complete || !rendered || !text.trim()) continue;
    const iconId = segment.icon === false ? undefined : segment.icon ?? spec.icon;
    const icon = iconId && options.icons === 'nerd' && options.glyphs === 'nerd' && isModuleIcon(iconId) ? MODULE_ICONS[iconId].nerd : '';
    const lead = icon || (segment.label ?? '');
    segments.push({text: safeContextText(lead ? `${lead} ${text.trim()}` : text.trim(), 96),
      role: emphasized(segment, values, options.now) ? 'failure' : PACK_ROLE_THEME[segment.role ?? spec.role]});
  }
  return segments;
}
