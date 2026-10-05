import type {MotionSettings} from '../prompt/configuration.js';
import {overlayRow, type CellPaint} from '../presentation/cellOverlay.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
import {diffModules, progress, transitionPaint, Transitions, type MotionGate} from './transitions.js';

/**
 * /appearance → Motion preview: deterministic synthetic fixtures driven by the
 * real Transitions class (its gating and durations) and painted with the real
 * transitionPaint functions, so the preview is the effect itself on fake
 * content. It never touches the composer, transcript, shell or session.
 * One run per trigger (row selected, value changed, R); never a loop.
 * Like the live effects it only shifts foreground colors: no backgrounds.
 */
export type MotionPreviewMode = 'animating' | 'settled' | 'off' | 'effectsOff' | 'reduced' | 'noColor';

export interface MotionPreview {
  /** Always PREVIEW_HEIGHT rows, so the panel does not jump. */
  rows: string[];
  caption: string;
  mode: MotionPreviewMode;
  /** A frame clock is needed only while this is true. */
  busy: boolean;
}

/** Fixture rows plus the caption row. */
export const PREVIEW_HEIGHT = 3;

const DESCRIPTIONS: Record<string, string> = {
  'contextTransitions:subtle': 'Only the changed modules (cwd, branch) wipe in; Node 22 stays still.',
  'contextTransitions:expressive': 'Changed prompt modules wipe in with a brighter front.',
  'commandLaunch:sweep': 'A brief light band tints the submitted command and rule.',
  'commandLaunch:pulse': 'The command brightens once and fades as it is handed off.',
  'completionHighlight:subtle': 'Only the inserted completion is underlined and tinted, briefly.',
  'completionHighlight:vivid': 'Only the inserted completion is underlined and tinted brightly, a little longer.',
  'cursorTravel:on': 'A soft trail follows the caret across a multi-cell jump; the caret itself is already at its destination.',
  'completionEffect:seal': 'A finished block\'s header takes one sweep of its outcome color.',
  'eventFeedback:subtle': 'Meaningful events tint the composer rule once.',
  'eventFeedback:expressive': 'Meaningful events tint the rule and sweep the input once.',
};

interface Fixture { lines: string[]; paint: (transitions: Transitions, now: number, width: number) => Array<Map<number, CellPaint>> }

