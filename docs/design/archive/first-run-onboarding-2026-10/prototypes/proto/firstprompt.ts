/**
 * Concept 3 — FIRST PROMPT. No installer: the first frame is NMSh itself. The
 * transcript opens with a first-run banner (Vespyr under a short live Aurora),
 * NMSh runs /startup for you as an inline card with four powerline chips, and
 * the real composer at the bottom previews the highlighted choice live. After
 * Apply the card folds into a one-line receipt and the welcome carries on in
 * the same transcript.
 */
import {
  backdropFrameMs, backdropMood, BOLD, button, Canvas, CHOICES, composerBar, composerRows, configFor, drawCat, drawHorizon, ease, FAINT, fg, bg, headerRow, ITALIC,
  KEEP_NOTE, keepPlan, keycap, keycaps, LEDGER_MARKS, moodPalette, none, REVIEW, sampleExternalPrompt, sectionTitles, segment, segmented, segmentWidth,
  Sky, skyTime, TIPS, tokens, truncate, welcomeRows, withNeutralChrome, wordmark, wrap, type Choice, type Concept, type Env, type State,
} from './kit.js';
import {buildThemePreviewLine, displayWidth, GLYPHS, type CatPose, type Key} from './src.js';
import {auroraLabel, LOOK_THEMES} from './horizon.js';

const sky = new Sky();
const STARTED = Date.now();

function bannerHeight(height: number): number {
  return height >= 30 ? 6 : height >= 22 ? 5 : 4;
}

function catPose(state: State, now: number, env: Env): CatPose {
  if (env.reduced || state.screen === 'welcome') return 'idle';
  if (now - state.changedAt < 320) return 'tail';
  return (now - STARTED) % 6400 < 160 ? 'blink' : 'idle';
}

/** The first-run banner: the Welcome block's Vespyr and wordmark, under a short ribbon of the real Aurora. */
function banner(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env, still: boolean): number {
  const t = tokens();
  const mood = backdropMood(state.backdrop);
  if (!mood) {
    const rows = welcomeRows(width);
    rows.forEach((row, i) => canvas.ansi(0, i, row, width));
    return rows.length;
  }
  const h = bannerHeight(height);
  const time = still ? STARTED : now;
  const grid = sky.draw(width, h, skyTime(time, STARTED, env, mood === 'subtle' ? 0.55 : 1), moodPalette(mood, env.config), g => {
    drawCat(g, 2, h - 4, catPose(state, now, env), false);
    drawHorizon(g, t.accent);
  });
  canvas.grid(0, 0, grid);
  // The wordmark sits on the dark band below the curtains, as the Welcome block's text sits beside Vespyr.
  const x = 19;
  const end = wordmark(canvas, x, h - 3);
  canvas.text(end + 1, h - 3, 'v0.21.0', fg(t.secondary));
  canvas.text(x, h - 2, 'A real shell. A livelier terminal.', fg(t.secondary));
  return h;
}

function command(canvas: Canvas, y: number, label: string): void {
  const t = tokens();
  canvas.text(1, y, GLYPHS.prompt, `${BOLD}${fg(t.accent)}`);
  canvas.text(3, y, '/startup', `${BOLD}${fg(t.primary)}`);
  canvas.text(13, y, label, `${ITALIC}${fg(t.subtle)}`);
}

/** Four chips in NMSh's own powerline geometry; they wrap, then stack, as the width shrinks. Returns the next row. */
function chips(canvas: Canvas, state: State, x: number, y: number, width: number, faded: boolean): number {
  const t = tokens();
  const full = CHOICES.map(choice => ` ${choice.key} ${choice.title} `);
  const short = CHOICES.map(choice => ` ${choice.key} ${choice.short} `);
  const total = (labels: string[]) => labels.reduce((sum, label) => sum + segmentWidth(label) + 1, 0);
  const labels = total(full) <= width ? full : total(short) <= width ? short : undefined;
  const draw = (label: string, index: number, cx: number, cy: number) => {
    const selected = index === state.choice;
    return segment(canvas, cx, cy, label, selected ? t.accent : t.plate, selected ? t.ink : t.secondary,
      {bold: selected, selected}) + 1;
  };
  if (labels) {
    let column = x;
    labels.forEach((label, i) => { column = draw(label, i, column, y); });
    if (faded) canvas.dim(x, y, width, 1);
    return y + 1;
  }
  // Too narrow for one row: a vertical list keeps every choice visible.
  short.forEach((label, i) => draw(label, i, x, y + i));
  return y + short.length;
}

