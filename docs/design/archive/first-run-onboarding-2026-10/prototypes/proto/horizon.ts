/**
 * Concept 1 — HORIZON. A living Aurora sky ends at a sharp, luminous horizon;
 * everything you touch sits on solid ground below it, on the terminal's own
 * background. The highlighted choice is a powerline segment whose wedge points
 * at what it means.
 */
import {
  backdropFrameMs, backdropMood, blendPalettes, BOLD, button, Canvas, CHOICES, composerRows, configFor, drawCat, drawHorizon, ease, FAINT, fg, bg, headerRow,
  ITALIC, KEEP_NOTE, keepPlan, keycap, keycaps, LEDGER_MARKS, moodPalette, none, REVIEW, sampleExternalPrompt, sectionTitles, segment, segmented, Sky, skyTime,
  tokens, truncate, welcomeRows, withNeutralChrome, wordmark, wrap, type Backdrop, type Choice, type Concept, type Env, type Mood, type State,
} from './kit.js';
import {buildThemePreviewLine, CellGrid, displayWidth, NO_COLOR_VALUE, type CatPose, type IdlePalette, type Key, type NativePaletteId} from './src.js';

const sky = new Sky();
const STARTED = Date.now();
export const LOOK_THEMES: readonly NativePaletteId[] = ['lavender', 'aurora', 'ocean', 'sunset', 'forest', 'grayscale'];
const THEME_LABELS: Partial<Record<NativePaletteId, string>> = {lavender: 'Lavender Native', aurora: 'Aurora', ocean: 'Ocean', sunset: 'Sunset', forest: 'Forest', grayscale: 'Grayscale'};
export const auroraLabel = (backdrop: Backdrop) => none() || backdrop === 'off' ? 'Aurora off' : backdrop === 'subtle' ? 'Aurora subtle' : 'Aurora on';

function catPose(state: State, now: number, env: Env): CatPose {
  if (env.reduced) return 'idle';
  if (now - state.changedAt < 360) return 'tail';
  return (now - STARTED) % 6400 < 160 ? 'blink' : 'idle';
}

/** The ground's needs are the same whichever choice is highlighted, so the sky never jumps. */
function skyHeight(state: State, height: number, ground: number): number {
  if (state.screen === 'customize') return height >= 24 ? 3 : 0;
  if (height < 20) return 0;
  return Math.max(4, Math.min(Math.round(height * 0.42), height - ground));
}

/** Reactive variant: each choice lights the sky its own way; Keep Existing lets it go out. */
function reactivePalette(state: State, now: number, env: Env, mood: Mood): IdlePalette | undefined {
  const of = (choice: number): Mood | undefined => choice === 3 ? undefined : choice === 1 ? 'calm' : choice === 2 ? (mood === 'subtle' ? 'subtle' : 'spectrum') : mood;
  const palette = (m: Mood | undefined) => {
    if (m) return moodPalette(m, env.config);
    const calm = moodPalette('calm', env.config);
    return {...calm, stops: calm.stops.map(() => calm.sky), star: calm.sky};
  };
  const k = env.reduced ? 1 : ease((now - state.changedAt) / 700);
  if (!of(state.choice) && k >= 1) return undefined;
  return blendPalettes(palette(of(state.previousChoice)), palette(of(state.choice)), k);
}

function drawSky(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env, margin: number, cat: boolean): void {
  const t = tokens();
  const mood = backdropMood(state.backdrop);
  if (height <= 0) return;
  const lit = mood && env.reactive && state.screen !== 'customize' ? reactivePalette(state, now, env, mood) : mood ? moodPalette(mood, env.config) : undefined;
  if (lit && mood) {
    const grid = sky.draw(width, height, skyTime(now, STARTED, env, mood === 'subtle' || (env.reactive && state.choice === 1) ? 0.45 : 1), lit, g => {
      if (cat) drawCat(g, margin, height - 4, catPose(state, now, env), true);
      drawHorizon(g, t.accent);
    });
    canvas.grid(0, 0, grid);
    return;
  }
  // Off (or no color): no sky; the horizon stays as a quiet hairline with Vespyr standing on it.
  const grid = new CellGrid();
  grid.resize(width, height);
  grid.clear(NO_COLOR_VALUE);
  if (cat && !none()) drawCat(grid, margin, height - 4, catPose(state, now, env), true);
  canvas.grid(0, 0, grid);
  for (let x = 0; x < width; x++) {
    if (canvas.cells[height - 1]![x]!.ch === ' ') canvas.text(x, height - 1, none() ? '_' : '▁', fg(t.separator));
  }
}

