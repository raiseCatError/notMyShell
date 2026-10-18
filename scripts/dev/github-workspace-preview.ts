/**
 * DEVELOPMENT-ONLY preview of the GitHub workspace (#338). Not part of NMSh
 * startup and not reachable from the composer. It drives the real controller
 * and renderer on the alternate screen, then restores the terminal on exit.
 *
 *   npx tsx scripts/dev/github-workspace-preview.ts                 # fixtures, offline
 *   npx tsx scripts/dev/github-workspace-preview.ts --scenario=auth # fixture error states
 *   npx tsx scripts/dev/github-workspace-preview.ts --live --repo=raiseCatError/notMyShell
 *   npx tsx scripts/dev/github-workspace-preview.ts --static --width=40 --keys=down,enter,tab
 *
 * Live mode is read-only: it uses the user's authenticated `gh` for GraphQL
 * queries and GET requests only. Nothing is merged, opened or executed:
 * intents (open on GitHub, open worktree) are only displayed.
 *
 * Preview-only keys: Ctrl-E next fixture scenario, Ctrl-G Safe/Nerd glyphs,
 * Ctrl-K color on/off, Ctrl-W simulated width (30/40/50/80/120/200/terminal),
 * Ctrl-C quit.
 */
import {colorLevel, type ColorLevel} from '../../src/presentation/capabilities.js';
import {GithubWorkspaceController, type WorkspaceIntent, type WorkspaceKey} from '../../src/githubWorkspace/controller.js';
import {FIXTURE_NOW, FIXTURE_REPOSITORY, FIXTURE_SCENARIOS, type FixtureScenario, FixtureSource} from '../../src/githubWorkspace/fixtures.js';
import {attachRenderer, renderWorkspace, type RenderOptions} from '../../src/githubWorkspace/render.js';
import {parseRepository} from '../../src/githubWorkspace/sanitize.js';
import {GithubWorkspaceService} from '../../src/githubWorkspace/service.js';
import {GhSource, type GithubSource} from '../../src/githubWorkspace/source.js';
import {displayWidth} from '../../src/util/text.js';

interface Args { live: boolean; repo?: string; scenario: FixtureScenario; static: boolean; width?: number; height?: number; keys: string[]; safe: boolean; noColor: boolean }

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {live: false, scenario: 'ok', static: false, keys: [], safe: process.env.NMSH_ICONS === 'safe', noColor: false};
  for (const arg of argv) {
    const [name, value] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, ''];
    switch (name) {
      case '--live': args.live = true; break;
      case '--repo': args.repo = value; break;
      case '--scenario':
        if (!FIXTURE_SCENARIOS.includes(value as FixtureScenario)) fail(`Unknown scenario. Choose one of: ${FIXTURE_SCENARIOS.join(', ')}`);
        args.scenario = value as FixtureScenario; break;
      case '--static': args.static = true; break;
      case '--width': args.width = positive(value, '--width'); break;
      case '--height': args.height = positive(value, '--height'); break;
      case '--keys': args.keys = value.split(',').filter(Boolean); break;
      case '--safe': args.safe = true; break;
      case '--no-color': args.noColor = true; break;
      case '--help': case '-h': process.stdout.write(`${HELP}\n`); process.exit(0); break;
      default: fail(`Unknown argument: ${arg}\n${HELP}`);
    }
  }
  if (args.live && !args.repo) fail('--live requires --repo=owner/name');
  return args;
}

const HELP = `GitHub workspace development preview (no NMSh startup, never mutates GitHub)
  --scenario=${FIXTURE_SCENARIOS.join('|')}   fixture data/error scenario (default ok)
  --live --repo=owner/name   read-only live data through your authenticated gh
  --static [--keys=k1,k2] [--width=N] [--height=N]   print frames instead of an interactive session
  --safe   Safe (ASCII) glyphs      --no-color   no SGR (NO_COLOR is honored too)
  keys for --keys: up down pgup pgdn home end enter esc tab stab bs or a literal character, e.g. /,r`;

function fail(message: string): never { process.stderr.write(`${message}\n`); process.exit(2); }
function positive(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 10 || n > 500) fail(`${name} must be an integer between 10 and 500`);
  return n;
}

const NAMED_KEYS: Record<string, WorkspaceKey> = {up: 'up', down: 'down', pgup: 'pageUp', pgdn: 'pageDown', home: 'home', end: 'end',
  enter: 'enter', esc: 'escape', tab: 'tab', stab: 'shiftTab', bs: 'backspace', space: {char: ' '}, comma: {char: ','}};

