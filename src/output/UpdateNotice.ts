import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {HOMEBREW_UPDATE_STEPS} from '../update/update.js';

/** How this copy of NMSh was installed, as far as facts show (never guessed). */
export type UpdateProvenance = 'homebrew' | 'checkout' | 'manual';

export interface UpdateNoticeFacts {
  installed: string;
  available: string;
  /** The first lines of the release notes, plain text. */
  summary: readonly string[];
  url: string;
  provenance: UpdateProvenance;
  /** Automatic mode already prepared it on disk: only a restart is left. */
  ready?: boolean;
}

/**
 * The words of an update notice, before styling: the versions, at most two lines of release notes, and the
 * way to update this installation. Homebrew gets brew commands; a verified source checkout gets /update (which
 * checks the tree is clean and only fast-forwards); anything else gets the official release page, nothing guessed.
 */
export function updateNoticeText(facts: UpdateNoticeFacts): {headline: string; lines: string[]} {
  if (facts.ready) return {headline: `NMSh ${facts.available} is ready`, lines: [`You are running ${facts.installed}. Restart NMSh to use the new version.`]};
  const how = facts.provenance === 'homebrew' ? [`Update with Homebrew: ${HOMEBREW_UPDATE_STEPS.join(' && ')}`]
    : facts.provenance === 'checkout' ? ['Run /update to review the update, then /update apply. It checks your checkout first.']
    : ['Install it the way you installed NMSh, from the release page below.'];
  return {headline: `NMSh ${facts.available} is available`, lines: [`You have ${facts.installed}.`, ...facts.summary.slice(0, 2), ...how, facts.url]};
}

const RESET = '\u001b[0m', BOLD = '\u001b[1m';

/** Transcript rows: a short amber rule, the headline, then quiet lines. Plain under NO_COLOR and Safe glyphs. */
export function renderUpdateNotice(facts: UpdateNoticeFacts): string[] {
  const {headline, lines} = updateNoticeText(facts);
  const amber = foreground(UI_COLORS.warning), primary = foreground(UI_COLORS.primary), quiet = foreground(UI_COLORS.secondary);
  const rule = (getCurrentGlyphMode() === 'nerd' ? '▁' : '_').repeat(24);
  return ['', `  ${amber}${rule}${RESET}`, `  ${BOLD}${amber}${headline}${RESET}`, ...lines.map(line => `  ${line.startsWith('Update with') || line.startsWith('Run /update') ? primary : quiet}${line}${RESET}`)];
}
