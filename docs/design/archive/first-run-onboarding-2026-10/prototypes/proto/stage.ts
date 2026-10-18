/**
 * Concept 2 — STAGE. Each starting point gets the whole stage: a page with its
 * own type and a tall art window. The real Aurora becomes the lighting, and the
 * lighting means something: vivid for Recommended, a calm still night for
 * Minimal, a spectrum behind the setup map for Customize, and for Keep Existing
 * it fades away entirely to show the person's own terminal.
 */
import {
  backdropFrameMs, backdropMood, blendPalettes, BOLD, button, Canvas, CHOICES, composerBar, composerRows, configFor, drawCat, drawHorizon, ease, fg, bg,
  ITALIC, KEEP_NOTE, keepPlan, keycap, keycaps, LEDGER_MARKS, moodPalette, none, REVIEW, sampleExternalPrompt, sectionTitles, segment, segmented,
  settledScreen, Sky, skyTime, TIPS, tokens, welcomeRows, withNeutralChrome, wordmark, wrap, type Choice, type Concept, type Env, type Mood, type State,
} from './kit.js';
import {buildThemePreviewLine, CellGrid, displayWidth, GLYPHS, NO_COLOR_VALUE, type CatPose, type IdlePalette, type Key} from './src.js';
import {auroraLabel, LOOK_THEMES} from './horizon.js';

const sky = new Sky();
const postcard = new Sky();
const STARTED = Date.now();
const POSES: readonly CatPose[] = ['idle', 'sit', 'paw', 'idle'];
const CTA = ['⏎  Start with Recommended', '⏎  Start with Minimal', '⏎  Begin the tour', '⏎  Keep my setup'] as const;
const INDEX = ['01', '02', '03', '04'] as const;

/** The lighting for a page under the chosen backdrop; Keep Existing has none (undefined). */
function pageMood(choice: number, state: State): Mood | undefined {
  const backdrop = backdropMood(state.backdrop);
  if (!backdrop || choice === 3) return undefined;
  if (state.screen === 'confirm') return 'dusk';
  if (choice === 1) return 'calm';
  if (choice === 2) return backdrop === 'subtle' ? 'subtle' : 'spectrum';
  return backdrop;
}

function night(env: Env): IdlePalette {
  const calm = moodPalette('calm', env.config);
  return {...calm, stops: calm.stops.map(() => calm.sky), star: calm.sky};
}

/** Cross-fades the lighting between pages: the engine keeps flowing while its colors change. */
function lighting(state: State, now: number, env: Env): IdlePalette | undefined {
  const to = pageMood(state.choice, state);
  const from = pageMood(state.previousChoice, state);
  const k = env.reduced ? 1 : ease((now - state.changedAt) / 700);
  const palette = (mood: Mood | undefined) => mood ? moodPalette(mood, env.config) : night(env);
  if (!to && k >= 1) return undefined;
  return blendPalettes(palette(from), palette(to), k);
}

function catPose(state: State, now: number, env: Env): CatPose {
  if (env.reduced) return POSES[state.choice]!;
  if (now - state.changedAt < 300) return 'crouch';
  return (now - STARTED) % 6400 < 160 ? 'blink' : POSES[state.choice]!;
}

/** The setup map: every section as a sharp tile, the sky showing through the gutters, clear of Vespyr. */
function mosaic(grid: CellGrid, palette: IdlePalette): void {
  const t = tokens();
  const titles = sectionTitles().slice(1, -1);
  const columns = Math.max(2, Math.floor((grid.width - 4) / 16));
  const tile = Math.floor((grid.width - 4 - (columns - 1) * 2) / columns);
  const top = Math.max(1, grid.height - 6 - Math.ceil(titles.length / columns) * 3);
  const plate = (t.plate.red << 16) | (t.plate.green << 8) | t.plate.blue;
  const ink = (t.primary.red << 16) | (t.primary.green << 8) | t.primary.blue;
  titles.forEach((title, i) => {
    const x = 2 + (i % columns) * (tile + 2), y = top + Math.floor(i / columns) * 3;
    if (y + 1 >= grid.height) return;
    for (let dx = 0; dx < tile; dx++) {
      grid.set(x + dx, y, '▀', palette.stops[i % palette.stops.length]!, plate);
      grid.set(x + dx, y + 1, ' ', ink, plate);
    }
    [...` ${title}`].slice(0, tile).forEach((ch, dx) => grid.set(x + dx, y + 1, ch, ink, plate));
  });
}