function detail(canvas: Canvas, state: State, x: number, y: number, width: number, env: Env, room = 99): number {
  const t = tokens();
  const choice = CHOICES[state.choice];
  const bar = (row: number) => canvas.text(x, row, none() ? '|' : '▌', fg(t.accent));
  let row = y;
  bar(row); canvas.text(x + 2, row++, choice.tagline, `${BOLD}${fg(t.primary)}`);
  if (room < 5) return row + 1;
  for (const line of wrap(choice.lead, width - 2).slice(0, room < 7 ? 1 : 3)) { bar(row); canvas.text(x + 2, row++, line, fg(t.secondary)); }
  bar(row);
  if (state.choice === 1) {
    canvas.text(x + 2, row, 'Layout', fg(t.muted));
    const end = segmented(canvas, x + 10, row, ['Two-line', 'One-line'], state.layout === 'twoLine' ? 0 : 1);
    canvas.text(end + 2, row++, '↑↓', fg(t.subtle));
  } else if (state.choice === 3) {
    const plan = keepPlan(env.keepCase);
    canvas.text(x + 2, row++, `Found: ${plan.found.map(item => item.what).join(' · ')}`, fg(t.subtle), undefined, x + width);
  } else if (state.choice === 2) {
    canvas.text(x + 2, row++, sectionTitles().slice(1, -1).join(' · '), fg(t.subtle), undefined, x + width);
  } else {
    canvas.text(x + 2, row++, 'Lavender powerline · rich motion · smart folding · Vespyr greets each session', fg(t.subtle), undefined, x + width);
  }
  if (room < 8) return row + 1;
  row += 1;
  canvas.text(x, row++, state.choice === 2 ? '↓ Your composer stays as it is until the tour applies.' : '↓ The composer below shows this choice, live.', `${ITALIC}${fg(t.subtle)}`);
  return row;
}

function review(canvas: Canvas, state: State, x: number, y: number, width: number, env: Env): number {
  const t = tokens();
  let row = y;
  if (state.choice === 3) {
    const plan = keepPlan(env.keepCase);
    canvas.text(x, row++, 'Keep your terminal as it is? NMSh never edits your prompt, theme or shell files.', `${BOLD}${fg(t.primary)}`, undefined, x + width);
    if (plan.question) {
      row += 1;
      canvas.text(x, row++, plan.question.title, `${BOLD}${fg(t.warning)}`, undefined, x + width);
      let column = x;
      plan.question.options.forEach(([label], i) => { column = canvas.text(column, row, ` ${label} `, i === 0 ? `${BOLD}${fg(t.ink)}` : fg(t.secondary), bg(i === 0 ? t.accent : t.plate)) + 1; });
      row += 1;
      canvas.text(x, row++, `${plan.question.options[0]![1]}. ${plan.question.note}`, `${ITALIC}${fg(t.subtle)}`, undefined, x + width);
    }
    row += 1;
    const colors = {keep: t.success, adapter: t.accent, add: t.warning} as const;
    for (const [kind, label, text] of plan.ledger) {
      canvas.text(x, row, LEDGER_MARKS[kind][none() ? 1 : 0], `${BOLD}${fg(colors[kind])}`);
      canvas.text(x + 2, row, label, fg(t.subtle));
      canvas.text(x + 20, row++, truncate(text, width - 20), fg(t.primary));
    }
  } else {
    const choice = CHOICES[state.choice];
    canvas.text(x, row++, `Apply ${choice.title}?`, `${BOLD}${fg(t.primary)}`);
    canvas.text(x, row++, `This sets NMSh's look and feel. ${KEEP_NOTE}`, fg(t.secondary), undefined, x + width);
    row += 1;
    const items = REVIEW[state.choice as 0 | 1];
    const half = Math.ceil(items.length / 2);
    items.forEach(([label, value], i) => {
      const cx = x + (i < half ? 0 : Math.floor(width / 2)), cy = row + (i < half ? i : i - half);
      canvas.text(cx, cy, label, fg(t.subtle));
      canvas.text(cx + 12, cy, value, fg(t.primary), undefined, cx + Math.floor(width / 2) - 2);
    });
    row += half;
  }
  const label = state.choice === 3 ? '⏎  Keep my setup' : '⏎  Apply';
  button(canvas, x, row + 2, displayWidth(label) + 6, label, t.accent, t.ink);
  keycap(canvas, x + displayWidth(label) + 9, row + 2, 'esc', 'back');
  return row + 4;
}

