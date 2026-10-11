// A stand-in for `codex app-server` speaking the documented JSON-RPC shapes on stdio, for adapter tests.
// Usage: node fake-codex-app-server.mjs <scenario> <log-file>. Every message the client sends is appended to the log.
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const [scenario, log] = process.argv.slice(2);
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const record = message => appendFileSync(log, `${JSON.stringify(message)}\n`);

if (scenario === 'garbage') {
  process.stdout.write('not json\n[1,2]\n{"method": 5}\n');
  process.stdout.write(`${'x'.repeat(9 * 1024 * 1024)}\n`);
}

createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  record(message);
  const {id, method} = message;
  if (method === 'initialize') {
    if (scenario === 'refuse-init') return send({id, error: {code: -32600, message: 'no'}});
    return send({id, result: {userAgent: 'fake'}});
  }
  if (method === 'thread/start' || method === 'thread/resume') {
    // The notification first: the adapter must report the thread once whatever the order.
    send({method: 'thread/started', params: {thread: {id: 'thr_1'}}});
    return send({id, result: {thread: {id: 'thr_1'}, model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: {type: 'workspaceWrite'}}});
  }
  if (method === 'turn/start') {
    send({id, result: {turn: {id: 'turn_1', status: 'inProgress', items: []}}});
    send({method: 'turn/started', params: {threadId: 'thr_1', turn: {id: 'turn_1', status: 'inProgress', items: []}}});
    if (scenario === 'interrupt') return;
    if (scenario === 'files' || scenario === 'files-unreported') {
      if (scenario === 'files') send({method: 'item/started', params: {threadId: 'thr_1', turnId: 'turn_1', startedAtMs: 1, item: {type: 'fileChange', id: 'item_2', status: 'inProgress',
        changes: [{path: 'src/a.ts', kind: {type: 'update'}, diff: ''}, {path: '.github/workflows/release.yml', kind: {type: 'update'}, diff: ''}]}}});
      return send({id: 102, method: 'item/fileChange/requestApproval', params: {threadId: 'thr_1', turnId: 'turn_1', itemId: 'item_2', startedAtMs: 1, reason: 'Harmless formatting only'}});
    }
    if (scenario === 'fail') return send({method: 'turn/completed', params: {threadId: 'thr_1', turn: {id: 'turn_1', status: 'failed', error: {message: 'usage limit reached\nsecond line'}, items: []}}});
    send({method: 'item/started', params: {threadId: 'thr_1', turnId: 'turn_1', startedAtMs: 1, item: {type: 'commandExecution', id: 'item_1', command: 'rm -rf build', commandActions: [], cwd: '/tmp', status: 'inProgress'}}});
    send({id: 100, method: 'item/commandExecution/requestApproval', params: {threadId: 'thr_1', turnId: 'turn_1', itemId: 'item_1', startedAtMs: 1, command: 'rm -rf build', cwd: '/tmp', reason: 'cleans the build'}});
    send({id: 101, method: 'item/tool/requestUserInput', params: {threadId: 'thr_1', turnId: 'turn_1', itemId: 'item_9', questions: []}});
    return;
  }
  if (id === 100) {
    // The approval answer arrived; the command runs (or not) and the turn ends.
    const accepted = message.result?.decision === 'accept';
    send({method: 'item/completed', params: {threadId: 'thr_1', turnId: 'turn_1', completedAtMs: 2, item: {type: 'commandExecution', id: 'item_1', command: 'rm -rf build', commandActions: [], cwd: '/tmp',
      status: accepted ? 'completed' : 'declined', exitCode: accepted ? 0 : null}}});
    send({method: 'item/completed', params: {threadId: 'thr_1', turnId: 'turn_1', completedAtMs: 3, item: {type: 'fileChange', id: 'item_2', status: 'completed', changes: [{path: 'src/a.ts', kind: {type: 'update'}, diff: ''}, {path: 'src/b.ts', kind: {type: 'add'}, diff: ''}]}}});
    send({method: 'item/completed', params: {threadId: 'thr_1', turnId: 'turn_1', completedAtMs: 4, item: {type: 'agentMessage', id: 'item_3', text: accepted ? 'Cleaned.' : 'Left the build alone.'}}});
    return send({method: 'turn/completed', params: {threadId: 'thr_1', turn: {id: 'turn_1', status: 'completed', items: []}}});
  }
  if (id === 102) return send({method: 'turn/completed', params: {threadId: 'thr_1', turn: {id: 'turn_1', status: 'completed', items: []}}});
  if (method === 'turn/interrupt') {
    if (scenario === 'interrupt') {
      send({id, result: {}});
      return send({method: 'turn/completed', params: {threadId: 'thr_1', turn: {id: 'turn_1', status: 'interrupted', items: []}}});
    }
    return send({id, result: {}});
  }
});