function windowArt(canvas: Canvas, state: State, x: number, y: number, w: number, h: number, now: number, env: Env): void {
  const t = tokens();
  const palette = lighting(state, now, env);
  if (state.choice === 3 && !palette) return keepWindow(canvas, x, y, w, h, env);
  if (!palette) {
    // Backdrop Off: no sky; Vespyr stands on a quiet hairline and the page keeps its own art.
    const grid = new CellGrid();
    grid.resize(w, h);
    grid.clear(NO_COLOR_VALUE);
    if (!none()) drawCat(grid, 3, h - 4, catPose(state, now, env), true);
    if (state.choice === 2) mosaic(grid, moodPalette('spectrum', env.config));
    canvas.grid(x, y, grid);
    for (let dx = 0; dx < w; dx++) if (canvas.cells[y + h - 1]![x + dx]!.ch === ' ') canvas.text(x + dx, y + h - 1, none() ? '_' : '▁', fg(t.separator));
    return;
  }
  const speed = state.choice === 1 ? 0.35 : 1;
  const grid = sky.draw(w, h, skyTime(now, STARTED, env, speed), palette, g => {
    if (state.choice === 2) mosaic(g, palette);
    drawCat(g, 3, h - 4, catPose(state, now, env), true);
    drawHorizon(g, t.accent);
  });
  canvas.grid(x, y, grid);
}

/**
 * Keep Existing's window: the lighting is gone. What stands on the stage is the
 * person's own terminal, inset, in neutral chrome, with NMSh's additions named quietly.
 */
function keepWindow(canvas: Canvas, x: number, y: number, w: number, h: number, env: Env): void {
  withNeutralChrome(env.config, () => {
    const n = tokens();
    const px = x + 3, pw = Math.max(20, w - 6), ph = 11;
    const top = y + Math.max(2, Math.floor((h - ph - 4) / 2));
    canvas.text(px, top - 2, 'YOUR TERMINAL, AS IT IS', fg(n.subtle));
    if (!none()) { canvas.text(px, top - 1, '▄'.repeat(pw), fg(n.plate)); canvas.fill(px, top, pw, ph, bg(n.plate)); canvas.text(px, top + ph, '▀'.repeat(pw), fg(n.plate)); }
    const ix = px + 2, iw = pw - 4;
    canvas.ansi(ix, top + 1, sampleExternalPrompt(), iw);
    canvas.text(ix, top + 2, GLYPHS.prompt, `${BOLD}${fg(n.accent)}`);
    canvas.text(ix + 2, top + 2, 'git log --oneline -2', fg(n.primary));
    canvas.text(ix, top + 3, 'a1b2c3d  Keep the prompt you already love', fg(n.secondary), undefined, ix + iw);
    canvas.text(ix, top + 4, '9f8e7d6  Add NMSh around it', fg(n.secondary), undefined, ix + iw);
    canvas.text(ix, top + 6, 'NMSh adds, around it:', fg(n.subtle));
    let column = ix, row = top + 7;
    for (const chip of ['history search', 'queue', 'Copy', 'folding', 'sessions', '/btw']) {
      if (column + displayWidth(chip) + 2 > ix + iw) { column = ix; row += 1; }
      column = canvas.text(column, row, ` ${chip} `, fg(n.primary), bg(n.raised)) + 1;
    }
    canvas.text(px, top + ph + 2, 'Ghostty\'s theme, font and cursor · Starship · zsh', `${ITALIC}${fg(n.subtle)}`, undefined, x + w - 2);
    canvas.text(px, top + ph + 3, 'a sample of what the read-only detector reports', `${ITALIC}${fg(n.subtle)}`, undefined, x + w - 2);
  });
}

function rail(canvas: Canvas, state: State, width: number, margin: number, labels: readonly string[], current: number, numbered = true): void {
  const t = tokens();
  let column = wordmark(canvas, margin, 0) + 4;
  // When every label cannot fit, the others shrink to their numbers; the current one keeps its name.
  const fits = labels.reduce((sum, label) => sum + displayWidth(label) + 7, column) <= width - margin;
  labels.forEach((label, i) => {
    const text = numbered ? ` ${i + 1}  ${label} ` : ` ${label} `;
    if (column + displayWidth(text) + 2 > width - margin && (fits || !numbered || i === current)) return;
    if (i === current) column = segment(canvas, column, 0, text, t.accent, t.ink, {bold: true, selected: true}) + 2;
    else if (numbered && !fits) column = canvas.text(column + 1, 0, String(i + 1), fg(t.secondary)) + 2;
    else {
      if (numbered) canvas.text(column + 1, 0, String(i + 1), fg(t.muted));
      column = canvas.text(column + (numbered ? 4 : 1), 0, label, fg(t.secondary)) + 3;
    }
  });
  canvas.text(0, 1, (none() ? '-' : '─').repeat(width), fg(t.plate));
  void state;
}