/** The real composer, previewing the highlighted choice. Inactive until a choice is applied. */
function liveComposer(canvas: Canvas, state: State, width: number, height: number, env: Env, active: boolean): void {
  const t = tokens();
  const placeholder = active ? '' : 'pick a starting point above';
  if (state.choice === 3 && state.screen !== 'customize') {
    withNeutralChrome(env.config, () => {
      const n = tokens();
      canvas.ansi(0, height - 3, sampleExternalPrompt(), width);
      canvas.text(0, height - 2, GLYPHS.prompt, `${BOLD}${fg(n.accent)}`);
      canvas.text(2, height - 2, placeholder, `${ITALIC}${fg(n.subtle)}`);
      canvas.text(0, height - 1, '─'.repeat(width), fg(n.separator));
    });
    return;
  }
  const config = state.choice === 2 || state.screen === 'customize' ? env.config : configFor(state.choice as Choice, state.layout, env.palette);
  canvas.ansi(0, height - 3, headerRow(config, width), width);
  canvas.text(0, height - 2, GLYPHS.prompt, `${BOLD}${fg(t.accent)}`);
  if (active) canvas.text(2, height - 2, ' ', '', bg(t.accent));
  else canvas.text(2, height - 2, placeholder, `${ITALIC}${fg(t.subtle)}`);
  canvas.text(0, height - 1, '─'.repeat(width), fg(t.separator));
}

function hints(canvas: Canvas, state: State, x: number, y: number, width: number): void {
  const t = tokens();
  if (state.screen === 'confirm') {
    const stay = state.confirmIndex === 0;
    const end = canvas.text(x, y, 'Leave setup?', `${BOLD}${fg(t.primary)}`);
    const text = canvas.text(end + 2, y, 'Nothing changes. /startup reopens this anytime.', fg(t.secondary), undefined, x + width - 22);
    let column = Math.max(text + 3, x + width - 20);
    column = canvas.text(column, y, '  Stay  ', `${BOLD}${fg(stay ? t.ink : t.primary)}`, bg(stay ? t.accent : t.raised)) + 1;
    canvas.text(column, y, '  Leave  ', `${BOLD}${fg(!stay ? t.ink : t.primary)}`, bg(!stay ? t.accent : t.raised));
    return;
  }
  const keys: Array<readonly [string, string, boolean?]> = state.screen === 'pick'
    ? [['←→', 'choose'], ['1–4', 'jump'], ['⏎', 'continue', true], ['esc', 'leave']] : [];
  const label = auroraLabel(state.backdrop);
  const right = x + width - (displayWidth(label) + 4);
  keycaps(canvas, x, y, keys, right - 2);
  if (width >= 64) keycap(canvas, right, y, 'A', label);
}

// ---- Customize Everything: the guided setup opens as NMSh's own bottom panel ----------------