function header(canvas: Canvas, x: number, y: number, width: number): number {
  const t = tokens();
  const after = canvas.text(x, y, 'Welcome to ', `${BOLD}${fg(t.primary)}`);
  wordmark(canvas, after, y);
  const lines = wrap('Four ways to begin. Nothing changes until you confirm, and /startup brings you back.', width);
  lines.forEach((line, i) => canvas.text(x, y + 1 + i, line, fg(t.secondary)));
  return y + 1 + lines.length;
}

/** The four choices; the highlighted one is a filled segment whose wedge points right. */
function list(canvas: Canvas, state: State, x: number, y: number, width: number, compact: boolean, faded: boolean, expand?: (y: number) => number, textMax = x + width + 1): number {
  const t = tokens();
  let row = y;
  CHOICES.forEach((choice, index) => {
    const selected = index === state.choice;
    if (selected) segment(canvas, x, row, ` ${choice.key}  ${choice.title}`.padEnd(width - 2), t.accent, t.ink, {bold: true, selected: true});
    else {
      canvas.text(x + 1, row, ` ${choice.key}`, fg(t.muted));
      canvas.text(x + 5, row, choice.title, `${faded ? FAINT : ''}${fg(t.secondary)}`, undefined, textMax);
    }
    row += 1;
    if (!compact || selected) {
      canvas.text(x + 5, row, choice.line, `${faded && !selected ? FAINT : ''}${fg(selected ? t.secondary : t.subtle)}`, undefined, textMax);
      row += 1;
    }
    if (selected && expand) row = expand(row);
    if (!compact) row += 1;
  });
  return row;
}

function eyebrow(canvas: Canvas, x: number, y: number, label: string, width: number): void {
  const t = tokens();
  const end = canvas.text(x, y, '◆', fg(t.accent));
  const text = canvas.text(end + 1, y, label.split('').join(' '), fg(t.muted));
  canvas.text(text + 2, y, '─'.repeat(Math.max(0, x + width - text - 2)), fg(t.plate));
}

/** Read-only evidence, as the detector reports it. Returns the next free row. */
function keepEvidence(canvas: Canvas, x: number, y: number, width: number, env: Env, maxY: number): number {
  const t = tokens();
  const plan = keepPlan(env.keepCase);
  canvas.text(x, y, 'Found on this Mac', fg(t.muted));
  canvas.text(x + 18, y, 'read-only · nothing is changed', `${ITALIC}${fg(t.subtle)}`);
  let row = y + 1;
  for (const item of plan.found) {
    if (row >= maxY) return row;
    const end = canvas.text(x, row, item.mark === 'ok' ? (none() ? '+' : '✓') : '!', fg(item.mark === 'ok' ? t.success : t.warning));
    const after = canvas.text(end + 1, row, item.what, fg(t.primary));
    canvas.text(after + 2, row++, item.why, fg(t.subtle), undefined, x + width);
  }
  return row;
}

/** The one honest question Keep Existing may need (two prompts, or a custom prompt NMSh cannot draw yet). */
function keepQuestion(canvas: Canvas, x: number, y: number, width: number, plan: ReturnType<typeof keepPlan>): number {
  const t = tokens();
  const question = plan.question!;
  let row = y;
  canvas.text(x, row++, question.title, `${BOLD}${fg(t.warning)}`, undefined, x + width);
  const labelWidth = Math.max(...question.options.map(([label]) => displayWidth(label))) + 2;
  question.options.forEach(([label, detail], i) => {
    const chosen = i === 0;
    canvas.text(x, row, chosen ? '›' : ' ', `${BOLD}${fg(t.accent)}`);
    canvas.text(x + 2, row, ` ${label} `.padEnd(labelWidth), chosen ? `${BOLD}${fg(t.ink)}` : fg(t.secondary), bg(chosen ? t.accent : t.plate));
    canvas.text(x + 4 + labelWidth, row++, detail, fg(t.subtle), undefined, x + width);
  });
  for (const line of wrap(question.note, width)) canvas.text(x, row++, line, `${ITALIC}${fg(t.subtle)}`);
  return row;
}

