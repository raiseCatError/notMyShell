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

test('agent and mod text uses the shared display scrubber: whole sequences go, lines stay', async () => {
  const {displayText} = await import('../src/agents/transcript/projection.js');
  assert.equal(displayText('evil\u001b]0;PWNED\u0007 name\nnext\tline'), 'evil name\nnext    line');
  assert.equal(displayText('a\u001b]0;unterminated title\nb'), 'a\nb', 'an unterminated OSC never leaves ]0; debris and ends at its line');
  assert.equal(displayText('x\u009d0;C1 title\u009cy\u001bP+q544e\u001b\\z\u001b_Gi=1\u001b\\w'), 'xyzw', 'C1, DCS and APC strings');
  assert.equal(displayText('pay‮exe⁦.txt\u001b[31m!'), 'payexe.txt!');
});
