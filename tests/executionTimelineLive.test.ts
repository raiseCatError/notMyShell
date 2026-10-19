import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

const bash = ['/opt/homebrew/bin/bash','/usr/local/bin/bash','/usr/bin/bash','/bin/bash'].find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path,['--version'],{encoding:'utf8'}).stdout));
const fish = ['/opt/homebrew/bin/fish','/usr/local/bin/fish','/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
for (const shell of ['zsh','bash','fish'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  for (const policy of ['pause','continue'] as const) {
    test(`live ${shell}: ${policy} policy, paused independent provenance and reviewed aliases`, {skip: available ? false : `${shell} unavailable`, timeout: 120_000}, async () => {
      const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell, queueFailurePolicy: policy}, shell === 'bash' && bash ? {PATH: `${bash.slice(0,-5)}:${process.env.PATH}`} : {});
      const frontend = sandbox.launch([], {cols: 100, rows: 30});
      try {
        await frontend.waitFor(/notMyShell|zsh|bash|fish/u);
        await until(async () => (await sandbox.sessions()).some(item => item.lastExit !== undefined), 20_000, () => `authenticated first prompt; ${strip(frontend.output).slice(-2500)}`);
        await frontend.run('echo READY', /READY/u);
        const gate = join(sandbox.home,'release-chain');
        mkdirSync(join(sandbox.home,'sub'));
        const holding = `sh -c 'printf "CHAIN-%s\\n" HOLD; until test -f "$1"; do sleep 0.05; done; exit 3' fixture "${gate}"`;
        let mark = frontend.mark;
        frontend.pty.write(holding + '\r');
        await frontend.waitFor(/CHAIN-HOLD/u, mark);
        const commands = [`cd '${join(sandbox.home,'sub')}'`, `printf 'PERSIST:%s\\n' "$PWD"`];
        // Ctrl+Q queues each to run after (#426: a plain Enter would hold it for approval).
        for (const command of commands) frontend.pty.write(command+'\u0011');
        await until(async () => (await sandbox.sessions())[0]?.queued === 2, 10_000, 'two queued entries');
        if (policy === 'pause') {
          await frontend.run('/qp', /Queue paused/u);
          writeFileSync(gate, '');
          await until(async () => (await sandbox.transcripts().list()).flatMap(item => item.transcript.records).some(record => record.command === holding), 20_000, 'predecessor completion');
          assert.equal((await sandbox.sessions())[0]?.queuePaused, 'user');
          await frontend.run(`sh -c 'printf "INDEPENDENT-%s\\n" DONE; exit 7'`, /INDEPENDENT-DONE/u);
          assert.equal((await sandbox.sessions())[0]?.queuePaused, 'user', 'independent failure cannot replace original pause');
          assert.equal((await sandbox.sessions())[0]?.queued, 2);
          await frontend.run('/qr', /Resume the queue\?/u);
          assert.equal((await sandbox.sessions())[0]?.queued, 2, 'review alone never executes');
          frontend.pty.write('\r');
        } else writeFileSync(gate, '');
        await until(async () => {
          const records = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records);
          return commands.every(command => records.filter(record => record.command === command).length === 1);
        }, 20_000, () => `each queued command exactly once; ${strip(frontend.output).slice(-3500)}`);
        const records = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records);
        const last = records.find(record => record.command === commands[1])!;
        assert.match(last.output, /PERSIST:.*sub/u, 'persistent shell cwd is retained');
        assert.match(last.lifecycleText, /from queue/u);
        if (policy === 'pause') assert.doesNotMatch(records.find(record => record.exitCode === 7)!.lifecycleText, /from queue/u);
        mark = frontend.mark;
        await frontend.run('/q', /Command queue/u);
        await frontend.waitFor(/Queue finished · 3 commands/u, mark);
        assert.doesNotMatch(strip(frontend.output.slice(mark)), /Queue finished · 4 commands/u, 'independent foreground work stays outside the chain');
        frontend.pty.write('\u001b');
      } finally { await sandbox.dispose(); }
    });
  }
}
