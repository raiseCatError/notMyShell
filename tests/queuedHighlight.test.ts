import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

/**
 * A semantic service that classifies on request, as the real one does. The app's real shell reports its startup
 * knowledge first: that replaces the classification cache, so it must land before the test's own classifications
 * rather than in the middle of them (#408). Every lookup the app starts is recorded, so a test waits for exactly
 * those (and the recoloring chained on them) instead of guessing at event-loop turns.
 */
async function classifyingApp() {
  const app = await readyApp();
  const semantic = app['semanticService'];
  semantic.cache.clear();
  const lookups: Promise<unknown>[] = [];
  semantic.classifyCommand = (word: string) => {
    const lookup = (async () => { semantic.cache.set(word.split(' ')[0]!, 'executable'); return 'executable' as const; })();
    lookups.push(lookup);
    return lookup;
  };
  // The recoloring callbacks were attached to each lookup before this waits on them, so they have run when it resolves.
  const settle = async () => { await Promise.all(lookups); };
  return {app, settle};
}

/** An app whose real shell has reported its startup knowledge. */
async function readyApp(): Promise<TerminalApp> {
  const app = new TerminalApp();
  app['render'] = () => {};
  try { await once(app['session'], 'prompt', {signal: AbortSignal.timeout(20_000)}); }
  catch (error) { app['stop'](0); app['session'].kill(); throw error; }
  return app;
}

async function until(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
type Cell = {text: string; style: string};
const cells = (app: TerminalApp, startId: number): Cell[] => app['output'].transcript().lines[startId] as Cell[];
const text = (line: Cell[]) => line.map(cell => cell.text).join('');
/** The style of the first cell of `word` in a stored command line. */
const styleOf = (line: Cell[], word: string) => line[text(line).indexOf(word)]!.style;

test('a queued command is highlighted like a composer command: its command word is classified and the stored line recolored', async () => {
  const isolation = isolateConfig();
  const {app, settle} = await classifyingApp();
  try {
    const sgr = app['syntaxSgr'];
    // The queue runs an entry the composer never saw, so its command word is not classified yet.
    app['onShellExec']('{ npm test --watch\n}', Date.now(), undefined, 'npm test --watch');
    const startId = app['output'].activeStartId!;
    const before = cells(app, startId);
    assert.equal(styleOf(before, 'npm'), sgr.Command, 'unclassified at first: the plain command color');
    await settle();
    const after = cells(app, startId);
    assert.equal(text(after), text(before), 'the command text itself is unchanged');
    assert.equal(styleOf(after, 'npm'), sgr.KnownCommand, 'recolored as a known command once classified, as the composer does');
    assert.equal(styleOf(after, '--watch'), sgr.Flag, 'and the rest keeps its syntax colors');
    const rows = app['output'].wrapped(100).filter((row: {plain: string}) => row.plain.includes('npm test'));
    assert.equal(rows.length, 1, 'one command row, no duplicate');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('a command the composer submitted and a queued one end with the same colors', async () => {
  const isolation = isolateConfig();
  const {app, settle} = await classifyingApp();
  try {
    app['onShellExec']('cargo build --release', Date.now(), undefined, 'cargo build --release');
    const queuedId = app['output'].activeStartId!;
    await settle();
    // The composer's formatting of the same text, now that the word is classified.
    const composer = app['formatCommandAnsi']('cargo build --release', null)[0]!;
    const queued = cells(app, queuedId);
    assert.ok(composer.includes(`${app['syntaxSgr'].KnownCommand}c`), 'the composer path colors the command word as known');
    assert.equal(styleOf(queued, 'cargo'), app['syntaxSgr'].KnownCommand, 'and so does the queued block');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('a stored command whose classification newer shell knowledge superseded still ends classified (#408)', {skip: process.platform === 'win32'}, async () => {
  const isolation = isolateConfig();
  const app = await readyApp();
  try {
    const sgr = app['syntaxSgr'];
    app['semanticService'].cache.clear();
    // A fast queue: the entry starts, and the previous entry's prompt knowledge lands while its lookup is in flight.
    app['onShellExec']('ls -la', Date.now(), undefined, 'ls -la');
    const startId = app['output'].activeStartId!;
    assert.equal(styleOf(cells(app, startId), 'ls'), sgr.Command, 'unclassified at first');
    app['semanticService'].applyShellKnowledge('complete\n');
    await until(() => styleOf(cells(app, startId), 'ls') === sgr.KnownCommand, 'the stored line to be recolored from the new knowledge');
    assert.equal(styleOf(cells(app, startId), '-la'), sgr.Flag);
    assert.ok(app['formatCommandAnsi']('ls -la', null)[0]!.includes(`${sgr.KnownCommand}l`), 'the composer path agrees');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
