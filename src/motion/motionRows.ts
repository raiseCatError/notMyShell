import {COMMAND_LAUNCHES, COMPLETION_EFFECTS, COMPLETION_HIGHLIGHTS, CONTEXT_TRANSITIONS, DEFAULT_MOTION_TUNING, EVENT_FEEDBACK, MOTION_INTENSITIES, MOTION_RENDERINGS, MOTION_SPEEDS,
  type MotionRendering, type MotionSettings, type MotionTuning} from '../prompt/configuration.js';

/**
 * The general Motion settings: one table for /appearance → Motion, Settings
 * and Setup, so a value, its label and its help are written once.
 */
export interface MotionRow {key: keyof MotionSettings; label: string; values: readonly string[]; note: string}

export const MOTION_ROWS: readonly MotionRow[] = [
  {key: 'contextTransitions', label: 'Context transitions', values: CONTEXT_TRANSITIONS, note: 'Prompt modules transform in place when cwd, branch, Git state or tools change'},
  {key: 'commandLaunch', label: 'Command launch', values: COMMAND_LAUNCHES, note: 'Enter hands the command to the shell at once; this only shows the handoff'},
  {key: 'completionHighlight', label: 'Completion highlight', values: COMPLETION_HIGHLIGHTS, note: 'What completion just inserted, briefly'},
  {key: 'completionEffect', label: 'Command completion', values: COMPLETION_EFFECTS, note: 'Block Seal: a finished block settles with one semantic sweep'},
  {key: 'eventFeedback', label: 'Event feedback', values: EVENT_FEEDBACK, note: 'Semantic Echo: failures, long successes, conflicts, attention, tasks finishing'},
];

export const MOTION_LABELS: Record<string, string> = {off: 'Off', subtle: 'Subtle', expressive: 'Expressive', sweep: 'Sweep', pulse: 'Pulse', vivid: 'Vivid', seal: 'Seal'};

/** One editable Motion value, as /appearance → Motion, Settings and Setup all show it. */
export interface MotionItem {
  id: string;
  label: string;
  note: string;
  values: readonly string[];
  labelOf: (value: string) => string;
  get: (motion: MotionSettings) => string;
  set: (motion: MotionSettings, value: string) => MotionSettings;
  /** The effect whose preview demonstrates this value. */
  preview: MotionRow['key'];
}

const RENDERING_LABELS: Record<string, string> = {clean: 'Clean', rich: 'Rich'};
const INTENSITY_LABELS: Record<string, string> = {low: 'Low', medium: 'Medium', high: 'High'};
const SPEED_LABELS: Record<string, string> = {slow: 'Slow', normal: 'Normal', fast: 'Fast'};

/** Rendering: Clean keeps the host's background; Rich is the stronger filled look. */
export const MOTION_RENDERING_ITEM: MotionItem = {id: 'rendering', label: 'Rendering',
  note: 'Clean tints and underlines text and keeps your terminal\'s background (best on transparent windows); Rich draws the stronger filled bands',
  values: MOTION_RENDERINGS, labelOf: value => RENDERING_LABELS[value] ?? value, get: motion => motion.rendering ?? 'clean',
  set: (motion, value) => ({...motion, rendering: value as MotionRendering}), preview: 'commandLaunch'};

/** Per-rendering tuning: it edits the selected rendering's own values and leaves the other's alone. */
export const MOTION_TUNING_ITEMS: readonly MotionItem[] = [
  {id: 'intensity', label: 'Intensity', note: 'How strong the paint is for the selected rendering; each rendering keeps its own',
    values: MOTION_INTENSITIES, labelOf: value => INTENSITY_LABELS[value] ?? value, preview: 'commandLaunch',
    get: motion => motion.tuning?.[motion.rendering ?? 'clean']?.intensity ?? 'medium',
    set: (motion, value) => withTuning(motion, {intensity: value as MotionTuning['intensity']})},
  {id: 'speed', label: 'Speed', note: 'How long each effect lasts for the selected rendering: Slow lingers, Fast is brief',
    values: MOTION_SPEEDS, labelOf: value => SPEED_LABELS[value] ?? value, preview: 'commandLaunch',
    get: motion => motion.tuning?.[motion.rendering ?? 'clean']?.speed ?? 'normal',
    set: (motion, value) => withTuning(motion, {speed: value as MotionTuning['speed']})},
];

function withTuning(motion: MotionSettings, patch: Partial<MotionTuning>): MotionSettings {
  const rendering = motion.rendering ?? 'clean';
  const base = DEFAULT_MOTION_TUNING();
  const tuning = {...base, ...(motion.tuning ?? {})};
  return {...motion, tuning: {...tuning, [rendering]: {...tuning[rendering], ...patch}}};
}

/** The five effects, then the rendering choice first: the order the Motion screen lists them in. */
export const MOTION_ITEMS: readonly MotionItem[] = [MOTION_RENDERING_ITEM, ...MOTION_ROWS.map((row): MotionItem => ({id: row.key, label: row.label, note: row.note, values: row.values,
  labelOf: value => MOTION_LABELS[value] ?? value, get: motion => motion[row.key] as string, set: (motion, value) => ({...motion, [row.key]: value}), preview: row.key}))];
