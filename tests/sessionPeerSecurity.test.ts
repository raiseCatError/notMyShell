import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync} from 'node:fs';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dismissSessionNotice, listLiveSessions, listSessionNotices} from '../src/session/connectSession.js';
import {killSession, renameSession} from '../src/session/SocketSessionClient.js';
import {encodeMessage, FrameDecoder, PROTOCOL_VERSION} from '../src/session/SessionProtocol.js';
import {socketPathFor} from '../src/session/runtimeDir.js';

// A reachable impostor must not gain a connection, even for display-only or
// best-effort requests. Removing request's runtime validation breaks this test.
for (const unsafe of ['public directory', 'symlink'] as const) {
  test(`session helpers refuse a reachable socket in a ${unsafe}`, async t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-peer-')));
    const linked = join(root, 'alias');
    const sockets = new Set<Socket>();
    const requests: string[] = [];
    const forged = {id: 'forged', pid: 123, cwd: '/forged', createdAt: 1, state: 'detached' as const};
    const server = createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      const decoder = new FrameDecoder();
      socket.on('data', chunk => {
        for (const result of decoder.push(chunk.toString())) {
          if (!result.ok) continue;
          const message = result.message;
          requests.push(message.type);
          if (message.type === 'hello') socket.write(encodeMessage({type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd', startupSafety: 1}));
          else if (message.type === 'dismiss') socket.write(encodeMessage({type: 'dismissed', sessionId: 'forged'}));
          else if (message.type === 'kill') socket.write(encodeMessage({type: 'killed', sessionId: 'forged'}));
          else socket.write(encodeMessage({type: 'sessions', sessions: [forged], ended: []}));
        }
      });
    });
    await new Promise<void>(resolve => server.listen(socketPathFor(root), resolve));
    const runtimeDir = unsafe === 'symlink' ? linked : root;
    if (unsafe === 'symlink') symlinkSync(root, linked);
    else chmodSync(root, 0o777);
    try {
      await t.test('live listing cannot trust forged identities', async () => {
        await assert.rejects(listLiveSessions({runtimeDir}), /not private|not a directory/u);
      });
      await t.test('notice listing fails closed', async () => {
        assert.deepEqual(await listSessionNotices({runtimeDir}), {sessions: [], ended: []});
      });
      await t.test('dismissal sends no session identifier', async () => {
        const before = requests.length;
        await dismissSessionNotice('forged', {runtimeDir});
        assert.equal(requests.length, before, 'no bytes sent to an unverified peer');
      });
      await t.test('rename sends no session name', async () => {
        await assert.rejects(renameSession(socketPathFor(runtimeDir), 'forged', 'private-name'), /not private|not a directory/u);
      });
      await t.test('termination cannot reach an unverified peer', async () => {
        await assert.rejects(killSession(socketPathFor(runtimeDir), 'forged'), /not private|not a directory/u);
      });
      assert.deepEqual(requests, [], 'no handshake or operation reaches the unsafe socket');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, {recursive: true, force: true});
    }
  });
}