function preview(canvas: Canvas, state: State, x: number, y: number, width: number, env: Env, maxY: number): void {
  const t = tokens();
  if (y >= maxY) return;
  if (state.choice === 2) {
    // The setup map: every step as a small tile with a colored cap, like the guided tour's own route.
    const titles = sectionTitles().slice(1, -1);
    const columns = Math.max(2, Math.floor((width + 1) / 13));
    const caps = moodPalette('spectrum', env.config).stops;
    titles.forEach((title, i) => {
      const cx = x + (i % columns) * 13, cy = y + Math.floor(i / columns) * 3;
      if (cy + 1 >= maxY) return;
      const cap = caps[i % caps.length]!;
      if (none()) { canvas.text(cx, cy + 1, `[${title}]`, ''); return; }
      canvas.text(cx, cy, '▀'.repeat(12), fg({red: (cap >> 16) & 255, green: (cap >> 8) & 255, blue: cap & 255}), bg(t.plate));
      canvas.text(cx, cy + 1, ` ${title}`.padEnd(12), fg(t.primary), bg(t.plate));
    });
    return;
  }
  if (state.choice === 3) {
    const row = keepEvidence(canvas, x, y, width, env, maxY - 3);
    if (row + 2 >= maxY) return;
    // Their prompt as it would sit above NMSh's composer: theirs, in their terminal's palette, NMSh's chrome neutral.
    withNeutralChrome(env.config, () => {
      canvas.ansi(x, row + 1, sampleExternalPrompt(), width);
      canvas.text(x, row + 2, '❯', `${BOLD}${fg(tokens().accent)}`);
      canvas.text(x + 2, row + 2, 'sample of a detected Starship prompt', `${ITALIC}${fg(tokens().subtle)}`);
    });
    return;
  }
  const config = configFor(state.choice as Choice, state.layout, env.palette);
  let row = y;
  if (state.choice === 1) {
    canvas.text(x, row, 'Layout', fg(t.muted));
    const end = segmented(canvas, x + 8, row, ['Two-line', 'One-line'], state.layout === 'twoLine' ? 0 : 1);
    canvas.text(end + 2, row, '←→', fg(t.subtle));
    row += 2;
  }
  for (const line of composerRows(config, width, `${fg(t.subtle)}git status\u001b[0m`)) if (row < maxY) canvas.ansi(x, row++, line, width);
}

function details(canvas: Canvas, state: State, x: number, y: number, width: number, env: Env, maxY: number): void {
  const t = tokens();
  const choice = CHOICES[state.choice];
  eyebrow(canvas, x, y, choice.eyebrow, width);
  let row = y + 2;
  for (const line of wrap(choice.lead, width)) canvas.text(x, row++, line, fg(t.primary));
  row += 1;
  // Keep Existing shows its evidence and Customize its map instead of promises; the others list what they bring.
  if (state.choice < 2 && maxY - row >= 8) {
    for (const feature of choice.features) {
      const end = canvas.text(x, row, state.choice === 1 ? '◇' : '◆', fg(state.choice === 1 ? t.muted : t.accent));
      canvas.text(end + 1, row++, feature, fg(t.secondary), undefined, x + width);
    }
    row += 1;
  }
  preview(canvas, state, x, row, width, env, maxY);
}

