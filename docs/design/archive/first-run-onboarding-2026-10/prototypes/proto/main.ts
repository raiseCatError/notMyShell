/**
 * Onboarding design prototypes. Interactive in a real terminal (Ghostty), or one
 * deterministic frame with --frame for captures. Writes no configuration.
 *
 *   --concept horizon|stage|prompt   --backdrop off|subtle|aurora   --theme lavender|ocean|…
 *   --screen pick|review|confirm|customize|welcome|quiet|kept|left   --choice 1-4   --layout twoLine|oneLine
 *   --reduced   --safe   --nocolor   --frame --cols N --rows N --time MS   --freeze MS   --confirm stay|leave
 *   --case starship|multi|custom   (Keep Existing evidence variants)
 *
 * Keys: the concept's own navigation · 1–4 · Enter · Esc · A backdrop · q quit
 * Prototype-only keys: T next theme · R toggle Reduced Motion
 */
import {applyTheme, RESET, type Backdrop, type Choice, type Concept, type Env, type Layout, type Screen, type State} from './kit.js';
import {horizon} from './horizon.js';
import {KeyDecoder, presentationClock, resolveHostCapabilities, TerminalRenderer, type Key, type NativePaletteId} from './src.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback?: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : fallback; };

if (flag('nocolor')) process.env.NMSH_COLOR = 'none';
else if (flag('frame') || flag('truecolor')) process.env.NMSH_COLOR = 'truecolor';
if (flag('safe')) process.env.NMSH_ICONS = 'safe';

const loaded: Record<string, () => Promise<Concept>> = {
  horizon: async () => horizon,
  sky: async () => (await import('./skylab.js')).skylab,
  stage: async () => (await import('./stage.js')).stage,
  prompt: async () => (await import('./firstprompt.js')).firstPrompt,
};
const conceptName = option('concept', 'horizon')!;
const concept = await (loaded[conceptName] ?? loaded.horizon!)();

const THEMES: readonly NativePaletteId[] = ['lavender', 'aurora', 'ocean', 'sunset', 'forest', 'rose', 'grayscale'];
let themeIndex = Math.max(0, THEMES.indexOf((option('theme', 'lavender') as NativePaletteId)));
const env: Env = {reduced: flag('reduced'), palette: THEMES[themeIndex]!, config: applyTheme(THEMES[themeIndex]!),
  keepCase: option('case', 'starship') as Env['keepCase'], reactive: flag('reactive')};

const START = Date.now();
const frozen = option('freeze') !== undefined ? START + Number(option('freeze')) : undefined;
const clock = () => frozen ?? Date.now();

const state: State = {
  screen: (option('screen', 'pick') as Screen),
  choice: (Math.max(0, Math.min(3, Number(option('choice', '1')) - 1)) as Choice),
  layout: (option('layout', 'twoLine') as Layout),
  backdrop: (option('backdrop', 'aurora') as Backdrop),
  confirmIndex: option('confirm') === 'leave' ? 1 : 0,
  confirmFrom: (option('from', 'pick') as Screen),
  changedAt: -1e9,
  previousChoice: 0,
  screenAt: START,
  previousScreen: 'pick',
  customize: {row: Number(option('row', '0')), theme: Number(option('look', '0'))},
};

if (flag('frame')) {
  const columns = Number(option('cols', '100')), rows = Number(option('rows', '32'));
  const now = START + Number(option('time', '6000'));
  process.stdout.write(`${concept.render(state, columns, rows, now, env).join('\r\n')}${RESET}\r\n`);
  process.exit(0);
}

// ---- interactive ---------------------------------------------------------------------

const renderer = new TerminalRenderer(data => process.stdout.write(data), resolveHostCapabilities());
const decoder = new KeyDecoder();
let unsubscribe: (() => void) | undefined;
let interval = 0;

const size = () => ({columns: process.stdout.columns || 100, rows: process.stdout.rows || 32});

function paint(): void {
  const {columns, rows} = size();
  const now = clock();
  renderer.render({rows: concept.render(state, columns, rows, now, env), columns, cursorRow: rows, cursorColumn: 1, cursorVisible: false});
  const next = frozen ? 0 : concept.frameMs(state, now, env);
  if (next !== interval) {
    unsubscribe?.(); unsubscribe = undefined; interval = next;
    if (next > 0) unsubscribe = presentationClock.subscribe(() => paint(), next, Math.min(40, next));
  }
}

function go(screen: Screen): void {
  state.previousScreen = state.screen;
  state.screen = screen;
  state.screenAt = clock();
}

function quit(): void {
  unsubscribe?.();
  renderer.leave();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

function handle(key: Key): void {
  const now = clock();
  if (key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return quit();
  if (key.kind === 'text' && (key.value === 'a' || key.value === 'A')) {
    state.backdrop = state.backdrop === 'aurora' ? 'off' : state.backdrop === 'off' ? 'subtle' : 'aurora';
    return paint();
  }
  if (key.kind === 'text' && key.value === 'T') {
    themeIndex = (themeIndex + 1) % THEMES.length;
    env.palette = THEMES[themeIndex]!; env.config = applyTheme(env.palette);
    return paint();
  }
  if (key.kind === 'text' && key.value === 'R') { env.reduced = !env.reduced; return paint(); }
  if (concept.navigate(state, key, now)) return paint();
  switch (state.screen) {
    case 'pick':
      if (key.kind === 'text' && /^[1-4]$/u.test(key.value)) {
        state.previousChoice = state.choice; state.choice = (Number(key.value) - 1) as Choice; state.changedAt = now;
      } else if (key.kind === 'enter') go(state.choice === 2 ? 'customize' : 'review');
      else if (key.kind === 'escape') { state.confirmFrom = 'pick'; state.confirmIndex = 0; go('confirm'); }
      break;
    case 'review':
      if (key.kind === 'enter') go(state.choice === 0 ? 'welcome' : state.choice === 1 ? 'quiet' : 'kept');
      else if (key.kind === 'escape') go('pick');
      break;
    case 'confirm':
      if (key.kind === 'left' || key.kind === 'right' || key.kind === 'complete' || key.kind === 'focusPrevious') state.confirmIndex = state.confirmIndex ? 0 : 1;
      else if (key.kind === 'enter') go(state.confirmIndex === 1 ? 'left' : state.confirmFrom);
      else if (key.kind === 'escape') go(state.confirmFrom);
      break;
    case 'customize':
      if (key.kind === 'escape') go('pick');
      break;
    default:
      if (key.kind === 'enter' || key.kind === 'escape') go('pick');
  }
  paint();
}

renderer.enter();
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  for (const key of decoder.push(chunk)) handle(key);
  if (decoder.pendingEscape) setTimeout(() => { for (const key of decoder.flush()) handle(key); }, 30);
});
process.stdout.on('resize', () => { renderer.invalidate(); paint(); });
process.on('SIGTERM', quit);
paint();
