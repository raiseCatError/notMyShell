import type {BrowserAvailability} from '../browser/types.js';
import {cleanForDisplay} from '../browser/engine/preview.js';
import {TESTED_MERMAID, type MermaidProbe} from '../diagrams/library.js';
import type {BrowserSetting, DiagramSetting} from '../prompt/configuration.js';
import type {DoctorCheck} from './doctor.js';

/**
 * /doctor's Documents section: what draws rendered previews and Mermaid diagrams, and why a diagram would not be drawn. The facts
 * are gathered without starting anything: the browser executable is found on the filesystem (its version is shown only when a
 * browser surface already checked it this session) and the Mermaid bundle is located and `fstat`ed, never read. Finding both is
 * not proof they draw, and the rows say so.
 */
export interface DocumentRenderingFacts {
  diagrams: DiagramSetting;
  browser: BrowserSetting;
  /** Settings → Images is not Off. */
  images: boolean;
  /** A browser process is running now (some surface opened one). */
  running: boolean;
  chromium: {state: 'checked'; availability: BrowserAvailability} | {state: 'found'; executable: string} | {state: 'missing'; reason: string};
  mermaid: MermaidProbe;
}

const SECTION = 'Documents';
const DIAGRAM_LABELS: Record<DiagramSetting, string> = {manual: 'On request', auto: 'Automatic', off: 'Off'};
const clean = (text: string, max = 300): string => cleanForDisplay(text, max);

function browserCheck(facts: DocumentRenderingFacts): DoctorCheck {
  if (facts.browser === 'off') return {section: SECTION, label: 'Real browser off: previews use NMSh\'s own renderer', state: 'info', detail: 'Settings → General → Real browser'};
  const running = facts.running ? ' · running now' : '';
  const {chromium} = facts;
  if (chromium.state === 'checked') {
    return chromium.availability.ok
      ? {section: SECTION, label: clean(chromium.availability.version, 80), state: 'ok', detail: `${clean(chromium.availability.executable)} · version checked this session${running}`}
      : {section: SECTION, label: 'The installed browser cannot be used', state: 'attention', detail: clean(chromium.availability.reason)};
  }
  if (chromium.state === 'found') {
    return {section: SECTION, label: 'Chromium-family browser found', state: 'ok', detail: `${clean(chromium.executable)} · its version is checked when a browser surface first opens${running}`};
  }
  return {section: SECTION, label: 'No Chrome or Chromium: previews use NMSh\'s own renderer', state: 'info', detail: clean(chromium.reason)};
}

function mermaidCheck(probe: MermaidProbe): DoctorCheck {
  if (!probe.ok) {
    // A path the person set and that is wrong needs their attention; not having Mermaid at all is a choice.
    const configured = probe.reason.startsWith('NMSH_MERMAID');
    return {section: SECTION, label: configured ? 'Mermaid: NMSH_MERMAID cannot be used' : 'Mermaid not installed', state: configured ? 'attention' : 'info', detail: clean(probe.reason)};
  }
  const version = clean(probe.version, 40);
  const testedMajor = TESTED_MERMAID.split('.')[0];
  if (version === 'unknown') {
    return {section: SECTION, label: 'Mermaid (version unknown)', state: 'attention', detail: `${clean(probe.path)} · no package.json beside the bundle, so its version cannot be compared; NMSh is tested with ${TESTED_MERMAID}`};
  }
  const major = version.split('.')[0];
  return major === testedMajor
    ? {section: SECTION, label: `Mermaid ${version}`, state: 'ok', detail: `${clean(probe.path)} · tested with ${TESTED_MERMAID}`}
    : {section: SECTION, label: `Mermaid ${version}`, state: 'attention', detail: `${clean(probe.path)} · NMSh is tested with ${TESTED_MERMAID}; another major version may draw differently or refuse some diagrams`};
}

/** Why a diagram would not be drawn, in the order the diagram service applies its checks. */
function blockedReason(facts: DocumentRenderingFacts): string | undefined {
  if (!facts.images) return 'Images are off (Settings → General → Images), so diagrams cannot be shown.';
  if (facts.browser === 'off') return 'Diagrams are drawn by the real browser, which is off (Settings → General → Real browser).';
  if (facts.chromium.state === 'missing') return clean(facts.chromium.reason);
  if (facts.chromium.state === 'checked' && !facts.chromium.availability.ok) return clean(facts.chromium.availability.reason);
  if (!facts.mermaid.ok) return clean(facts.mermaid.reason);
  return undefined;
}

function drawingCheck(facts: DocumentRenderingFacts): DoctorCheck {
  const setting = DIAGRAM_LABELS[facts.diagrams];
  if (facts.diagrams === 'off') return {section: SECTION, label: 'Mermaid diagrams off: fences stay code', state: 'info', detail: 'Settings → General → Mermaid diagrams'};
  const reason = blockedReason(facts);
  if (reason) return {section: SECTION, label: `Mermaid diagrams (${setting}) would not be drawn`, state: 'info', detail: reason};
  return {section: SECTION, label: `Mermaid diagrams (${setting}) can be drawn`, state: 'ok',
    detail: `${facts.diagrams === 'manual' ? 'Press D in a rendered Markdown view. ' : ''}Detection only: nothing was drawn to check this.`};
}

export function documentDoctorChecks(facts: DocumentRenderingFacts): DoctorCheck[] {
  return [browserCheck(facts), mermaidCheck(facts.mermaid), drawingCheck(facts)];
}
