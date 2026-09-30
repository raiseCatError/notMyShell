import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCompletions, parseNativeCompletions} from '../src/shell/completion.js';
import {renderCompletion} from '../src/shell/CompletionMenu.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const context = {buffer: 'git ', cwd: '/'};
const values = () => parseNativeCompletions('status -- working tree\nstash -- save changes\nshow -- objects\ncheckout -- branches', context);

test('completion subsequence filtering ranks prefixes first and stays stable with hundreds', () => {
  assert.deepEqual(filterCompletions(values(), 'st').map(item => item.value), ['stash', 'status']);
  assert.deepEqual(filterCompletions(values(), 'sho').map(item => item.value), ['show']);
  assert.deepEqual(filterCompletions(values(), 'ckt').map(item => item.value), ['checkout']);
  assert.deepEqual(filterCompletions(values(), 'zz'), []);
  assert.equal(filterCompletions(Array.from({length: 500}, () => values()[0]!), 'sts').length, 500);
});

test('menu shows descriptions, source groups, safe icons and degrades at narrow widths', () => {
  const item = {...values()[0]!, group: 'Git commands'};
  setIconStyle('safe');
  try {
    const row = stripAnsi(renderCompletion(item, true, 80));
    assert.match(row, /^> /u);
    assert.match(row, /Git commands.*working tree/u);
    assert.doesNotMatch(row, /[\ue000-\uf8ff]/u);
    for (const width of [1, 4, 12, 28, 80]) assert.ok(displayWidth(renderCompletion(item, true, width)) <= width);
    assert.ok(stripAnsi(renderCompletion({...item, description: ''}, false, 80)).includes('status'));
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try { assert.doesNotMatch(renderCompletion(item, true, 80), /\u001b\[(?:38|48);/u); }
    finally { if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous; }
  } finally { setIconStyle('nerd'); }
});

function appForTest(): TerminalApp {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  return app;
}
function cleanup(app: TerminalApp): void { app['stop'](0); app['session'].kill(); }

test('keyboard completion moves selection, Tab inserts and Escape dismisses without execution', () => {
  const app = appForTest();
  const submitted: string[] = [];
  app['session'].submit = ((text: string) => submitted.push(text)) as never;
  try {
    app['editor'].insert('git ');
    app['shellSuggestions'] = values();
    app['handleKey']({kind: 'down'});
    assert.equal(app['selectedSuggestion'], 1);
    app['handleKey']({kind: 'complete'});
    assert.equal(app['editor'].text, 'git stash');
    assert.deepEqual(submitted, []);
    app['shellSuggestions'] = values();
    app['handleKey']({kind: 'escape'});
    assert.deepEqual(app['shellSuggestions'], []);
  } finally { cleanup(app); }
});

test('changed buffer clears old rows immediately and ABA requests cannot repaint', async () => {
  const app = appForTest();
  const pending: Array<(items: ReturnType<typeof values>) => void> = [];
  app['completionService'].suggest = () => new Promise(resolve => pending.push(resolve));
  try {
    app['editor'].insert('git ');
    app['shellSuggestions'] = values();
    const first = app['fetchSuggestions']();
    assert.deepEqual(app['shellSuggestions'], []);
    app['editor'].insert('s');
    const second = app['fetchSuggestions']();
    app['editor'].backspace();
    const third = app['fetchSuggestions']();
    pending[2]!(values()); await third;
    assert.equal(app['shellSuggestions'].length, 4);
    pending[0]!([]); await first;
    pending[1]!(values()); await second;
    assert.equal(app['shellSuggestions'].length, 4);
    app['editor'].clear(); app['editor'].insert('/history ');
    await app['fetchSuggestions']();
    assert.deepEqual(app['shellSuggestions'], []);
  } finally { cleanup(app); }
});
