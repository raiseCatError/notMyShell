import type {PaletteItem} from './CommandPalette.js';
import {referenceFollowUp, REFERENCE_KIND_LABELS, type OutputReference} from '../output/references.js';

/**
 * The menu for one block's references: for each, the action that fits it and Copy. Every action resolves the
 * reference again from the block when it runs, so a menu never acts on stale coordinates or text.
 */
export function referencePaletteItems(startId: number, references: readonly OutputReference[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const reference of references) {
    const kind = REFERENCE_KIND_LABELS[reference.kind];
    const id = `reference:${startId}:${reference.id}`;
    const primary = reference.kind === 'file' ? {verb: 'open' as const, label: `Open ${reference.label}`, detail: `${kind} · in your editor${reference.line ? ` at line ${reference.line}` : ''}`}
      : reference.kind === 'url' ? {verb: 'open' as const, label: `Open ${reference.label}`, detail: `${kind} · in your browser`}
      : referenceFollowUp(reference) ? {verb: 'stage' as const, label: reference.kind === 'commit' ? `Inspect commit ${reference.label}` : `Open a shell on ${reference.label}`,
        detail: `${kind} · puts \`${referenceFollowUp(reference)!.join(' ')}\` in the composer to review; nothing runs`}
      : undefined;
    if (primary) items.push({id: `${id}:${primary.verb}`, label: primary.label, detail: primary.detail, category: 'Transcript', action: {kind: 'reference', startId, refId: reference.id, verb: primary.verb}});
    items.push({id: `${id}:copy`, label: `Copy ${reference.label}`, detail: `${kind} · ${reference.kind === 'file' ? 'path and line' : 'as printed'}`, category: 'Transcript',
      action: {kind: 'reference', startId, refId: reference.id, verb: 'copy'}});
  }
  return items;
}

/** What Copy puts on the clipboard for a reference. */
export function referenceCopyText(reference: OutputReference): string {
  return reference.kind === 'file' ? reference.label : reference.value;
}