function review(canvas: Canvas, state: State, x: number, y: number, width: number, env: Env, maxY: number): void {
  const t = tokens();
  if (state.choice === 3) {
    const plan = keepPlan(env.keepCase);
    // With a question to answer, the eyebrow gives way and the ledger keeps to one line each.
    if (!plan.question) eyebrow(canvas, x, y, 'REVIEW', width);
    const top = plan.question ? y : y + 2;
    canvas.text(x, top, 'Keep your terminal as it is?', `${BOLD}${fg(t.primary)}`);
    canvas.text(x, top + 1, 'NMSh never edits your prompt, theme or shell files.', fg(t.secondary), undefined, x + width);
    let row = top + 3;
    if (plan.question) row = keepQuestion(canvas, x, row, width, plan) + 1;
    const colors = {keep: t.success, adapter: t.accent, add: t.warning} as const;
    for (const [kind, label, text] of plan.ledger) {
      canvas.text(x, row, LEDGER_MARKS[kind][none() ? 1 : 0], `${BOLD}${fg(colors[kind])}`);
      canvas.text(x + 3, row, label, fg(t.subtle));
      const lines = plan.question ? [truncate(text, width - 21)] : wrap(text, width - 21);
      lines.forEach((line, i) => canvas.text(x + 21, row + i, line, fg(t.primary)));
      row += lines.length + (lines.length > 1 ? 1 : 0);
    }
    void maxY;
    button(canvas, x, row + 2, 22, '⏎  Keep my setup', t.accent, t.ink);
    keycap(canvas, x + 25, row + 2, 'esc', 'back');
    return;
  }
  const choice = CHOICES[state.choice];
  eyebrow(canvas, x, y, 'REVIEW', width);
  canvas.text(x, y + 2, `Start with ${choice.title}?`, `${BOLD}${fg(t.primary)}`);
  let row = y + 3;
  for (const line of wrap(`This sets NMSh's look and feel. ${KEEP_NOTE}`, width)) canvas.text(x, row++, line, fg(t.secondary));
  row += 1;
  for (const [label, value] of REVIEW[state.choice as 0 | 1]) {
    canvas.text(x, row, label, fg(t.subtle));
    canvas.text(x + 13, row++, value, fg(t.primary), undefined, x + width);
  }
  button(canvas, x, row + 2, 18, '⏎  Apply', t.accent, t.ink);
  keycap(canvas, x + 21, row + 2, 'esc', 'back');
}

function confirmSheet(canvas: Canvas, state: State, width: number, height: number, margin: number, ground: number): void {
  const t = tokens();
  const top = height - 4;
  // Only the ground dims: faint text would tear the sky's half-block pixels.
  canvas.dim(0, ground, width, top - ground);
  const stay = state.confirmIndex === 0;
  const leaveX = width - margin - 9, stayX = leaveX - 10;
  if (none()) {
    canvas.text(margin, top + 1, 'Leave setup? Nothing changes. /startup reopens it.', BOLD);
    canvas.text(stayX, top + 2, stay ? '[Stay]' : ' Stay ', stay ? BOLD : '');
    canvas.text(leaveX, top + 2, stay ? ' Leave ' : '[Leave]', stay ? '' : BOLD);
    return;
  }
  canvas.text(0, top, '▄'.repeat(width), fg(t.plate));
  canvas.fill(0, top + 1, width, 3, bg(t.plate));
  canvas.text(margin, top + 1, 'Leave setup?', `${BOLD}${fg(t.primary)}`, bg(t.plate));
  canvas.text(margin, top + 2, 'Nothing changes: NMSh keeps its current settings. /startup reopens this anytime.', fg(t.secondary), bg(t.plate), stayX - 2);
  canvas.text(stayX, top + 1, '  Stay  ', `${BOLD}${fg(stay ? t.ink : t.primary)}`, bg(stay ? t.accent : t.raised));
  canvas.text(leaveX, top + 1, '  Leave  ', `${BOLD}${fg(!stay ? t.ink : t.primary)}`, bg(!stay ? t.accent : t.raised));
  canvas.text(margin, top + 3, '←→ choose · ⏎ confirm · esc stay', fg(t.subtle), bg(t.plate));
}

function footer(canvas: Canvas, state: State, width: number, y: number, margin: number): void {
  // In review the button and its esc carry the actions; the footer keeps only the Aurora switch.
  const keys: Array<readonly [string, string, boolean?]> = state.screen === 'review' ? []
    : [['↑↓', 'choose'], ['1–4', 'jump'], ['⏎', 'continue', true], ['esc', 'leave']];
  const label = auroraLabel(state.backdrop);
  const right = width - margin - (displayWidth(label) + 4);
  keycaps(canvas, margin, y, keys, width >= 60 ? right - 2 : width - margin);
  if (width >= 60) keycap(canvas, right, y, 'A', label);
}