function eyebrow(canvas: Canvas, x: number, y: number, index: string, label: string): void {
  const t = tokens();
  const a = canvas.text(x, y, index || '◆', `${BOLD}${fg(t.accent)}`);
  const b = canvas.text(a + 1, y, '────', fg(t.plate));
  canvas.text(b + 1, y, label.split('').join(' '), fg(t.muted));
}

/** One page's words, laid out in its own canvas so it can be revealed with a wipe. Optional blocks give way on short screens. */
function page(state: State, width: number, height: number, env: Env): Canvas {
  for (const optional of [true, false]) {
    const laid = layPage(state, width, height, env, optional);
    if (laid.total <= height || !optional) return laid.canvas;
  }
  return new Canvas(width, height);
}

function layPage(state: State, width: number, height: number, env: Env, optional: boolean): {canvas: Canvas; total: number} {
  const t = tokens();
  const c = new Canvas(width, Math.max(height, 60));
  const choice = CHOICES[state.choice];
  const rows: Array<(y: number) => number> = [];
  const add = (draw: (y: number) => number, keep = true) => { if (keep || optional) rows.push(draw); };
  add(y => { eyebrow(c, 0, y, INDEX[state.choice]!, choice.eyebrow); return y + 2; });
  add(y => { c.text(0, y, choice.title, `${BOLD}${fg(t.primary)}`); c.text(0, y + 1, choice.tagline, fg(t.accent)); return y + 3; });
  add(y => { for (const line of wrap(choice.lead, width)) c.text(0, y++, line, fg(t.secondary)); return y + 1; });
  if (state.choice === 3) {
    add(y => {
      const plan = keepPlan(env.keepCase);
      c.text(0, y++, 'Found on this Mac · read-only', fg(t.muted));
      for (const item of plan.found) {
        const end = c.text(0, y, item.mark === 'ok' ? (none() ? '+' : '✓') : '!', fg(item.mark === 'ok' ? t.success : t.warning));
        const after = c.text(end + 1, y, item.what, fg(t.primary));
        c.text(after + 2, y++, item.why, fg(t.subtle), undefined, width);
      }
      return y + 1;
    });
  } else {
    add(y => {
      for (const feature of choice.features) {
        const end = c.text(0, y, state.choice === 1 ? '◇' : '◆', fg(state.choice === 1 ? t.muted : t.accent));
        c.text(end + 1, y++, feature, fg(t.secondary), undefined, width);
      }
      return y + 1;
    }, false);
  }
  if (state.choice === 1) add(y => {
    c.text(0, y, 'Layout', fg(t.muted));
    const end = segmented(c, 8, y, ['Two-line', 'One-line'], state.layout === 'twoLine' ? 0 : 1);
    c.text(end + 2, y, '↑↓', fg(t.subtle));
    return y + 2;
  });
  if (state.choice < 2) add(y => {
    for (const line of composerRows(configFor(state.choice as Choice, state.layout, env.palette), width, `${fg(t.subtle)}git status\u001b[0m`)) c.ansi(0, y++, line, width);
    return y + 1;
  }, false);
  if (state.choice === 2) add(y => {
    for (const line of wrap(`${sectionTitles().length} steps, each with a live preview. Nothing applies until the last one.`, width)) c.text(0, y++, line, fg(t.subtle));
    return y + 1;
  }, false);
  add(y => { button(c, 0, y + 1, displayWidth(CTA[state.choice]!) + 6, CTA[state.choice]!, t.accent, t.ink); return y + 3; });
  let total = 0;
  for (const draw of rows) total = draw(total);
  const placed = new Canvas(width, height);
  placed.blit(c, 0, Math.max(0, Math.floor((height - total) / 2)));
  return {canvas: placed, total};
}

