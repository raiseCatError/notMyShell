import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {SuggestionController} from '../src/suggestions/SuggestionController.js';
import {NativeSuggestions} from '../src/suggestions/NativeSuggestions.js';
import {historyIgnorePattern, isPrivateCommand, type Suggestion, type SuggestionContext, type SuggestionProvider} from '../src/suggestions/types.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

const context = (buffer: string): SuggestionContext => ({buffer, cwd: '/tmp', previous: [], now: 0});
const provider = (id: 'nmsh' | 'deja', query: SuggestionProvider['query']): SuggestionProvider => ({id, query});
const list = (...texts: string[]): Suggestion[] => texts.map((text, index) => ({text, source: 'nmsh', score: -index}));

test('ghost text extends the buffer; alternatives cycle and accept the highlighted line', () => {
  const controller = new SuggestionController(() => {});
  controller.setProvider(provider('nmsh', () => list('git status', 'git stash', 'gist st')));
  controller.update(context('git st'));
  assert.equal(controller.ghost('git st'), 'git status');
  assert.equal(controller.nextWord('git s'), undefined, 'stale buffers never show a ghost');
  assert.equal(controller.alternatives().items.length, 0);
  assert.ok(controller.cycle(1));
  assert.deepEqual(controller.alternatives().items.map(item => item.text), ['git status', 'git stash', 'gist st']);
  controller.cycle(1);
  controller.cycle(1);
  assert.equal(controller.ghost('git st'), undefined, 'a fuzzy alternative is listed, not drawn as a suffix');
  assert.equal(controller.acceptance('git st'), 'gist st');
  controller.cycle(-1);
  assert.equal(controller.ghost('git st'), 'git stash');
});

test('next word, dismissal until the buffer changes, and no suggestion on empty or multi-line input', () => {
  const controller = new SuggestionController(() => {});
  controller.setProvider(provider('nmsh', ({buffer}) => buffer ? list('one two') : list('npm test')));
  controller.update(context('o'));
  assert.equal(controller.nextWord('o'), 'ne');
  controller.update(context('one'));
  assert.equal(controller.nextWord('one'), ' two');
  assert.ok(controller.dismiss('one'));
  assert.equal(controller.ghost('one'), undefined);
  controller.update(context('one'));
  assert.equal(controller.ghost('one'), undefined, 'still dismissed for the same buffer');
  controller.update(context('one '));
  assert.equal(controller.ghost('one '), 'one two');
  controller.update(context(''));
  assert.equal(controller.ghost(''), undefined, 'empty prompt prediction is opt-in');
  controller.update(context(''), true);
  assert.equal(controller.ghost(''), 'npm test');
  controller.update(context('a\nb'));
  assert.equal(controller.ghost('a\nb'), undefined);
});

test('stale async results are discarded; budget misses are skipped; failures fall back to Native', async () => {
  let changes = 0;
  const unhealthy: string[] = [];
  const controller = new SuggestionController(() => { changes += 1; }, reason => unhealthy.push(reason), 30);
  const native = provider('nmsh', ({buffer}) => list(`${buffer} --native`));
  let resolveSlow!: (value: Suggestion[]) => void;
  controller.setProvider(provider('deja', ({buffer}) => buffer === 'slow'
    ? new Promise(resolve => { resolveSlow = resolve; })
    : buffer === 'hang' ? new Promise(() => {}) : Promise.resolve(list(`${buffer} --deja`))), native);
  controller.update(context('slow'));
  controller.update(context('fast'));
  resolveSlow(list('slow --late'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(controller.ghost('fast'), 'fast --deja');
  assert.equal(changes, 1, 'the stale result never triggered a render');

  controller.update(context('hang'));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(controller.ghost('hang'), undefined, 'a provider past the budget is skipped for this keystroke');

  controller.setProvider(provider('deja', () => Promise.reject(new Error('socket closed'))), native);
  for (const buffer of ['a', 'b', 'c']) {
    controller.update(context(buffer));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(controller.ghost(buffer), `${buffer} --native`, 'each failure shows Native for that keystroke');
  }
  assert.deepEqual(unhealthy, ['socket closed']);
  assert.equal(controller.providerId, 'nmsh');
});

test('privacy: leading space and HISTORY_IGNORE are never suggested or learned', () => {
  const ignore = historyIgnorePattern('(ls|cd *|export *TOKEN*)');
  assert.ok(ignore);
  assert.ok(isPrivateCommand(' secret-command', ignore));
  assert.ok(isPrivateCommand('cd /private', ignore));
  assert.ok(isPrivateCommand('export API_TOKEN=x', ignore));
  assert.ok(!isPrivateCommand('lsof', ignore));
  assert.equal(historyIgnorePattern('(unbalanced'), undefined);
  const native = new NativeSuggestions(() => ['cd /private/place', 'cat notes'], ignore);
  native.record({command: ' cat secret'});
  native.record({command: 'cat readme'});
  assert.deepEqual(native.query(context('c')).map(item => item.text), ['cat readme', 'cat notes']);
});

test('keys: Ctrl+N/Ctrl+P (legacy and Kitty) cycle alternatives; config defaults to Native', () => {
  assert.deepEqual(decodeKeys('\u000E\u0010\u001B[110;5u\u001B[112;5u').map(key => key.kind),
    ['suggestNext', 'suggestPrevious', 'suggestNext', 'suggestPrevious']);
  assert.equal(normalizePromptConfiguration({}).suggestions, 'nmsh');
  assert.equal(normalizePromptConfiguration({suggestions: 'none'}).suggestions, 'none');
  assert.equal(normalizePromptConfiguration({suggestions: 'zsh-autosuggest'}).suggestions, 'nmsh');
});

test('composer: accept full, accept next word, alternatives and Escape never execute anything', () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  try {
    app['suggestions'].setProvider(provider('nmsh', ({buffer}) => buffer.startsWith('git')
      ? list('git status --short', 'git stash') : []));
    const type = (text: string) => { for (const key of decodeKeys(text)) { app['handleKey'](key); app['editor'].ghost = app['suggestionGhost'](); } };
    type('git st');
    assert.equal(app['suggestionGhost'](), 'git status --short');
    type('\u001B[1;3C');
    assert.equal(app['editor'].text, 'git status');
    type('\u001B[C');
    assert.equal(app['editor'].text, 'git status --short');
    app['editor'].clear();
    type('git st\u000E\u000E');
    assert.deepEqual(app['composerSuggestions']().map((item: {name: string}) => item.name), ['git status --short', 'git stash']);
    type('\r');
    assert.equal(app['editor'].text, 'git stash', 'Enter accepts the alternative into the editor');
    assert.equal(app['running'], undefined, 'nothing was executed');
    type('\u001B[27u');
    assert.equal(app['editor'].ghost, undefined, 'Escape dismisses the ghost for this buffer');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
