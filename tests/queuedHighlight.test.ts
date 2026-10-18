import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

/** A semantic service that classifies on request, as the real one does, without starting a shell. */
function classifyingApp() {
  const app = new TerminalApp();
  app['render'] = () => {};
  const semantic = app['semanticService'];
  semantic.cache.clear();
  semantic.classifyCommand = async (word: string) => { semantic.cache.set(word.split(' ')[0]!, 'executable'); return 'executable' as const; };
  return app;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
type Cell = {text: string; style: string};
const cells = (app: TerminalApp, startId: number): Cell[] => app['output'].transcript().lines[startId] as Cell[];
const text = (line: Cell[]) => line.map(cell => cell.text).join('');
/** The style of the first cell of `word` in a stored command line. */
const styleOf = (line: Cell[], word: string) => line[text(line).indexOf(word)]!.style;

test('a queued command is highlighted like a composer command: its command word is classified and the stored line recolored', async () => {
  const isolation = isolateConfig();
  const app = classifyingApp();
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
  const app = classifyingApp();
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
