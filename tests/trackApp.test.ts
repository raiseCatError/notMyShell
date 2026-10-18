import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

async function until(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const stored = (app: TerminalApp) => (app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
  .map(line => line.map(cell => cell?.text ?? ' ').join('').trimEnd());
const live = (app: TerminalApp) => app['output'].wrapped(100).filter((row: {derived?: boolean}) => row.derived).map((row: {plain: string}) => row.plain.trim());

test('/track in the app: one block whose live result refreshes in place; /track stop leaves the last result once; /watch keeps its manager', {timeout: 60_000}, async () => {
  const isolation = isolateConfig();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-trackapp-')));
  const app = new TerminalApp();
  app['render'] = () => {};
  try {
    await once(app['session'], 'prompt');
    app['shellCwd'] = root;
    writeFileSync(join(root, 'value.txt'), 'one\n');
    app['handleWatch']('/track --every 2s -- cat value.txt', 'start', '--every 2s -- cat value.txt', true);
    assert.equal(app['watchPanel'], undefined, '/track shows its result in the transcript, not the manager');
    await until(() => live(app).includes('one'), 'the first result');
    const linesAfterFirst = stored(app).length;
    assert.match(stored(app).join('\n'), /\/track --every 2s -- cat value\.txt\n.*Tracking cat value\.txt here with sh -c/u);
    writeFileSync(join(root, 'value.txt'), 'two\n');
    await until(() => live(app).includes('two'), 'the refreshed result', 10_000);
    assert.equal(live(app).includes('one'), false, 'replaced, not appended');
    assert.equal(stored(app).length, linesAfterFirst, 'refreshes add no transcript lines');
    app['handleWatch']('/track refresh', 'now', '', true);
    app['handleWatch']('/track refresh', 'now', '', true);
    assert.match(stored(app).join('\n'), /still being produced; no second one was started/u, 'a refresh while one runs is refused, never overlapped');
    await until(() => !app['watches'].sampling(app['watches'].active()[0]!.id), 'the refresh to finish');
    app['handleWatch']('/track stop', 'stop', '', true);
    await until(() => stored(app).some(line => line.includes('Stopped · last result')), 'the final result');
    const text = stored(app).join('\n');
    assert.match(text, /Stopped · last result \d\d:\d\d:\d\d · exit 0 · \d+ runs?\n\s*two/u);
    assert.equal(text.split('Stopped · last result').length, 2, 'written once');
    assert.match(live(app)[0] ?? '', /^■ stopped/u, 'the live rows end with the stopped state');

    app['handleWatch']('/watch ls', 'start', 'ls', false);
    assert.ok(app['watchPanel'], '/watch opens its manager as before');
    app['watchPanel'] = undefined;
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); rmSync(root, {recursive: true, force: true}); }
});
