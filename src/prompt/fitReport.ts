/**
 * What a surface's width fitting did to routed modules in one live render (#365): which it left out and which it
 * shortened. `/modules explain` reads the last frame's report; nothing is measured or collected to produce it.
 */
export interface FitReport {dropped: Set<string>; compacted: Set<string>}

export const newFitReport = (): FitReport => ({dropped: new Set(), compacted: new Set()});

/** How the last frame fitted one module on its surface, if it had to. */
export function fitOutcome(report: FitReport | undefined, id: string): 'dropped' | 'compacted' | undefined {
  if (!report) return undefined;
  return report.dropped.has(id) ? 'dropped' : report.compacted.has(id) ? 'compacted' : undefined;
}
