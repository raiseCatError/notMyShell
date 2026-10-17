import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {renderUpdateNotice, updateNoticeText} from '../src/output/UpdateNotice.js';
import {stripAnsi} from '../src/util/text.js';

const facts = {installed: '0.20.0', available: '0.21.0', summary: ['Faster startup.', 'A new tools flow.', 'A third line.'], url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.21.0'};
const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; run(); }
  finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};

test('the update notice: both versions, short notes, and the way to update this installation, never guessed', () => {
  const homebrew = updateNoticeText({...facts, provenance: 'homebrew'});
  assert.equal(homebrew.headline, 'NMSh 0.21.0 is available');
  assert.equal(homebrew.lines[0], 'You have 0.20.0.');
  assert.deepEqual(homebrew.lines.slice(1, 3), ['Faster startup.', 'A new tools flow.'], 'at most two lines of notes');
  assert.ok(homebrew.lines.includes('Update with Homebrew: brew update && brew upgrade nmsh'));
  const checkout = updateNoticeText({...facts, provenance: 'checkout'});
  assert.ok(checkout.lines.some(line => /\/update to review the update, then \/update apply/u.test(line)));
  assert.ok(!checkout.lines.some(line => /brew/u.test(line)));
  const manual = updateNoticeText({...facts, provenance: 'manual'});
  assert.ok(manual.lines.some(line => /from the release page/u.test(line)));
  assert.equal(manual.lines.at(-1), facts.url);
  for (const notice of [homebrew, checkout, manual]) {
    assert.ok(!notice.lines.some(line => /curl|sudo|\| *sh/u.test(line)), 'no installer script is offered');
    assert.ok(notice.lines.every(line => !line.includes('—')), 'plain short lines');
  }
  const ready = updateNoticeText({...facts, provenance: 'manual', ready: true});
  assert.equal(ready.headline, 'NMSh 0.21.0 is ready');
  assert.match(ready.lines.join(' '), /Restart NMSh to use the new version/u);
});

test('the notice has a subtle amber accent in color, and is plain under NO_COLOR and Safe glyphs', () => {
  withEnv({NO_COLOR: undefined, NMSH_COLOR: 'truecolor', NMSH_ICONS: undefined}, () => {
    const rows = renderUpdateNotice({...facts, provenance: 'homebrew'});
    assert.ok(rows[2]!.includes('\u001b[38;2;224;176;72m'), 'the headline in amber');
    assert.match(stripAnsi(rows[1]!), /^ {2}▁{24}$/u, 'a short amber rule');
  });
  withEnv({NO_COLOR: '1', NMSH_COLOR: undefined, NMSH_ICONS: 'safe'}, () => {
    const rows = renderUpdateNotice({...facts, provenance: 'homebrew'});
    assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)), 'no color escapes');
    assert.match(rows[1]!, /^ {2}_{24}/u, 'an ASCII rule');
  });
});

test('Notify shows the notice once in the real transcript; Off and no new release show nothing', async () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['updateProvenance'] = async () => 'homebrew';
    const before = app['output'].transcript().lines.length;
    await app['announceUpdate']({version: '99.0.0', tag: 'v99.0.0', url: facts.url, summary: ['Notes.']});
    const text = app['output'].wrapped(100).map((row: {plain: string}) => row.plain).join('\n');
    assert.match(text, /NMSh 99\.0\.0 is available/u);
    assert.match(text, /brew update && brew upgrade nmsh/u);
    assert.ok(app['output'].transcript().lines.length > before);
    // Off: no request at all, so nothing to announce.
    app['promptConfiguration'].updateMode = 'off';
    assert.equal(app['updateFrequencyInEffect'](), 'off');
    const count = app['output'].transcript().lines.length;
    await app['quietUpdateCheck']();
    assert.equal(app['output'].transcript().lines.length, count, 'Off adds nothing');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
