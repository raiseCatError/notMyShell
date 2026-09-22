import test from 'node:test';
import assert from 'node:assert/strict';
import {ShellProtocolDecoder} from '../src/shell/ShellProtocol.js';

test('extracts split shell markers without leaking them into output', () => {
  const decoder = new ShellProtocolDecoder('token');
  assert.deepEqual(decoder.push('hello\u001B]777;nmsh;tok'), [{kind: 'data', data: 'hello'}]);
  assert.deepEqual(decoder.push('en;65;/tmp/project\u0007'), [
    {kind: 'marker', marker: {exitCode: 65, cwd: '/tmp/project'}},
  ]);
});
