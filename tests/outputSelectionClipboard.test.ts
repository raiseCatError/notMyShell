import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

test('selection copies full exact stored bytes, preserves focus on failure/no-output, and rejects stale async completion', async () => {
  const f = executionFrameFixture(32, 20);
  const oldPath = process.env.PATH, oldDisplay = process.env.DISPLAY;
  const bin = join(process.cwd(), 'bin'); mkdirSync(bin);
  const file = join(process.cwd(), 'clipboard');
  const install = (body: string) => { for (const name of ['pbcopy', 'xclip', 'wl-copy']) {writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755);} };
  process.env.PATH = `${bin}:${oldPath}`; process.env.DISPLAY = ':nmsh-test';
  try {
    const exact = 'a\tb 日本語\n\n' + 'complete output\n'.repeat(400);
    f.begin('printf exact', exact); f.complete(); f.app['output'].toggleExpanded(0);
    const folded = f.app['output'].recentShell(1)!.expanded;
    install('exit 1'); await f.app['copySlash']('/copy', '');
    const state = f.app['outputNavigation']; await f.app['activateOutputNavigation']();
    assert.equal(f.app['outputNavigation'], state); assert.equal(state?.busy, false);
    assert.match(f.app['clipboardNote']?.text ?? '', /failed/u);
    install(`cat > '${file}'`); await f.app['activateOutputNavigation']();
    assert.equal(readFileSync(file, 'utf8'), exact); assert.equal(f.app['outputNavigation'], undefined);
    assert.equal(f.app['output'].recentShell(1)!.expanded, folded);
    f.begin('true'); f.complete(); await f.app['copySlash']('/copy', '');
    await f.app['activateOutputNavigation'](); assert.ok(f.app['outputNavigation'], 'silent output remains selectable after Nothing to copy');
    assert.equal(readFileSync(file, 'utf8'), exact);
    f.app['handleKey']({kind: 'escape'});
    f.app['output'].clearPresentation();
    f.begin('echo earlier', 'earlier\n'); f.complete();
    f.app['promptConfiguration'].copy.autoExpand = true;
    install(`sleep 0.1; cat > '${file}'`);
    await f.app['copySlash']('/copy', '');
    const pending = f.app['activateOutputNavigation']();
    f.app['output'].clearPresentation(); f.begin('echo replacement', 'replacement\n'); f.complete();
    const replacement = f.app['output'].recentShell(1)!;
    replacement.expanded = false;
    await pending;
    assert.equal(f.app['outputNavigation'], undefined);
    assert.equal(replacement.expanded, false, 'late clipboard completion cannot expand a reused startId');
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldDisplay === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = oldDisplay;
    f.dispose();
  }
});
