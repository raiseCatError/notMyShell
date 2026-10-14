import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {ACTIVITY_VERBS} from '../src/status/activityVerbs.js';

/** Expressive activity wording through the real composer and PTY: decorated success, factual failure, factual copies. */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: Expressive keeps its active/completed pair across a detached running command', {skip: !supported, timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh', liveActivity: {style: 'expressive'}});
  const release = join(sandbox.home, 'release');
  const command = `echo HOLD-STYLE; while ! test -f '${release}'; do sleep 0.1; done; echo STYLE-DONE`;
  const first = sandbox.launch();
  try {
    await first.waitFor(/Vespyr|notMyShell|zsh/u);
    await first.run('echo READY', /READY/u);
    await first.run(command, /HOLD-STYLE/u, {completion: false});
    await until(async () => (await sandbox.transcripts().list()).some(session => session.live?.running?.activityIndex !== undefined), 15_000, 'saved activity choice');
    const journal = (await sandbox.transcripts().list()).find(session => session.live?.running?.command === command)!;
    const pair = ACTIVITY_VERBS[journal.live!.running!.activityIndex!]!;
    assert.ok(pair);
    const sessionId = journal.live!.sessionId;
    first.pty.kill('SIGKILL');
    await first.waitExit();
    await until(async () => (await sandbox.sessions()).some(session => session.id === sessionId && !session.attached), 15_000, 'detached session');
    const resumed = sandbox.launch(['--attach', sessionId]);
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    await resumed.waitFor(new RegExp(`${escaped(pair.active)}…`, 'u'));
    const mark = resumed.mark;
    writeFileSync(release, 'go');
    await resumed.waitFor(new RegExp(`${escaped(pair.complete)}.*done`, 'u'), mark);
    // The UI may draw completion before the asynchronous journal checkpoint finishes.
    await until(async () => (await sandbox.transcripts().list()).some(session => session.transcript.records.some(record => record.command === command)), 15_000, 'factual completion journal');
    const saved = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).find(record => record.command === command)!;
    assert.match(saved.lifecycleText, /Completed/u);
    assert.doesNotMatch(saved.lifecycleText, new RegExp(escaped(pair.complete), 'u'));
  } finally { await sandbox.dispose(); }
});

test('live: Expressive wording decorates success only; failures keep their exit code and copies stay factual', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh', liveActivity: {style: 'expressive'}, copy: {mode: 'quick', includeStatus: true, autoExpand: false}});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.txt');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    let mark = frontend.mark;
    await frontend.run('echo hello-style', /hello-style/u);
    await frontend.waitFor(/✔ \p{Lu}[^\n·]* for \d[^\n]*· done \d\d:\d\d/u, mark);
    mark = frontend.mark;
    await frontend.run('sh -c "exit 3"', /./u);
    await frontend.waitFor(/Command failed · exit 3/u, mark);
    // The copy payload is the factual status, never the decorative phrase.
    frontend.pty.write('/copy 2\r');
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8').length > 0, 15_000, 'the copy on the clipboard');
    const copied = readFileSync(clip, 'utf8');
    assert.match(copied, /hello-style\n✔ Completed · [\d.]+ ?m?s · \d\d:\d\d\n?$/u, copied);
    assert.doesNotMatch(copied, / for \d.*done /u);
  } finally {
    await sandbox.dispose();
  }
});
