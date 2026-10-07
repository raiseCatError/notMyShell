import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {claudeEvents} from '../src/agents/sessions/claudeAdapter.js';

test('semantic tool object retains actual input and full result across cache eviction', () => {
  const transcript = new AgentTranscript();
  try {
    transcript.append({kind: 'tool', id: 't', name: 'Edit', status: 'started', input: {file_path: '/probe/a', old_string: 'old', new_string: 'new'}});
    const full = 'result\n'.repeat(3000);
    transcript.append({kind: 'tool', id: 't', name: '', status: 'finished', detail: full});
    for (let i = 0; i < 2100; i++) transcript.append({kind: 'assistant', text: `reply ${i}`});
    assert.equal(transcript.objects.length, 2101);
    const object = transcript.load(0)!;
    assert.match(object.detail!, /old_string/u);
    assert.ok(object.detail!.endsWith(full));
    assert.equal(transcript.incomplete, undefined);
  } finally {transcript.dispose();}
});

test('normalizer does not silently cut large tool results and excludes thinking blocks', () => {
  const detail = 'x'.repeat(30000);
  assert.equal((claudeEvents(JSON.stringify({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't', content: detail}]}})).events[0] as any).detail, detail);
  assert.deepEqual(claudeEvents(JSON.stringify({type: 'assistant', message: {content: [{type: 'thinking', thinking: 'private reasoning'}]}})).events, []);
});
