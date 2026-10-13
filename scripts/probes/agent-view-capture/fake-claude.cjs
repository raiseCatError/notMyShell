#!/usr/bin/env node
// Fixture provider for presentation captures: speaks Claude's stream-json shape with fixed content.
if (process.argv.includes('--help')) {
  process.stdout.write('Usage: claude [options]\n  -p, --print  Print response\n  --input-format <format>  "text" (default), or "stream-json"\n  --output-format <format>  "stream-json" (realtime)\n  --permission-prompts <target>  Who answers\n  --permission-prompt-tool <tool>\n  -r, --resume [value]\n  --session-id <uuid>\n  --verbose\n');
  process.exit(0);
}
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
out({type: 'system', subtype: 'init', session_id: 'fixture-session', model: 'fixture-model'});
let buffer = '', turn = 0;
const later = (ms, f) => setTimeout(f, ms);
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    if (line.type === 'control_request' && line.request.subtype === 'initialize') out({type: 'control_response', response: {subtype: 'success', request_id: line.request_id, response: {}}});
    if (line.type === 'user') {
      turn += 1;
      if (turn === 1) {
        later(300, () => out({type: 'assistant', message: {model: 'fixture-model', content: [{type: 'text', text: "I'll look at how the sum helper is tested before changing anything."}, {type: 'tool_use', id: 't1', name: 'Read', input: {file_path: 'src/sum.js'}}]}}));
        later(600, () => out({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't1', content: 'export const sum = (a, b) => a + b;'}]}}));
        later(800, () => out({type: 'assistant', message: {model: 'fixture-model', content: [{type: 'tool_use', id: 't2', name: 'Bash', input: {command: 'npm test'}}]}}));
        later(1100, () => out({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't2', content: '# pass 4'}]}}));
        later(1400, () => out({type: 'assistant', message: {model: 'fixture-model', content: [{type: 'text', text: 'The helper is a one-line arrow function and all four cases in test/sum.test.js pass.\n\nTwo gaps worth covering: negative numbers and non-integer input. Floating-point addition such as 0.1 + 0.2 will not equal 0.3 exactly, so a test there should use a tolerance rather than strict equality.'}]}}));
        later(1600, () => out({type: 'result', subtype: 'success', is_error: false, session_id: 'fixture-session'}));
      }
    }
  }
});
process.stdin.on('end', () => process.exit(0));
