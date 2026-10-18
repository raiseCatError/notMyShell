import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('live: selected history keeps its command and cwd in pins and ephemeral clips without executing', {
  skip: !['darwin', 'linux'].includes(process.platform), timeout: 120_000,
}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh', picker: 'native'});
  try {
    const frontend = sandbox.launch();
    await frontend.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined),
      20_000, 'authenticated initial prompt');
    const origin = join(sandbox.home, 'origin');
    mkdirSync(origin);
    await frontend.run('cd origin', /Completed/u);
    const original = `printf '%s\\n' PIN-HISTORY`;
    await frontend.run(original, /PIN-HISTORY/u);
    await frontend.run('cd ..', /Completed/u);
    await frontend.run('echo LATEST-IS-DIFFERENT', /LATEST-IS-DIFFERENT/u);
    let mark = frontend.mark;
    frontend.pty.write('/history PIN-HISTORY');
    await frontend.waitFor(/exit 0 · \d+ms/u, mark);
    frontend.pty.write('\u001bOP');
    await frontend.waitFor(/Pin selected history command/u, mark);
    frontend.pty.write('pin selected\r');
    const pins = join(sandbox.config, 'nmsh', 'pins.json');
    await until(() => existsSync(pins), 15_000, 'explicit pin save');
    const data = JSON.parse(readFileSync(pins, 'utf8'));
    assert.deepEqual(data.pins.map((pin: {command: string; cwd: string}) => [pin.command, pin.cwd]), [[original, origin]],
      'the selected history record supplies both command and its original cwd');

    mark = frontend.mark;
    frontend.pty.write('\u001bOP');
    await frontend.waitFor(/Keep selected history command as clip/u, mark);
    frontend.pty.write('keep selected history\r');
    await frontend.waitFor(/Kept clip 1 in memory/u, mark);
    frontend.pty.write('\u0015');
    await frontend.run('/clips', /Review clip 1/u);
    mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Review paste/u, mark);
    frontend.pty.write('\u001b[27u\u001b[27u');
    const records = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records);
    assert.equal(records.filter(record => record.command === original).length, 1, 'pin, keep and review never resubmit');
    assert.equal(records.some(record => record.command.includes('pin selected') || record.command.includes('keep selected')), false);
    assert.equal(existsSync(join(sandbox.config, 'nmsh', 'clips.json')), false, 'clips are not persisted');

    const [session] = await sandbox.sessions();
    assert.ok(session);
    frontend.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session.id)?.state === 'detached',
      15_000, 'detached source frontend');
    const back = sandbox.launch(['--attach', session.id]);
    await back.waitFor(/LATEST-IS-DIFFERENT/u);
    await back.run('/clips', /No clips kept/u);
    assert.deepEqual(JSON.parse(readFileSync(pins, 'utf8')).pins.map((pin: {command: string}) => pin.command), [original],
      'only the explicitly saved pin survives the frontend');
  } finally { await sandbox.dispose(); }
});