function build(args: Args, scenario: FixtureScenario): {controller: GithubWorkspaceController; source: GithubSource} {
  let source: GithubSource;
  let repo = FIXTURE_REPOSITORY;
  if (args.live) {
    const parsed = parseRepository(args.repo ?? '');
    if (!parsed) fail('Repository must look like owner/name');
    repo = `${parsed.owner}/${parsed.repo}`;
    source = new GhSource();
  } else source = new FixtureSource({scenario, now: args.static ? undefined : Date.now});
  const controller = new GithubWorkspaceController(new GithubWorkspaceService(source), {
    title: `${repo}${args.live ? ' (live, read-only)' : ` (fixtures: ${scenario})`}`,
    clock: args.static && !args.live ? () => FIXTURE_NOW : Date.now,
    initialQueries: {prs: `repo:${repo} is:open`, issues: `repo:${repo} is:open`, search: `repo:${repo}`},
  });
  return {controller, source};
}

function describeIntent(intent: WorkspaceIntent): string {
  switch (intent.type) {
    case 'OpenExternal': return `Intent (not executed in preview): open ${intent.url}`;
    case 'OpenExternalReview': return `Intent (not executed): review ${intent.repository}#${intent.number} at ${intent.url}`;
    case 'OpenRelatedWorktree': return `Intent (not executed): worktree for ${intent.repository}#${intent.number} ${intent.headRef ?? '?'} @ ${intent.headSha?.slice(0, 12) ?? '?'}; worktree state unknown until #337`;
    case 'Exit': return 'Exit';
  }
}

function busy(controller: GithubWorkspaceController): boolean {
  const state = controller.snapshot;
  const list = state.lists[state.tab];
  const detail = state.detail;
  return list.status === 'loading' || list.refreshing || list.loadingMore
    || !!detail && (detail.status === 'loading' || detail.refreshing || detail.diff.status === 'loading');
}

