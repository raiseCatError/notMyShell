import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, statSync} from 'node:fs';
import {AgentSourceStore} from '../src/agents/transcript/store.js';
import {projectObject, displayText} from '../src/agents/transcript/projection.js';

test('large eligible source survives hot-cache eviction and has private lifetime storage', () => {
  const store = new AgentSourceStore({memoryBytes: 100, sourceBytes: 100000, eventBytes: 50000});
  try {
    const text = 'large-content\n'.repeat(1500);
    const a = store.append({kind: 'assistant', text})!;
    store.append({kind: 'assistant', text: 'later'.repeat(100)});
    assert.deepEqual(store.read(a), {kind: 'assistant', text});
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
    assert.equal(statSync(store.directory).mode & 0o777, 0o700);
    assert.equal(store.incomplete, undefined);
  } finally {store.dispose();}
  assert.equal(existsSync(store.directory), false);
});

test('hard resource limit reports incomplete and never destroys earlier content', () => {
  const store = new AgentSourceStore({sourceBytes: 200, eventBytes: 100});
  try {
    const id = store.append({kind: 'assistant', text: 'kept'})!;
    assert.equal(store.append({kind: 'assistant', text: 'x'.repeat(101)}), undefined);
    assert.match(store.incomplete!, /event/u);
    assert.equal(store.read(id)?.kind, 'assistant');
  } finally {store.dispose();}
});

test('depth fallback, full vs visible copy and hostile display controls', () => {
  const object = {id: 'x', kind: 'assistant' as const, text: 'hello\n'.repeat(100)};
  assert.ok(projectObject(object, 2).text.length < projectObject(object, 5).text.length);
  assert.equal(projectObject(object, 3).depth, 2);
  assert.equal(projectObject(object, 5).text, object.text);
  assert.doesNotMatch(displayText('\x1b]52;c;secret\x07text\u202e'), /\x1b|\x07|\u202e/u);
});