function reviewPage(state: State, width: number, height: number, env: Env): Canvas {
  const t = tokens();
  const c = new Canvas(width, height);
  let y = 0;
  if (state.choice === 3) {
    const plan = keepPlan(env.keepCase);
    eyebrow(c, 0, y, '04', 'REVIEW'); y += 2;
    c.text(0, y++, 'Keep your terminal as it is?', `${BOLD}${fg(t.primary)}`);
    for (const line of wrap('NMSh never edits your prompt, theme or shell files.', width)) c.text(0, y++, line, fg(t.secondary));
    y += 1;
    if (plan.question) {
      for (const line of wrap(plan.question.title, width)) c.text(0, y++, line, `${BOLD}${fg(t.warning)}`);
      plan.question.options.forEach(([label, detail], i) => {
        if (i === 0) c.text(0, y, '›', `${BOLD}${fg(t.accent)}`);
        c.text(2, y, ` ${label} `, i === 0 ? `${BOLD}${fg(t.ink)}` : fg(t.secondary), bg(i === 0 ? t.accent : t.plate));
        c.text(4, y + 1, detail, fg(t.subtle), undefined, width);
        y += 2;
      });
      for (const line of wrap(plan.question.note, width)) c.text(0, y++, line, `${ITALIC}${fg(t.subtle)}`);
      y += 1;
    }
    const colors = {keep: t.success, adapter: t.accent, add: t.warning} as const;
    for (const [kind, label, text] of plan.ledger) {
      c.text(0, y, LEDGER_MARKS[kind][none() ? 1 : 0], `${BOLD}${fg(colors[kind])}`);
      c.text(3, y++, label, fg(t.subtle));
      for (const line of wrap(text, width - 3)) c.text(3, y++, line, fg(t.primary));
    }
  } else {
    const choice = CHOICES[state.choice];
    eyebrow(c, 0, y, INDEX[state.choice]!, 'READY'); y += 2;
    c.text(0, y++, `Start with ${choice.title}?`, `${BOLD}${fg(t.primary)}`);
    for (const line of wrap(`This sets NMSh's look and feel. ${KEEP_NOTE}`, width)) c.text(0, y++, line, fg(t.secondary));
    y += 1;
    for (const [label, value] of REVIEW[state.choice as 0 | 1]) {
      c.text(0, y, label, fg(t.subtle));
      c.text(13, y++, value, fg(t.primary), undefined, width);
    }
  }
  const label = state.choice === 3 ? '⏎  Keep my setup' : '⏎  Apply';
  button(c, 0, y + 2, displayWidth(label) + 6, label, t.accent, t.ink);
  keycap(c, displayWidth(label) + 9, y + 2, 'esc', 'back');
  const placed = new Canvas(width, height);
  placed.blit(c, 0, Math.max(0, Math.floor((height - (y + 4)) / 2)));
  return placed;
}

function confirmPage(state: State, width: number, height: number): Canvas {
  const t = tokens();
  const c = new Canvas(width, height);
  const top = Math.max(0, Math.floor((height - 10) / 2));
  eyebrow(c, 0, top, '', 'LEAVE');
  c.text(0, top + 2, 'Leave setup?', `${BOLD}${fg(t.primary)}`);
  wrap('Nothing changes: NMSh keeps its current settings. /startup reopens this anytime.', width).forEach((line, i) => c.text(0, top + 3 + i, line, fg(t.secondary)));
  const stay = state.confirmIndex === 0;
  button(c, 0, top + 7, 12, 'Stay', stay ? t.accent : t.raised, stay ? t.ink : t.primary);
  button(c, 14, top + 7, 12, 'Leave', stay ? t.raised : t.accent, stay ? t.primary : t.ink);
  c.text(0, top + 9, '←→ choose · ⏎ confirm · esc stay', fg(t.subtle));
  return c;
}

