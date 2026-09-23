import type {ComposerLayout, ContextPlacement} from '../prompt/configuration.js';

export const MAX_VISIBLE_INPUT_ROWS = 8;

export interface ScreenLayout {
  outputHeight: number;
  inputHeight: number;
  suggestionCount: number;
  showJump: boolean;
  showLiveActivity: boolean;
  showPrompt: boolean;
  showComposerTopBorder: boolean;
  showSeparator: boolean;
  showGap: boolean;
}

export function calculateScreenLayout(
  rows: number,
  requestedInputRows: number,
  requestedSuggestions: number,
  requestedLiveActivity = false,
  requestedJump = false,
  hasOutput = false,
  contextPlacement: ContextPlacement = 'header',
  hasVisibleContext = true,
  composerLayout: ComposerLayout = 'twoLine',
): ScreenLayout {
  const safeRows = Math.max(1, rows);
  const oneLine = composerLayout === 'oneLine';
  const showPrompt = safeRows >= 2 && hasVisibleContext && !oneLine;
  const showSeparator = safeRows >= 3;
  const showComposerTopBorder = safeRows >= (oneLine ? 3 : 4)
    && (oneLine || (showPrompt && contextPlacement === 'composer'));
  const fixedRows = Number(showPrompt) + Number(showSeparator) + Number(showComposerTopBorder);
  const minimumOutput = safeRows >= 7 ? 2 : 0;
  const inputCapacity = Math.max(1, safeRows - fixedRows - minimumOutput);
  const inputHeight = Math.min(Math.max(1, requestedInputRows), MAX_VISIBLE_INPUT_ROWS, inputCapacity);
  let remaining = Math.max(0, safeRows - fixedRows - inputHeight - minimumOutput);
  const showLiveActivity = requestedLiveActivity && remaining > 1; // Needs 2 rows (activity + blank spacing)
  if (showLiveActivity) remaining -= 2;
  const showGap = !showLiveActivity && hasOutput && remaining > 0;
  if (showGap) remaining -= 1;
  const showJump = requestedJump && remaining > 0;
  if (showJump) remaining -= 1;
  const suggestionCount = Math.min(requestedSuggestions, remaining);
  return {
    outputHeight: Math.max(0, safeRows - fixedRows - inputHeight - suggestionCount - (showLiveActivity ? 2 : 0) - Number(showGap) - Number(showJump)),
    inputHeight,
    suggestionCount,
    showJump,
    showLiveActivity,
    showPrompt,
    showComposerTopBorder,
    showSeparator,
    showGap,
  };
}