function tiny(canvas: Canvas, state: State, height: number): string[] {
  const t = tokens();
  canvas.text(1, 0, 'notMyShell', `${BOLD}${fg(t.primary)}`);
  canvas.text(12, 0, '· start', fg(t.subtle));
  CHOICES.forEach((choice, index) => {
    const selected = index === state.choice;
    canvas.text(1, 2 + index, selected ? '›' : ' ', fg(t.accent));
    canvas.text(3, 2 + index, `${choice.key} ${choice.short}`, selected ? `${BOLD}${fg(t.primary)}` : fg(t.secondary));
  });
  if (height > 8) canvas.text(1, Math.min(height - 1, 7), '⏎ continue · esc leave', fg(t.subtle));
  return canvas.rows();
}

// ---- the guided setup (Customize Everything), in Horizon's language -------------------------

function customize(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env, margin: number): void {
  const t = tokens();
  const skyH = skyHeight(state, height, 0);
  drawSky(canvas, state, width, skyH, now, env, margin, false);
  let y = skyH + 1;
  const sections = sectionTitles();
  const current = 2;
  let column = margin;
  let hidden = 0;
  sections.forEach((title, index) => {
    if (column + displayWidth(title) + 4 > width - margin - 6) { hidden += 1; return; }
    if (index === current) column = segment(canvas, column, y, ` ${title} `, t.accent, t.ink, {bold: true, selected: true}) + 1;
    else column = canvas.text(column, y, title, fg(index < current ? t.muted : t.secondary)) + 1;
    if (index !== current - 1 && index !== current) column = canvas.text(column, y, '›', fg(t.plate)) + 1;
  });
  if (hidden) canvas.text(column, y, `+${hidden}`, fg(t.subtle));
  y += 2;
  canvas.text(margin, y, 'Look', `${BOLD}${fg(t.primary)}`);
  canvas.text(margin + 6, y, 'theme, text and chrome', fg(t.secondary));
  const step = `Step ${current + 1} of ${sections.length}`;
  canvas.text(width - margin - displayWidth(step), y, step, fg(t.subtle));
  y += 2;
  const theme = LOOK_THEMES[state.customize.theme]!;
  const rows: Array<[string, string]> = [['Theme', THEME_LABELS[theme] ?? theme], ['Theme text', 'On'], ['Surface tint', 'Lavender'], ['Vibrance', 'Standard'], ['UI chrome', 'Follow theme'], ['Chroma', 'Off'], ['Theme Bridge', 'No']];
  const listWidth = Math.min(44, Math.floor(width * 0.42));
  rows.forEach(([label, value], index) => {
    const selected = index === state.customize.row;
    if (selected) {
      segment(canvas, margin, y + index, ` ${label}`.padEnd(16), t.accent, t.ink, {bold: true, selected: true, open: false});
      canvas.text(margin + 19, y + index, `‹ ${value} ›`, `${BOLD}${fg(t.accent)}`);
    } else {
      canvas.text(margin + 1, y + index, label, fg(t.secondary));
      canvas.text(margin + 19, y + index, value, fg(t.subtle));
    }
  });
  const px = margin + listWidth + 4, pw = width - px - margin;
  if (pw >= 30) {
    const preview = {...env.config, nmsh: {...env.config.nmsh, palette: theme}};
    canvas.text(px, y, 'Live preview', fg(t.muted));
    canvas.ansi(px, y + 2, buildThemePreviewLine(preview, theme, pw), pw);
    canvas.text(px, y + 3, '❯', `${BOLD}${fg(t.accent)}`);
    canvas.text(px + 2, y + 3, 'npm test', fg(t.primary));
    canvas.text(px + 2, y + 4, '✔ 42 passing (1.2s)', fg(t.success));
    canvas.text(px, y + 6, ` ${'Selected row'.padEnd(Math.min(pw - 2, 30))}`, `${BOLD}${fg(t.primary)}`, bg(t.deep));
    canvas.text(px, y + 7, ' Another row', fg(t.secondary));
    canvas.text(px, y + 9, 'Every change previews here. Nothing is saved until Review & Apply.', fg(t.subtle), undefined, px + pw);
  }
  keycaps(canvas, margin, height - 1, [['↑↓', 'select'], ['←→', 'change'], ['Tab', 'next step'], ['⏎', 'next', true], ['esc', 'back to start']], width - margin);
}

// ---- after Apply: the welcome lives in the transcript ---------------------------------------