function customizeStage(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env, margin: number): void {
  const t = tokens();
  const sections = sectionTitles();
  rail(canvas, state, width, margin, sections, 2, false);
  const columnWidth = Math.max(34, Math.min(48, Math.round(width * 0.36)));
  const theme = LOOK_THEMES[state.customize.theme]!;
  let y = 3;
  eyebrow(canvas, margin, y, '03', 'STEP · LOOK'); y += 2;
  canvas.text(margin, y++, 'Theme, text and chrome', `${BOLD}${fg(t.primary)}`);
  canvas.text(margin, y++, 'Everything previews on the stage, live.', fg(t.secondary));
  y += 1;
  const rows: Array<[string, string]> = [['Theme', theme], ['Theme text', 'On'], ['Surface tint', 'Lavender'], ['Vibrance', 'Standard'], ['UI chrome', 'Follow theme'], ['Chroma', 'Off'], ['Theme Bridge', 'No']];
  rows.forEach(([label, value], i) => {
    const selected = i === state.customize.row;
    if (selected) {
      segment(canvas, margin, y + i, ` ${label}`.padEnd(15), t.accent, t.ink, {bold: true, selected: true, open: false});
      canvas.text(margin + 18, y + i, `‹ ${value} ›`, `${BOLD}${fg(t.accent)}`);
    } else {
      canvas.text(margin + 1, y + i, label, fg(t.secondary));
      canvas.text(margin + 18, y + i, value, fg(t.subtle));
    }
  });
  // The stage: a large live preview on a plate.
  const x = margin + columnWidth + 4, w = width - x, h = height - 5;
  canvas.fill(x, 2, w, h, bg(t.plate));
  const px = x + 3, pw = w - 6;
  canvas.text(px, 4, 'LIVE PREVIEW', fg(t.muted), bg(t.plate));
  canvas.ansi(px, 6, buildThemePreviewLine(env.config, theme, pw), pw);
  canvas.text(px, 7, GLYPHS.prompt, `${BOLD}${fg(t.accent)}`, bg(t.plate));
  canvas.text(px + 2, 7, 'npm test', fg(t.primary), bg(t.plate));
  canvas.text(px, 8, '  ✔ 42 passing (1.2s)', fg(t.success), bg(t.plate));
  canvas.text(px, 10, ` ${'Selected row'.padEnd(Math.min(pw - 2, 32))}`, `${BOLD}${fg(t.primary)}`, bg(t.deep));
  canvas.text(px, 12, 'Nothing is saved until Review & Apply.', fg(t.subtle), bg(t.plate), px + pw);
  keycaps(canvas, margin, height - 1, [['↑↓', 'select'], ['←→', 'change'], ['Tab', 'next step'], ['⏎', 'next', true], ['esc', 'back to start']], width - margin);
  void now;
}

function welcomeStage(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env): void {
  const t = tokens();
  const elapsed = env.reduced ? 10_000 : now - state.screenAt;
  const rows = welcomeRows(width);
  rows.forEach((row, i) => canvas.ansi(0, i, row, width));
  const top = rows.length + 1;
  const reveal = (i: number) => env.reduced || elapsed > i * 80;
  const pw = Math.min(44, Math.floor(width * 0.32)), ph = 10;
  const textWidth = Math.min(64, width - pw - 10);
  if (reveal(0)) canvas.text(2, top, 'You\'re all set. Welcome to notMyShell!', `${BOLD}${fg(t.primary)}`);
  if (reveal(1)) wrap('We\'re so glad you\'re here. Your shell is still yours; NMSh just makes it a nicer place to live.', textWidth).forEach((line, i) => canvas.text(2, top + 1 + i, line, fg(t.secondary)));
  TIPS.forEach(([key, action], i) => {
    if (!reveal(2 + i)) return;
    canvas.text(4, top + 5 + i, key, `${BOLD}${fg(t.accent)}`);
    canvas.text(15, top + 5 + i, action, fg(t.secondary));
  });
  // A postcard from the stage: the real aurora for a few seconds, then it holds still.
  if (width >= 90 && backdropMood(state.backdrop)) {
    const still = env.reduced || elapsed > 4200;
    const grid = postcard.draw(pw, ph, skyTime(still ? STARTED : now, STARTED, env), moodPalette('aurora', env.config), g => {
      drawCat(g, 2, ph - 4, still ? 'sit' : catPose(state, now, env), true);
      drawHorizon(g, t.accent);
    });
    canvas.grid(width - pw - 4, top, grid);
    canvas.text(width - pw - 4, top + ph, 'The aurora lives on in /screensaver.', `${ITALIC}${fg(t.subtle)}`, undefined, width - 2);
  }
  composerBar(canvas, configFor(0, 'twoLine', env.palette), width, height);
}

function tinyStage(canvas: Canvas, state: State, width: number, height: number): string[] {
  const t = tokens();
  const choice = CHOICES[state.choice];
  canvas.text(1, 0, `‹ ${state.choice + 1}/4 ›`, fg(t.muted));
  canvas.text(1, 2, choice.title, `${BOLD}${fg(t.primary)}`);
  wrap(choice.line, width - 2).forEach((line, i) => canvas.text(1, 3 + i, line, fg(t.secondary)));
  canvas.text(1, Math.min(height - 1, 7), '←→ browse · ⏎ choose · esc leave', fg(t.subtle));
  return canvas.rows();
}

