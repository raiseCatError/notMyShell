import {COMMAND_LAUNCHES, COMPLETION_EFFECTS, COMPLETION_HIGHLIGHTS, CONTEXT_TRANSITIONS, EVENT_FEEDBACK, type MotionSettings} from '../prompt/configuration.js';

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
