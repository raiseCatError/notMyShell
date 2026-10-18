import {planScreen} from '../app/screenPlan.js';
import {layoutInput} from '../input/inputLayout.js';
import {OutputBuffer} from '../output/OutputBuffer.js';
import {nativePromptSnapshot, buildContextLine, buildInlineContextPrefix, themePreviewContext} from '../prompt/prompt.js';
import {renderSyntaxPreviewLine} from '../input/SyntaxPanel.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import {Transitions, transitionPaint, progress} from '../motion/transitions.js';
import {overlayRow, overlayFrame} from '../presentation/cellOverlay.js';
import {CursorEngine, seededRandom} from '../cursor/CursorEngine.js';
import {effectPalette} from '../cursor/palette.js';
import {resolveCursorSettings, contextFor} from '../cursor/colors.js';
import {selectedRowBand} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
import {createSetup, renderSetup, sectionIndex, type SetupState} from './SetupCat.js';

/** Pure, finite demonstration using the real presenter, prompt, input layout, screen geometry and effects.
 * It owns no terminal, shell, timers, persistence, history, clipboard or session. */
export const QUICK_PREVIEW_DURATION = 6800;
export interface QuickPreview {rows: string[]; busy: boolean; phase: string}
const RESET = '\u001b[0m';
const TIME = new Date(2026, 9, 16, 12, 0, 0);
const COMMAND = 'printf "hello\\nworld\\nready\\n"';
const OUTPUT = ['hello', 'world', 'ready'];

