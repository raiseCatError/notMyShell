import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * Pins through the real composer and PTY: pin a finished command from the palette, find it in /pins, and stage it.
 * Staging puts the command in the composer; it is not run until Enter. The pins file is the sandbox's own.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

test('live: Pin command keeps a finished command; /pins stages it for review and never runs it', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {});
  try {
    await frontend.waitFor(/notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    const flag = join(sandbox.home, 'pinned-flag');
    await frontend.run(`touch ${flag}`, /Completed/u);
    assert.ok(existsSync(flag));
    let mark = frontend.mark;
    frontend.pty.write('\u001bOP');
    await frontend.waitFor(/Command palette/u, mark);
    frontend.pty.write('pin comm');
    await frontend.waitFor(/Pin command[\s\S]*Keep this command to reuse later/u, mark);
    frontend.pty.write('\r');
    await frontend.waitFor(/Pinned\. \/pins lists what you kept/u, mark);
    const file = join(sandbox.config, 'nmsh', 'pins.json');
    await until(() => existsSync(file), 5000, 'pins.json written');
    assert.match(readFileSync(file, 'utf8'), new RegExp(`"command": "touch ${flag}"`, 'u'));
    assert.doesNotMatch(readFileSync(file, 'utf8'), /READY/u, 'only the pinned command is kept, never output');
    await frontend.run(`rm ${flag}`, /Completed/u);
    assert.equal(existsSync(flag), false);
    mark = frontend.mark;
    frontend.pty.write('/pins\r');
    await frontend.waitFor(/Pins and recipes[\s\S]*touch /u, mark);
    frontend.pty.write('\r');
    await frontend.waitFor(/Staged in the composer for you to review/u, mark);
    await pause(800);
    // Staged, not run: the command sits in the composer, and nothing created the file.
    assert.equal(existsSync(flag), false, 'staging did not run the command');
    frontend.pty.write('\r');
    await until(() => existsSync(flag), 15_000, 'Enter runs the staged command');
  } finally { await sandbox.dispose(); }
});