function fixture(row: keyof MotionSettings, width: number): Fixture & {trigger: (transitions: Transitions, start: number) => void} {
  const safe = getCurrentGlyphMode() === 'safe';
  const prompt = safe ? '>' : '❯';
  const check = safe ? '+' : '✓';
  const rule = (safe ? '-' : '─').repeat(Math.max(4, Math.min(width, 28)));
  const at = (transitions: Transitions, now: number) => transitions.live(now);
  if (row === 'contextTransitions') {
    // Node 22 is the same before and after: it must receive no effect at all.
    const before = [{id: 'cwd', text: '~/project'}, {id: 'branch', text: 'main'}, {id: 'node', text: 'Node 22'}];
    const after = [{id: 'cwd', text: '~/src'}, {id: 'branch', text: 'feature/theme'}, {id: 'node', text: 'Node 22'}];
    const lines = [`before  ${before.map(module => module.text).join('  ')}`, `after   ${after.map(module => module.text).join('  ')}`];
    return {lines, trigger: (transitions, start) => transitions.morph(diffModules(before, after), start),
      paint: (transitions, now) => {
        const cells = new Map<number, CellPaint>();
        for (const transition of at(transitions, now)) if (transition.kind === 'morph') for (const change of transition.changes) {
          const index = lines[1]!.indexOf(change.text);
          if (change.change === 'disappeared' || index < 0) continue;
          const column = displayWidth(lines[1]!.slice(0, index));
          for (const [key, value] of transitionPaint.morph(column, column + displayWidth(change.text), progress(transition, now), transition.expressive, change.change, transition.look)) cells.set(key, value);
        }
        return [new Map(), cells];
      }};
  }
  if (row === 'commandLaunch') {
    return {lines: [`${prompt} npm test`, rule], trigger: (transitions, start) => transitions.launch(start),
      paint: (transitions, now, columns) => {
        const transition = at(transitions, now).find(item => item.kind === 'launch');
        if (transition?.kind !== 'launch') return [];
        const t = progress(transition, now);
        return [transitionPaint.launch(transition.style, columns, t, false, transition.look), transitionPaint.launch(transition.style, columns, t, true, transition.look)];
      }};
  }
  if (row === 'completionHighlight') {
    const typed = `${prompt} git sta`;
    const line = `${typed}tus`;
    return {lines: [line, `  ${safe ? '' : '⇥ '}Tab completed "tus"`], trigger: (transitions, start) => transitions.materialize(displayWidth(typed), displayWidth(line), line, start),
      paint: (transitions, now) => {
        const transition = at(transitions, now).find(item => item.kind === 'materialize');
        return transition?.kind === 'materialize' ? [transitionPaint.materialize(transition.from, transition.to, progress(transition, now), transition.vivid, transition.look)] : [];
      }};
  }
  if (row === 'cursorTravel') {
    const line = `${prompt} git commit -m wip`;
    return {lines: [line, `  ${safe ? '' : '⌥ '}Option+Left jumps back a word`], trigger: (transitions, start) => transitions.travel(displayWidth(line), displayWidth(`${prompt} git commit -m `), 0, start),
      paint: (transitions, now) => {
        const transition = at(transitions, now).find(item => item.kind === 'travel');
        return transition?.kind === 'travel' ? [transitionPaint.travel(transition.from, transition.to, progress(transition, now), transition.look)] : [];
      }};
  }
  if (row === 'completionEffect') {
    return {lines: [`${check} npm test · 1.2s`, '  12 passing'], trigger: (transitions, start) => transitions.seal(0, 'success', start),
      paint: (transitions, now, columns) => {
        const transition = at(transitions, now).find(item => item.kind === 'seal');
        return transition?.kind === 'seal' ? [transitionPaint.seal(transition.tone, columns, progress(transition, now), transition.look)] : [];
      }};
  }
  return {lines: [rule, `${check} task finished`], trigger: (transitions, start) => transitions.echo('taskDone', start),
    paint: (transitions, now, columns) => {
      const transition = at(transitions, now).find(item => item.kind === 'echo');
      if (transition?.kind !== 'echo') return [];
      const t = progress(transition, now);
      return [transitionPaint.echoRule(transition.event, columns, t, transition.expressive, transition.look), transition.expressive ? transitionPaint.echoInput(transition.event, columns, t, transition.look) : new Map()];
    }};
}

/**
 * The preview for one Motion row at its current value, `now - start` after it
 * was triggered. Pure: the same inputs give the same frame.
 */
export function renderMotionPreview(row: keyof MotionSettings, motion: MotionSettings, gate: MotionGate, columns: number, start: number, now: number): MotionPreview {
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const reset = '\u001b[0m';
  const width = Math.max(0, columns - 4);
  const value = motion[row] as string;
  const mode: MotionPreviewMode = value === 'off' ? 'off' : gate.effectsOff ? 'effectsOff' : gate.reducedMotion ? 'reduced' : !gate.color ? 'noColor' : 'animating';
  const transitions = new Transitions(() => motion, () => gate);
  const item = fixture(row, width);
  item.trigger(transitions, start);
  const paints = mode === 'animating' ? item.paint(transitions, now, Math.min(width, Math.max(...item.lines.map(line => displayWidth(line))) + 2)) : [];
  const finalMode: MotionPreviewMode = mode === 'animating' && !transitions.busy ? 'settled' : mode;
  const caption = finalMode === 'off' ? 'Off: nothing is shown.'
    : finalMode === 'effectsOff' ? 'Decorative effects are Off, so this effect is suppressed.'
    : finalMode === 'reduced' ? 'Reduced Motion: the change appears at once, without animation.'
    : finalMode === 'noColor' ? 'NO_COLOR: no tint is painted.'
    : `${DESCRIPTIONS[`${row}:${value}`] ?? ''}${finalMode === 'settled' ? ' R replays.' : ''}`;
  // Too narrow for the fixture: the caption alone, still the same height.
  const fixtureRows = width < 16 ? ['', ''] : item.lines.map((line, index) => {
    const muted = row === 'contextTransitions' && index === 0;
    const text = `${muted ? subtle : secondary}${line}${reset}`;
    const cells = paints[index];
    return `    ${cells?.size ? overlayRow(text, cells, width) : text}`;
  });
  return {rows: [...fixtureRows, `  ${subtle}${caption}${reset}`].map(line => truncateAnsi(line, columns)), caption, mode: finalMode, busy: finalMode === 'animating'};
}
