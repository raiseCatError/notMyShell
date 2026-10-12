import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {encodeMessage, FrameDecoder, PROTOCOL_VERSION, type ClientMessage} from '../src/session/SessionProtocol.js';
import {socketPathFor} from '../src/session/runtimeDir.js';

for (const [started, operation] of [[false, 'kill'], [false, 'detach'], [true, 'kill'], [true, 'detach']] as const) {
  test(`${operation} closes a ${started ? 'started' : 'held'} client after peer shutdown, preserving output ownership`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-socket-close-')));
    const peers = new Set<Socket>();
    const received: ClientMessage[] = [];
    let completed!: () => void;
    const requestReceived = new Promise<void>(resolve => { completed = resolve; });
    const server = createServer(socket => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      const decoder = new FrameDecoder();
      socket.on('data', data => {
        for (const result of decoder.push(data.toString())) {
          if (!result.ok) continue;
          const message = result.message as ClientMessage;
          received.push(message);
          if (message.type === 'hello') socket.write(encodeMessage({type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd', startupSafety: 1}));
          else if (message.type === 'create') socket.write(encodeMessage({type: 'created', sessionId: 'held', pid: 4242}) + encodeMessage({type: 'output', data: 'PRESTART'}));
          else if (message.type === 'terminate' || message.type === 'detach') {
            // A final output frame arrives only after connect has paused input.
            socket.end(encodeMessage({type: 'output', data: 'HELD-OUTPUT'}));
            completed();
          }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(socketPathFor(root), resolve));
    let client: SocketSessionClient | undefined;
    try {
      client = await SocketSessionClient.connect({socketPath: socketPathFor(root), cwd: root, columns: 80, rows: 24, env: {}});
      const output: string[] = [];
      client.on('data', data => { output.push(data); });
      const socket = client['socket'];
      let closed!: () => void;
      const closure = new Promise<void>(resolve => { closed = resolve; });
      socket.once('close', closed);
      if (started) client.start();
      client[operation]();
      await requestReceived;
      await new Promise<void>(resolve => server.close(() => resolve()));
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([closure, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`client retained after peer close: ${JSON.stringify({
            destroyed: socket.destroyed, readableFlowing: socket.readableFlowing, readableEnded: socket.readableEnded,
            readableLength: socket.readableLength, writableEnded: socket.writableEnded,
          })}`)), 1000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      assert.ok(received.some(message => message.type === (operation === 'kill' ? 'terminate' : 'detach')),
        'the lifecycle request reaches the peer before local shutdown');
      assert.deepEqual(output, started ? ['PRESTART', 'HELD-OUTPUT'] : [],
        'started clients keep output order; cancelled pre-start output stays withheld');
      assert.equal(socket.destroyed, true, 'the readable half does not retain a worker');
    } finally {
      client?.['socket'].destroy();
      for (const peer of peers) peer.destroy();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, {recursive: true, force: true});
    }
  });
}