/** Static frames wait for in-flight requests (bounded) so live data has arrived before printing. */
async function settle(controller: GithubWorkspaceController): Promise<void> {
  const deadline = Date.now() + 30_000;
  do {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (busy(controller) && Date.now() < deadline);
}

async function runStatic(args: Args): Promise<void> {
  const columns = args.width ?? 80;
  const rows = args.height ?? 24;
  const options = (): RenderOptions => ({columns, rows, glyphs: args.safe ? 'safe' : 'nerd', color: args.noColor ? 'none' : 'none', now: controller.now()});
  const {controller} = build(args, args.scenario);
  controller.setViewport(columns, rows);
  attachRenderer(controller, options);
  const frame = (label: string) => {
    const border = '+'.padEnd(columns + 1, '-') + '+';
    process.stdout.write(`${label}\n${border}\n`);
    for (const line of renderWorkspace(controller.snapshot, controller.availableActions(), options())) {
      process.stdout.write(`|${line}${' '.repeat(Math.max(0, columns - displayWidth(line)))}|\n`);
    }
    process.stdout.write(`${border}\n`);
  };
  await controller.submitQuery('prs');
  await settle(controller);
  frame('initial');
  for (const name of args.keys) {
    const key = NAMED_KEYS[name] ?? (name.length === 1 ? {char: name} : undefined);
    if (!key) fail(`Unknown key: ${name}`);
    const intent = controller.handleKey(key);
    if (intent && intent.type !== 'Exit') controller.notify(describeIntent(intent));
    await settle(controller);
    frame(`after ${name}`);
  }
}

function decode(chunk: string): Array<WorkspaceKey | 'quit' | 'scenario' | 'glyphs' | 'color' | 'width'> {
  const keys: Array<WorkspaceKey | 'quit' | 'scenario' | 'glyphs' | 'color' | 'width'> = [];
  const sequences: Array<[string, WorkspaceKey]> = [['\u001b[A', 'up'], ['\u001b[B', 'down'], ['\u001bOA', 'up'], ['\u001bOB', 'down'],
    ['\u001b[5~', 'pageUp'], ['\u001b[6~', 'pageDown'], ['\u001b[H', 'home'], ['\u001b[F', 'end'], ['\u001b[1~', 'home'], ['\u001b[4~', 'end'],
    ['\u001b[Z', 'shiftTab']];
  let i = 0;
  while (i < chunk.length) {
    const rest = chunk.slice(i);
    const match = sequences.find(([sequence]) => rest.startsWith(sequence));
    if (match) { keys.push(match[1]); i += match[0].length; continue; }
    if (rest[0] === '\u001b') {
      // Unknown CSI/SS3 sequences are ignored whole; a lone ESC is Escape.
      const csi = /^\u001b(?:\[[0-?]*[ -/]*[@-~]|O.)/u.exec(rest);
      if (csi) { i += csi[0].length; continue; }
      keys.push('escape'); i++; continue;
    }
    const ch = String.fromCodePoint(rest.codePointAt(0)!);
    i += ch.length;
    switch (ch) {
      case '\u0003': keys.push('quit'); break;
      case '\u0005': keys.push('scenario'); break;
      case '\u0007': keys.push('glyphs'); break;
      case '\u000b': keys.push('color'); break;
      case '\u0017': keys.push('width'); break;
      case '\r': case '\n': keys.push('enter'); break;
      case '\t': keys.push('tab'); break;
      case '\u007f': case '\b': keys.push('backspace'); break;
      default: if (ch >= ' ') keys.push({char: ch});
    }
  }
  return keys;
}

async function runInteractive(args: Args): Promise<void> {
  const {stdin, stdout} = process;
  if (!stdin.isTTY || !stdout.isTTY) fail('Interactive preview needs a terminal. Use --static to print frames.');
  let scenario = args.scenario;
  let glyphs: RenderOptions['glyphs'] = args.safe ? 'safe' : 'nerd';
  const detected: ColorLevel = args.noColor ? 'none' : colorLevel();
  let color = detected;
  const widths = [30, 40, 50, 80, 120, 200, 0];
  let widthIndex = args.width ? -1 : widths.length - 1;
  let {controller} = build(args, scenario);

  const size = () => {
    const actual = stdout.columns || 80;
    const simulated = widthIndex === -1 ? args.width! : widths[widthIndex];
    return {columns: simulated ? Math.min(simulated, actual) : actual, rows: args.height ? Math.min(args.height, stdout.rows || 24) : stdout.rows || 24};
  };
  const options = (): RenderOptions => ({...size(), glyphs, color, now: controller.now()});
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    const {columns, rows} = size();
    controller.setViewport(columns, rows);
    const lines = renderWorkspace(controller.snapshot, controller.availableActions(), options());
    stdout.write(`\u001b[H${lines.map(line => `${line}\u001b[0m\u001b[K`).join('\r\n')}\u001b[J`);
  };
  const schedule = () => { if (!scheduled) { scheduled = true; setImmediate(paint); } };
  const wire = () => { attachRenderer(controller, options); controller.onChange(schedule); };

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try { stdin.setRawMode(false); } catch { /* already closed */ }
    stdout.write('\u001b[0m\u001b[?25h\u001b[?1049l');
  };
  process.on('exit', restore);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { restore(); process.exit(130); });
  process.on('uncaughtException', error => { restore(); process.stderr.write(`${error.stack ?? error}\n`); process.exit(1); });

  stdout.write('\u001b[?1049h\u001b[?25l\u001b[2J');
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdout.on('resize', schedule);
  wire();
  schedule();
  void controller.submitQuery('prs');

  await new Promise<void>(resolve => {
    stdin.on('data', (chunk: string) => {
      for (const key of decode(chunk)) {
        if (key === 'quit') { resolve(); return; }
        if (key === 'scenario') {
          if (args.live) { controller.notify('Scenarios apply to fixture mode only'); continue; }
          scenario = FIXTURE_SCENARIOS[(FIXTURE_SCENARIOS.indexOf(scenario) + 1) % FIXTURE_SCENARIOS.length];
          ({controller} = build(args, scenario));
          wire();
          void controller.submitQuery('prs');
          controller.notify(`Fixture scenario: ${scenario}`);
          continue;
        }
        if (key === 'glyphs') { glyphs = glyphs === 'nerd' ? 'safe' : 'nerd'; controller.notify(`Glyphs: ${glyphs}`); continue; }
        if (key === 'color') { color = color === 'none' ? (detected === 'none' ? 'ansi16' : detected) : 'none'; controller.notify(`Color: ${color}`); continue; }
        if (key === 'width') {
          widthIndex = (widthIndex + 1) % widths.length;
          stdout.write('\u001b[2J');
          controller.notify(`Width: ${widths[widthIndex] || 'terminal'}`);
          continue;
        }
        const intent = controller.handleKey(key);
        if (intent?.type === 'Exit') { resolve(); return; }
        if (intent) controller.notify(describeIntent(intent));
      }
    });
  });
  restore();
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
await (args.static ? runStatic(args) : runInteractive(args));