export const stage: Concept = {
  name: 'Stage',
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
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'complete' || key.kind === 'focusPrevious') {
      state.previousChoice = state.choice;
      state.choice = ((state.choice + (key.kind === 'left' || key.kind === 'focusPrevious' ? 3 : 1)) % 4) as Choice;
      state.changedAt = now;
      return true;
    }
    if (state.choice === 1 && (key.kind === 'up' || key.kind === 'down')) {
      state.layout = state.layout === 'twoLine' ? 'oneLine' : 'twoLine';
      return true;
    }
    return false;
  },
  frameMs(state: State, now: number, env: Env): number {
    if (!env.reduced && (now - state.changedAt < 760 || now - state.screenAt < 400)) return 40;
    if (state.screen === 'welcome') return !env.reduced && now - state.screenAt < 4400 ? backdropFrameMs(state.backdrop, env) : 0;
    if (state.screen === 'customize') return 0;
    if (state.choice === 3 && state.screen !== 'confirm') return 0;
    return ['pick', 'review', 'confirm'].includes(state.screen) ? backdropFrameMs(state.backdrop, env) : 0;
  },
  render(state: State, width: number, height: number, now: number, env: Env): string[] {
    const canvas = new Canvas(width, height);
    if (width < 50 || height < 16) return tinyStage(canvas, state, width, height);
    const margin = width >= 120 ? 5 : width >= 90 ? 4 : 2;
    if (state.screen === 'customize') { customizeStage(canvas, state, width, height, now, env, margin); return canvas.rows(); }
    if (state.screen === 'welcome') { welcomeStage(canvas, state, width, height, now, env); return canvas.rows(); }
    if (state.screen === 'quiet' || state.screen === 'kept' || state.screen === 'left') { settledScreen(canvas, state, width, height, env); return canvas.rows(); }
    const t = tokens();
    rail(canvas, state, width, margin, CHOICES.map(choice => choice.short), state.choice);
    const wide = width >= 96;
    const columnWidth = wide ? Math.max(36, Math.min(54, Math.round(width * 0.4))) : width - margin * 2;
    const stageTop = 2, stageHeight = height - 4;
    const reviewing = state.screen === 'review' || (state.screen === 'confirm' && state.confirmFrom === 'review');
    let textTop = stageTop, textHeight = stageHeight;
    if (wide) windowArt(canvas, state, margin + columnWidth + 4, stageTop, width - (margin + columnWidth + 4), stageHeight, now, env);
    else {
      const band = Math.max(5, Math.min(9, Math.round(height * 0.28)));
      windowArt(canvas, state, 0, stageTop, width, band, now, env);
      textTop = stageTop + band + 1; textHeight = stageHeight - band - 1;
    }
    const content = state.screen === 'confirm' ? confirmPage(state, columnWidth, textHeight)
      : reviewing ? reviewPage(state, columnWidth, textHeight, env) : page(state, columnWidth, textHeight, env);
    // A left-to-right wipe reveals the new page; each row trails the one above it slightly.
    const since = Math.min(now - state.changedAt, now - state.screenAt);
    const front = env.reduced ? Infinity : ease(since / 240) * (columnWidth + textHeight * 2);
    canvas.blit(content, margin, textTop, row => front - row * 2);
    // Footer: where you are, and the keys.
    const dots = CHOICES.map((_, i) => (i === state.choice ? '●' : '○')).join(' ');
    canvas.text(margin, height - 1, none() ? `${state.choice + 1}/4` : dots, fg(t.accent));
    const keys: Array<readonly [string, string, boolean?]> = state.screen === 'pick' ? [['←→', 'browse'], ['1–4', 'jump'], ['⏎', 'choose', true], ['esc', 'leave']]
      : state.screen === 'review' ? [['esc', 'back to the four choices']] : [];
    const label = auroraLabel(state.backdrop);
    const right = width - margin - (displayWidth(label) + 4);
    keycaps(canvas, margin + 10, height - 1, keys, right - 2);
    if (width >= 70) keycap(canvas, right, height - 1, 'A', label);
    return canvas.rows();
  },
};
