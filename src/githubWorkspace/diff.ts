import {type FileChangeType, LIMITS} from './model.js';
import {sanitizeLine, sanitizePatchLine} from './sanitize.js';
import type {PatchFetch, RawPatchFile} from './source.js';

/**
 * Bounded, read-only review model of a remote GitHub PR diff. It records
 * exactly where the diff came from and what is missing: GitHub omits patches
 * for binary and very large files, caps file lists, and NMSh caps lines.
 * Nothing here infers, reconstructs or evaluates patch content.
 */

export type DiffDepth = 'compact' | 'review' | 'external';

export type PatchAvailability =
  | 'complete'          // patch present and its +/- counts match GitHub's reported counts
  | 'incomplete'        // patch present but shorter than GitHub's reported counts (abbreviated by GitHub)
  | 'truncated'         // patch present but cut by NMSh's line bound
  | 'omitted'           // GitHub returned no patch (binary, too large, or rename without content change)
  | 'skipped';          // NMSh's total line budget was exhausted before this file

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'note';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  previousPath?: string;
  changeType: FileChangeType;
  additions?: number;
  deletions?: number;
  availability: PatchAvailability;
  hunks: DiffHunk[];
  /** Explanation shown in place of, or after, hunks. */
  note?: string;
}

export interface DiffSource {
  repository: string;
  number: number;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
}

export interface DiffModel {
  source: DiffSource;
  files: DiffFile[];
  /** GitHub reported more files than were fetched/kept. */
  filesTruncated: boolean;
  reportedFileCount?: number;
  totals: {additions: number; deletions: number};
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;

function noteFor(availability: PatchAvailability, file: RawPatchFile): string | undefined {
  switch (availability) {
    case 'omitted':
      if (file.status === 'renamed' && !file.additions && !file.deletions) return 'Renamed without content changes';
      return 'GitHub did not provide a patch for this file (binary or too large). Open on GitHub to review.';
    case 'incomplete': return 'GitHub returned an abbreviated patch; line counts do not match the reported totals.';
    case 'truncated': return `Patch cut at ${LIMITS.patchLinesPerFile} lines by NMSh. Open on GitHub for the remainder.`;
    case 'skipped': return `Not loaded: NMSh's ${LIMITS.patchLinesTotal}-line diff budget was used by earlier files.`;
    default: return undefined;
  }
}

export function parsePatch(patch: string, budget: number): {hunks: DiffHunk[]; lines: number; adds: number; dels: number; cut: boolean} {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0, newLine = 0, lines = 0, adds = 0, dels = 0, cut = false;
  const limit = Math.min(budget, LIMITS.patchLinesPerFile);
  for (const raw of patch.split('\n')) {
    if (lines >= limit) { cut = true; break; }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      current = {header: sanitizeLine(raw, LIMITS.patchLineLength), lines: []};
      hunks.push(current);
      lines++;
      continue;
    }
    if (!current) continue;
    const marker = raw[0];
    const {text, truncated} = sanitizePatchLine(raw.slice(1), LIMITS.patchLineLength);
    const shown = truncated ? `${text}…` : text;
    if (marker === '+') { current.lines.push({kind: 'add', text: shown, newLine: newLine++}); adds++; }
    else if (marker === '-') { current.lines.push({kind: 'del', text: shown, oldLine: oldLine++}); dels++; }
    else if (marker === '\\') current.lines.push({kind: 'note', text: sanitizeLine(raw.slice(1), 200)});
    else if (marker === ' ' || raw === '') {
      if (raw === '' ) continue;
      current.lines.push({kind: 'ctx', text: shown, oldLine: oldLine++, newLine: newLine++});
    } else continue;
    lines++;
  }
  return {hunks, lines, adds, dels, cut};
}

export function buildDiffModel(source: DiffSource, fetch: PatchFetch): DiffModel {
  let budget = LIMITS.patchLinesTotal;
  let additions = 0, deletions = 0;
  const files = fetch.files.slice(0, LIMITS.files).map((file): DiffFile => {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
    const base = {
      path: sanitizeLine(file.filename, 500) || '(unknown path)',
      previousPath: file.previousFilename ? sanitizeLine(file.previousFilename, 500) : undefined,
      changeType: file.status, additions: file.additions, deletions: file.deletions,
    };
    let availability: PatchAvailability;
    let hunks: DiffHunk[] = [];
    if (file.patch === undefined || file.patch === '') availability = 'omitted';
    else if (budget <= 0) availability = 'skipped';
    else {
      const parsed = parsePatch(file.patch, budget);
      budget -= parsed.lines;
      hunks = parsed.hunks;
      const countsKnown = file.additions !== undefined && file.deletions !== undefined;
      availability = parsed.cut ? 'truncated'
        : countsKnown && (parsed.adds < file.additions! || parsed.dels < file.deletions!) ? 'incomplete' : 'complete';
    }
    return {...base, availability, hunks, note: noteFor(availability, file)};
  });
  return {source, files, filesTruncated: fetch.truncated, reportedFileCount: fetch.reportedFileCount, totals: {additions, deletions}};
}

/** Compact depth: counts and key filenames, Claude Code style. */
export function compactSummary(model: DiffModel, maxFiles = 5): string[] {
  const fileCount = model.reportedFileCount ?? model.files.length;
  const lines = [`${fileCount} file${fileCount === 1 ? '' : 's'} changed, +${model.totals.additions} -${model.totals.deletions}${model.filesTruncated ? ` (${model.files.length} loaded)` : ''}`];
  const ranked = [...model.files].sort((a, b) => ((b.additions ?? 0) + (b.deletions ?? 0)) - ((a.additions ?? 0) + (a.deletions ?? 0)));
  for (const file of ranked.slice(0, maxFiles)) lines.push(`${fileLabel(file)}  +${file.additions ?? '?'} -${file.deletions ?? '?'}`);
  if (ranked.length > maxFiles) lines.push(`… ${ranked.length - maxFiles} more`);
  return lines;
}

export function fileLabel(file: Pick<DiffFile, 'path' | 'previousPath' | 'changeType'>): string {
  return file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ${file.path}` : file.path;
}

/** External depth: an intent only. NMSh never launches anything from the model. */
export interface ExternalReviewIntent {
  type: 'OpenExternalReview';
  url: string;
  repository: string;
  number: number;
  headSha?: string;
}

export function externalReviewIntent(source: DiffSource, url: string | undefined): ExternalReviewIntent | undefined {
  return url ? {type: 'OpenExternalReview', url: `${url.replace(/\/$/u, '')}/files`, repository: source.repository, number: source.number, headSha: source.headSha} : undefined;
}