function customizePanel(canvas: Canvas, state: State, width: number, height: number, env: Env, top: number, cardTop: number): void {
  const t = tokens();
  // The card above stays readable but quiet; the banner keeps its pixels (faint would tear the half-blocks).
  canvas.dim(0, cardTop, width, top - cardTop);
  canvas.text(0, top, '─'.repeat(width), fg(t.separator));
  const sections = sectionTitles();
  let column = 2;
  sections.forEach((title, i) => {
    if (column + segmentWidth(` ${title} `) > width - 6) return;
    column = segment(canvas, column, top + 1, ` ${title} `, i === 2 ? t.accent : t.plate, i === 2 ? t.ink : (i < 2 ? t.muted : t.secondary), {bold: i === 2, selected: i === 2}) + 1;
  });
  let y = top + 3;
  canvas.text(2, y, 'Look', `${BOLD}${fg(t.primary)}`);
  canvas.text(8, y, 'theme, text and chrome · step 3 of 16', fg(t.subtle));
  y += 2;
  const theme = LOOK_THEMES[state.customize.theme]!;
  const rows: Array<[string, string]> = [['Theme', theme], ['Theme text', 'On'], ['Surface tint', 'Lavender'], ['Vibrance', 'Standard'], ['UI chrome', 'Follow theme'], ['Chroma', 'Off']];
  rows.forEach(([label, value], i) => {
    const selected = i === state.customize.row;
    if (selected) {
      segment(canvas, 2, y + i, ` ${label}`.padEnd(15), t.accent, t.ink, {bold: true, selected: true, open: false});
      canvas.text(20, y + i, `‹ ${value} ›`, `${BOLD}${fg(t.accent)}`);
    } else {
      canvas.text(3, y + i, label, fg(t.secondary));
      canvas.text(20, y + i, value, fg(t.subtle));
    }
  });
  const px = 44, pw = width - px - 2;
  if (pw >= 30) {
    const preview = {...env.config, nmsh: {...env.config.nmsh, palette: theme}};
    canvas.text(px, y, 'Live preview', fg(t.muted));
    canvas.ansi(px, y + 2, buildThemePreviewLine(preview, theme, pw), pw);
    canvas.text(px, y + 3, GLYPHS.prompt, `${BOLD}${fg(t.accent)}`);
    canvas.text(px + 2, y + 3, 'npm test', fg(t.primary));
    canvas.text(px + 2, y + 4, '✔ 42 passing (1.2s)', fg(t.success));
  }
  keycaps(canvas, 2, height - 1, [['↑↓', 'select'], ['←→', 'change'], ['Tab', 'next step'], ['⏎', 'next', true], ['esc', 'back to the card']], width - 2);
}

// ---- after Apply ---------------------------------------------------------------------------

function receipt(canvas: Canvas, y: number, text: string, env: Env, neutral = false): void {
  const draw = () => {
    const t = tokens();
    canvas.text(1, y, none() ? '+' : '✓', fg(t.success));
    canvas.text(3, y, text, fg(t.secondary));
  };
  if (neutral) withNeutralChrome(env.config, draw); else draw();
}

function welcome(canvas: Canvas, state: State, width: number, height: number, now: number, env: Env): void {
  const t = tokens();
  const elapsed = env.reduced ? 10_000 : now - state.screenAt;
  let y = banner(canvas, state, width, height, now, env, true) + 1;
  command(canvas, y, 'first run');
  receipt(canvas, y + 1, 'Started with NMSh Recommended · /startup changes it anytime', env);
  y += 3;
  const reveal = (i: number) => env.reduced || elapsed > 200 + i * 90;
  if (reveal(0)) {
    canvas.text(1, y, '◆', fg(t.accent));
    canvas.text(3, y, 'You\'re all set. We\'re so glad you\'re here.', `${BOLD}${fg(t.primary)}`);
  }
  if (reveal(1)) canvas.text(3, y + 1, 'Your shell is still yours; NMSh just makes it a nicer place to live.', fg(t.secondary), undefined, width - 2);
  if (reveal(2)) {
    let column = canvas.text(3, y + 3, 'Try', fg(t.subtle)) + 2;
    for (const [key, action] of TIPS) {
      if (column + displayWidth(key) + displayWidth(action) + 6 > width - 2) break;
      column = canvas.text(column, y + 3, ` ${key} `, `${BOLD}${fg(t.accent)}`, bg(t.plate));
      column = canvas.text(column + 1, y + 3, action.split(':')[0]!.replace('anytime', '').trim(), fg(t.secondary)) + 3;
    }
  }
  if (reveal(3)) canvas.text(3, y + 5, 'The aurora above stays in this transcript; /screensaver brings it back anytime.', `${ITALIC}${fg(t.subtle)}`, undefined, width - 2);
  liveComposer(canvas, {...state, choice: 0}, width, height, env, true);
}