function composer(canvas: Canvas, config: ReturnType<typeof configFor>, width: number, height: number): void {
  const t = tokens();
  canvas.ansi(0, height - 3, headerRow(config, width), width);
  canvas.text(0, height - 2, '❯', `${BOLD}${fg(t.accent)}`);
  canvas.text(2, height - 2, ' ', '', bg(t.accent));
  canvas.text(0, height - 1, '─'.repeat(width), fg(t.separator));
}

function welcome(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env): void {
  const t = tokens();
  const elapsed = env.reduced ? 10_000 : now - state.screenAt;
  if (elapsed < 520 && backdropMood(state.backdrop)) {
    // The sky sets: it folds up into the horizon before the transcript returns.
    drawSky(canvas, state, width, Math.round((1 - ease(elapsed / 520)) * skyHeight({...state, screen: 'pick'}, height, 24)), now, env, 4, false);
    return;
  }
  const rows = welcomeRows(width, !env.reduced && elapsed > 1400 && elapsed < 1550 ? 'blink' : 'open');
  rows.forEach((row, i) => canvas.ansi(0, i, row, width));
  let y = rows.length + 1;
  const reveal = (index: number) => env.reduced || elapsed - 520 > index * 70;
  const x = 2, w = Math.min(width - 4, 76);
  if (reveal(0)) {
    // A short luminous rule: the horizon, kept.
    const stops = moodPalette('aurora', env.config).stops;
    for (let i = 0; i < Math.min(w, 44); i++) {
      const p = i / 43 * (stops.length - 1), k = Math.floor(p), f = p - k;
      const a = stops[k]!, b = stops[Math.min(stops.length - 1, k + 1)]!;
      const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
      canvas.text(x + i, y, none() ? '_' : '▁', fg({red: mix(16), green: mix(8), blue: mix(0)}));
    }
  }
  y += 1;
  if (reveal(1)) canvas.text(x, y, 'You\'re all set. Welcome to notMyShell!', `${BOLD}${fg(t.primary)}`);
  y += 1;
  const lead = wrap('We\'re so glad you\'re here. Your shell is still yours; NMSh just makes it a nicer place to live.', w);
  if (reveal(2)) lead.forEach((line, i) => canvas.text(x, y + i, line, fg(t.secondary)));
  y += lead.length + 1;
  const tips: Array<[string, string]> = [['/guide', 'take the tour: everything NMSh can do'], ['/btw', 'ask NMSh anything, in plain English'], ['F1', 'open the command palette'], ['/startup', 'change your starting point anytime']];
  tips.forEach(([key, action], i) => {
    if (!reveal(3 + i)) return;
    canvas.text(x + 2, y + i, key, `${BOLD}${fg(t.accent)}`);
    canvas.text(x + 13, y + i, action, fg(t.secondary));
  });
  y += tips.length + 1;
  if (reveal(8)) canvas.text(x, y, 'The aurora lives on in /screensaver.', `${ITALIC}${fg(t.subtle)}`);
  composer(canvas, configFor(0, 'twoLine', env.palette), width, height);
}

function settled(canvas: Canvas, state: State, width: number, height: number, env: Env): void {
  const t = tokens();
  if (state.screen === 'quiet') {
    canvas.text(0, 0, none() ? '+' : '✓', fg(t.success));
    canvas.text(2, 0, `Minimal Terminal is ready · ${state.layout === 'twoLine' ? 'Two-line' : 'One-line'} · /startup to change`, fg(t.subtle));
    composerRows(configFor(1, state.layout, env.palette), width, '').forEach((row, i) => canvas.ansi(0, 2 + i, row, width));
    return;
  }
  if (state.screen === 'kept') {
    withNeutralChrome(env.config, () => {
      const n = tokens();
      canvas.text(0, 0, none() ? '+' : '✓', fg(n.success));
      canvas.text(2, 0, 'Keeping your setup: Starship, zsh and your terminal theme · /startup to change', fg(n.subtle));
      canvas.ansi(0, height - 3, sampleExternalPrompt(), width);
      canvas.text(0, height - 2, '❯', `${BOLD}${fg(n.accent)}`);
      canvas.text(2, height - 2, ' ', '', bg(n.accent));
      canvas.text(0, height - 1, '─'.repeat(width), fg(n.separator));
    });
    return;
  }
  canvas.text(0, 0, 'Setup closed. Nothing was applied · /startup reopens it', fg(t.subtle));
  composer(canvas, env.config, width, height);
}