export function renderQuickPreview(state: SetupState, columns: number, height: number, elapsed: number, still: boolean): QuickPreview {
  const width = Math.max(1, columns), rows = Math.max(0, height);
  if (!rows) return {rows: [], busy: false, phase: 'hidden'};
  const t = still ? QUICK_PREVIEW_DURATION : Math.max(0, Math.min(QUICK_PREVIEW_DURATION, elapsed));
  const busy = !still && elapsed < QUICK_PREVIEW_DURATION;
  const config = state.draft;
  if (state.quick?.choice === 2) {
    // The full wizard, over an isolated draft. A deterministic section/value script demonstrates real controls.
    const demo = createSetup(config);
    const sections = ['prompt', 'appearance', 'motion', 'cursor'];
    const step = Math.min(3, Math.floor(t / 1700));
    demo.section = sectionIndex(sections[step]!);
    if (t >= 2000) demo.draft.nmsh.palette = 'ocean';
    demo.context.preview = [buildContextLine(themePreviewContext('/demo'), width, demo.draft, 'composer', 0),
      'Full customization · /setup', 'Tools and advanced settings available'];
    // The actual Setup controls and live theme preview, bounded to the mini-screen.
    const full = renderSetup(demo, width, Math.max(18, rows));
    const preview = demo.context.preview;
    return {rows: [...full.slice(0, Math.max(1, rows - preview.length)), ...preview].slice(0, rows).map(row => truncateAnsi(row, width)), busy, phase: sections[step]!};
  }
  const minimal = state.quick?.choice === 1;
  const phase = t < 1100 ? 'typing' : t < 1450 ? 'launch' : t < 3300 ? 'running' : t < 4200 ? 'completion' : t < 5400 ? 'long-output' : 'selection';
  const output = new OutputBuffer();
  output.setOutputFolding(config.outputFolding);
  output.setTranscriptAppearance(config.transcript);
  output.presenter.setLayout(config.transcriptPresentation);
  output.presenter.setTreatment(config.presentation);
  const context = themePreviewContext('/demo');
  context.project = 'demo'; context.cwd = '/demo';
  const historical = {cwd: '/demo', project: 'demo', prompt: nativePromptSnapshot(context, config)};
  const format = (text: string) => [`${foreground(UI_COLORS.accent)}${GLYPHS.prompt}${RESET} ${renderSyntaxPreviewLine(text, config.syntax, config.nmsh.palette)}`];
  const finish = (command: string, duration: number) => {
    output.complete(0);
    const status = completedActivity(command, duration, TIME, 0, false);
    output.setCompletionLifecycle(`${status.main}${status.detail}`);
    output.addHistoryLine(`${foreground(UI_COLORS.success)}${status.main}${RESET}${status.detail}`);
  };
  if (t >= 1100) {
    output.beginCommand(COMMAND, format(COMMAND), undefined, historical);
    const count = Math.max(0, Math.min(OUTPUT.length, Math.floor((t - 1450) / 480) + 1));
    if (count) output.write(OUTPUT.slice(0, count).join('\n') + '\n');
    if (t >= 3300) finish(COMMAND, 2200);
  }
  if (!minimal && t >= 4200) {
    output.beginCommand('seq 1 450', format('seq 1 450'), undefined, historical);
    const count = t >= 5400 ? 450 : Math.min(450, Math.floor((t - 4200) * 450 / 1200));
    if (count) output.write(Array.from({length: count}, (_, i) => `${i + 1}`).join('\n') + '\n');
    if (t >= 5400) finish('seq 1 450', 1200);
  }
  const wrapped = output.wrapped(width);
  const text = t < 1100 ? COMMAND.slice(0, Math.floor(t * COMMAND.length / 1050)) : '';
  const prefix = config.composerLayout === 'oneLine' ? buildInlineContextPrefix(context, Math.min(width - 8, 36), config) : `${GLYPHS.prompt} `;
  const input = layoutInput(text, Array.from(text).length, width, 2, prefix);
  const running = t >= 1100 && t < 3300 || !minimal && t >= 4200 && t < 5400;
  const plan = planScreen({rows, inputRows: input.rows.length, suggestions: 0, running, detached: false, hasOutput: wrapped.length > 0,
    contextPlacement: config.placement, hasVisibleContext: true, composerLayout: config.composerLayout,
    composerPosition: config.composerPosition, composerDividers: config.composerDividers, transcriptRows: wrapped.length});
  const visible = wrapped.slice(-Math.max(1, plan.transcript.height)).map(row => output.presenter.decorate(row,
    row.lineIndex === undefined ? undefined : output.lineTypes.get(row.lineIndex), {now: 0}));
  if (!minimal && t >= 5700) {
    const record = output.recent(1)!;
    wrapped.slice(-Math.max(1, plan.transcript.height)).forEach((row, index) => {
      if (row.blockStartId === record.startId) visible[index] = selectedRowBand(visible[index]!, width);
    });
  }
  const activity = liveActivityParts(t >= 4200 ? 'seq 1 450' : COMMAND, Math.max(0, t - 1100), 0);
  const frame: string[] = Array.from({length: rows}, () => '');
  for (const region of plan.regions) {
    const content = region.kind === 'transcript' ? visible : region.kind === 'input' ? input.rows.map(row => `${row.prefix}${renderSyntaxPreviewLine(row.text, config.syntax, config.nmsh.palette)}`)
      : region.kind === 'prompt' ? [buildContextLine(context, width, config, config.placement, 0)]
      : region.kind === 'activity' ? [`${foreground(UI_COLORS.secondary)}${activity.phrase}${activity.duration}${RESET}`]
      : region.kind === 'composerBorder' || region.kind === 'separator' ? [GLYPHS.separator.repeat(width)] : [];
    for (let i = 0; i < region.height; i++) frame[region.top + i] = content[i] ?? '';
  }
  if (!minimal && !still) {
    const transitions = new Transitions(() => config.motion, () => ({reducedMotion: false, effectsOff: config.presentation.effectsOff, color: true}));
    transitions.launch(1100); transitions.seal(0, 'success', 3300);
    const transcriptTop = plan.transcript.top;
    const sourceRows = wrapped.slice(-Math.max(1, plan.transcript.height));
    for (const event of transitions.live(t)) {
      if (event.kind !== 'launch' && event.kind !== 'seal') continue;
      for (let i = 0; i < sourceRows.length; i++) {
        if (sourceRows[i]!.blockStartId !== 0) continue;
        const paint = event.kind === 'launch' ? transitionPaint.launch(event.style, width, progress(event, t), false, event.look)
          : transitionPaint.seal(event.tone, width, progress(event, t), event.look);
        frame[transcriptTop + i] = overlayRow(frame[transcriptTop + i] ?? '', paint, width);
      }
    }
    const region = plan.regions.find(region => region.kind === 'input');
    if (t < 1100 && region) {
      const settings = resolveCursorSettings(config.cursor, contextFor(config));
      const engine = new CursorEngine(settings, seededRandom(7));
      for (let at = 0; at <= t; at += 40) {
        const part = COMMAND.slice(0, Math.floor(at * COMMAND.length / 1050));
        const inputAt = layoutInput(part, Array.from(part).length, width, 2, prefix);
        engine.target({row: region.top + inputAt.caretRow, column: inputAt.caretColumn}, at, 'typing'); engine.step(at);
      }
      const painted = overlayFrame(frame, engine.paints(effectPalette(settings), {top: Math.max(0, region.top - 1), bottom: region.top + region.height - 1, columns: width}, t), width);
      frame.splice(0, frame.length, ...painted);
    }
  }
  // A compact affordance belongs to this labelled demo, never the live transcript.
  if (!minimal && t >= 5700 && rows > 12) frame[0] = 'Selected · Enter Copy · A Actions';
  return {rows: frame.map(row => truncateAnsi(row, width)), busy, phase};
}
