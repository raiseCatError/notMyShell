import {once} from 'node:events';
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {ShellSession} from '../src/shell/ShellSession.js';
import {connectSession} from '../src/session/connectSession.js';
import {socketPathFor} from '../src/session/runtimeDir.js';

// A short, owned POSIX root avoids Unix-socket limits. Never touch existing roots.
const root = realpathSync(mkdtempSync('/tmp/npb-'));
writeFileSync(join(root, '.zshrc'), '');
const env = {...process.env, HOME: root};
const samples: Record<string, number[]> = {'pty-ready': [], 'service-ready': [], 'service-cleanup': []};
try {
  for (let index = 0; index < 3; index++) {
    let started = performance.now();
    const shell = new ShellSession(root, 80, 24, root, env);
    try {
      await once(shell, 'prompt', {signal: AbortSignal.timeout(10000)});
      samples['pty-ready']!.push(performance.now() - started);
    } finally {
      const exited = once(shell, 'exit', {signal: AbortSignal.timeout(5000)});
      shell.kill(); await exited;
    }
    const runtimeDir = join(root, `r${index}`);
    started = performance.now();
    const connection = await connectSession({cwd: root, columns: 80, rows: 24, env, runtimeDir});
    try {
      if (connection.mode !== 'service') throw new Error(connection.notice ?? 'service unavailable');
      const ready = once(connection.client, 'prompt', {signal: AbortSignal.timeout(10000)});
      connection.client.start(); await ready;
      samples['service-ready']!.push(performance.now() - started);
    } finally {
      started = performance.now();
      connection.client.kill();
      while (existsSync(socketPathFor(runtimeDir))) {
        if (performance.now() - started > 5000) throw new Error('service cleanup exceeded 5s budget');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      samples['service-cleanup']!.push(performance.now() - started);
    }
  }
  console.log(`Platform timing: ${process.platform} ${process.arch}, ${process.version}; 3 isolated samples`);
  for (const [name, values] of Object.entries(samples)) {
    values.sort((a, b) => a - b);
    console.log(`${name}: p50=${values[1]!.toFixed(2)}ms max=${values[2]!.toFixed(2)}ms`);
  }
} finally { rmSync(root, {recursive: true, force: true}); }