// ---- the concept ----------------------------------------------------------------------------

export const horizon: Concept = {
  name: 'Horizon',
  navigate(state: State, key: Key, now: number): boolean {
    if (state.screen === 'customize') {
      if (key.kind === 'up') state.customize.row = Math.max(0, state.customize.row - 1);
      else if (key.kind === 'down') state.customize.row = Math.min(6, state.customize.row + 1);
      else if ((key.kind === 'left' || key.kind === 'right') && state.customize.row === 0) {
        state.customize.theme = (state.customize.theme + (key.kind === 'left' ? LOOK_THEMES.length - 1 : 1)) % LOOK_THEMES.length;
      } else return false;
      return true;
    }
    if (state.screen !== 'pick') return false;
    if (key.kind === 'up' || key.kind === 'down') {
      state.previousChoice = state.choice;
      state.choice = ((state.choice + (key.kind === 'up' ? 3 : 1)) % 4) as Choice;
      state.changedAt = now;
      return true;
    }
    if (state.choice === 1 && (key.kind === 'left' || key.kind === 'right' || key.kind === 'complete')) {
      state.layout = state.layout === 'twoLine' ? 'oneLine' : 'twoLine';
      return true;
    }
    return false;
  },
  frameMs(state: State, now: number, env: Env): number {
    if (state.screen === 'welcome' && !env.reduced && now - state.screenAt < 2000) return 40;
    if (!env.reduced && now - state.changedAt < (env.reactive ? 760 : 400)) return 40;
    return ['pick', 'review', 'confirm', 'customize'].includes(state.screen) ? backdropFrameMs(state.backdrop, env) : 0;
  },
  render(state: State, width: number, height: number, now: number, env: Env): string[] {
    const canvas = new Canvas(width, height);
    if (width < 40 || height < 14) return tiny(canvas, state, height);
    const margin = width >= 120 ? 6 : width >= 90 ? 4 : width >= 56 ? 3 : 2;
    if (state.screen === 'customize') { customize(canvas, state, width, height, now, env, margin); return canvas.rows(); }
    if (state.screen === 'welcome') { welcome(canvas, state, width, height, now, env); return canvas.rows(); }
    if (state.screen === 'quiet' || state.screen === 'kept' || state.screen === 'left') { settled(canvas, state, width, height, env); return canvas.rows(); }
    const reviewing = state.screen === 'review' || (state.screen === 'confirm' && state.confirmFrom === 'review');
    const two = width >= 96;
    const ground = two ? 22 : 18;
    const skyH = skyHeight(state, height, ground);
    drawSky(canvas, state, width, skyH, now, env, margin, width >= 56 && skyH >= 5);
    const y = header(canvas, margin, skyH + 1, Math.min(width - margin * 2, 90)) + 1;
    const maxY = height - 2;
    const listWidth = Math.max(34, Math.min(46, Math.round(width * 0.34)));
    if (two) {
      list(canvas, state, margin, y, listWidth, maxY - y < 15, reviewing);
      const dx = margin + listWidth + 4, dw = Math.min(72, width - dx - margin);
      if (reviewing) review(canvas, state, dx, y, dw, env, maxY);
      else details(canvas, state, dx, y, dw, env, maxY);
    } else {
      // Narrow: the highlighted choice opens in place (an accordion) with its essentials.
      list(canvas, state, margin, y, Math.min(width - margin * 2, 40), true, reviewing, row => {
        const t = tokens();
        const lines = reviewing ? [state.choice === 3 ? 'Keep my setup? ⏎ to confirm' : `Apply ${CHOICES[state.choice].short}? ⏎ to confirm`]
          : CHOICES[state.choice].features.slice(0, maxY - y >= 14 ? 3 : 1);
        for (const line of lines) canvas.text(margin + 5, row++, line, fg(reviewing ? t.primary : t.subtle), undefined, width - margin);
        return row + 1;
      }, width - margin);
    }
    if (state.screen === 'confirm') confirmSheet(canvas, state, width, height, margin, skyH);
    else footer(canvas, state, width, height - 1, margin);
    return canvas.rows();
  },
};