// ---- the concept ----------------------------------------------------------------------------

export const firstPrompt: Concept = {
  name: 'First Prompt',
  navigate(state: State, key: Key, now: number): boolean {
    if (state.screen === 'customize') {
      if (key.kind === 'up') state.customize.row = Math.max(0, state.customize.row - 1);
      else if (key.kind === 'down') state.customize.row = Math.min(5, state.customize.row + 1);
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
    if (!env.reduced && (now - state.changedAt < 340 || (state.screen === 'welcome' && now - state.screenAt < 700))) return 40;
    return ['pick', 'review', 'confirm'].includes(state.screen) ? backdropFrameMs(state.backdrop, env) : 0;
  },
  render(state: State, width: number, height: number, now: number, env: Env): string[] {
    const canvas = new Canvas(width, height);
    const t = tokens();
    if (state.screen === 'welcome') { welcome(canvas, state, width, height, now, env); return canvas.rows(); }
    if (state.screen === 'quiet' || state.screen === 'kept' || state.screen === 'left') {
      const neutral = state.screen === 'kept';
      receipt(canvas, 0, state.screen === 'quiet' ? `Minimal Terminal is ready · ${state.layout === 'twoLine' ? 'Two-line' : 'One-line'} · /startup to change`
        : neutral ? 'Keeping your setup: Starship, zsh and your terminal theme · /startup to change' : 'Setup closed. Nothing was applied · /startup reopens it', env, neutral);
      if (state.screen === 'quiet') composerBarFlow(canvas, state, width, env);
      else if (neutral) liveComposer(canvas, state, width, height, env, true);
      else composerBar(canvas, env.config, width, height);
      return canvas.rows();
    }
    // Short terminals give up the banner first; the card and the live composer always fit.
    let y = height >= 26 ? banner(canvas, state, width, height, now, env, false) + 1 : 0;
    const cardTop = y;
    command(canvas, y, state.screen === 'pick' || state.screen === 'confirm' ? 'opened for your first run' : state.screen === 'customize' ? 'the guided tour' : 'reviewing your choice');
    if (height >= 20) canvas.text(3, y + 1, 'How should NMSh feel? Pick a starting point. Nothing changes until you confirm.', fg(t.secondary), undefined, width - 2);
    const reviewing = state.screen === 'review' || (state.screen === 'confirm' && state.confirmFrom === 'review');
    y = chips(canvas, state, 3, y + (height >= 20 ? 3 : 2), width - 6, reviewing) + 1;
    if (state.screen === 'customize') {
      customizePanel(canvas, state, width, height, env, y, cardTop);
      return canvas.rows();
    }
    const room = height - 5 - y;
    if (room >= 3) y = reviewing ? review(canvas, state, 3, y, Math.min(width - 6, 96), env) : detail(canvas, state, 3, y, Math.min(width - 6, 96), env, room);
    hints(canvas, state, 3, Math.min(y + (room >= 8 ? 1 : 0), height - 5), width - 6);
    liveComposer(canvas, state, width, height, env, false);
    return canvas.rows();
  },
};

/** Minimal's composer follows the transcript (Flow), right under the receipt. */
function composerBarFlow(canvas: Canvas, state: State, width: number, env: Env): void {
  composerRows(configFor(1, state.layout, env.palette), width, '').forEach((row, i) => canvas.ansi(0, 2 + i, row, width));
}

void FAINT; void ease;
