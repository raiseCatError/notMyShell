/** Disposable provider probe. No TUI inspection; reports only eligible event facts. */
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'nmsh-claude-probe-'));
const executable = process.env.NMSH_PROBE_CLAUDE ?? 'claude';
const version = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000}).stdout.trim();
const sessionId = randomUUID();
const results = {version, cases: [], inventory: undefined};
const base = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-budget-usd', '0.5'];

async function run(name, prompts, extra = [], permission = false, interrupt = false) {
  const argv = [...base, ...extra];
  const facts = {name, argv, types: [], tools: [], controls: [], texts: [], sessionIds: [], results: [], stderr: '', exit: null, timedOut: false};
  let child, buffer = '', size = 0, turn = 0;
  try {
    child = spawn(executable, argv, {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
    const send = text => child.stdin.write(JSON.stringify({type: 'user', message: {role: 'user', content: [{type: 'text', text}]}}) + '\n');
    const initializeId = randomUUID();
    child.stdin.write(JSON.stringify({type: 'control_request', request_id: initializeId, request: {subtype: 'initialize', hooks: {}}}) + '\n');
    const timer = setTimeout(() => {facts.timedOut = true; child.kill('SIGKILL');}, 55000);
    child.stderr.on('data', chunk => {facts.stderr = (facts.stderr + chunk.toString()).slice(0, 1000);});
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {facts.timedOut = true; child.kill('SIGKILL'); return;}
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let event; try {event = JSON.parse(line);} catch {continue;}
        const type = `${event.type}:${event.subtype ?? event.request?.subtype ?? ''}`;
        if (!facts.types.includes(type)) facts.types.push(type);
        if (event.type === 'control_response' && event.response?.request_id === initializeId) send(prompts[turn++]);
        if (event.session_id && !facts.sessionIds.includes(event.session_id)) facts.sessionIds.push(event.session_id);
        for (const part of event.message?.content ?? []) {
          if (part.type === 'text') facts.texts.push(part.text.slice(0, 500));
          if (part.type === 'tool_use') facts.tools.push({name: part.name, inputKeys: Object.keys(part.input ?? {})});
          if (part.type === 'tool_result') facts.tools.push({result: true, error: part.is_error === true, contentType: typeof part.content});
        }
        if (event.type === 'control_request') {
          facts.controls.push({subtype: event.request?.subtype, tool: event.request?.tool_name, keys: Object.keys(event.request ?? {})});
          const question = event.request?.tool_name === 'AskUserQuestion';
          const input = event.request?.input ?? {};
          if (question) facts.controls.at(-1).questions = input.questions;
          const updatedInput = question ? {...input, answers: Object.fromEntries((input.questions ?? []).map(q => [q.question, q.options?.[0]?.label ?? 'red']))} : input;
          child.stdin.write(JSON.stringify({type: 'control_response', response: {subtype: 'success', request_id: event.request_id, response: permission || question ? {behavior: 'allow', updatedInput} : {behavior: 'deny', message: 'Probe deliberately denied.'}}}) + '\n');
        }
        if (event.type === 'result') {
          facts.results.push({subtype: event.subtype, error: event.is_error, permissionDenials: event.permission_denials?.map(d => d.tool_name)});
          if (turn < prompts.length) send(prompts[turn++]); else child.stdin.end();
        }
      }
    });
    if (interrupt) setTimeout(() => child.stdin.write(JSON.stringify({type: 'control_request', request_id: randomUUID(), request: {subtype: 'interrupt'}}) + '\n'), 2500).unref();
    facts.exit = await new Promise(resolve => {child.once('error', e => {facts.stderr = e.message; resolve(-1);}); child.once('close', resolve);});
    clearTimeout(timer);
  } finally {child?.kill('SIGKILL');}
  results.cases.push(facts);
  console.log(JSON.stringify(facts));
  return facts;
}

try {
  writeFileSync(join(root, 'fixture.txt'), 'probe original\n', {mode: 0o600});
  const inventory = spawnSync(executable, ['plugin', 'list', '--json'], {cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
  try {results.inventory = JSON.parse(inventory.stdout);} catch {results.inventory = {exit: inventory.status, error: inventory.stderr.slice(0, 500)};}
  console.log(JSON.stringify({version, inventory: results.inventory}));
  const conversation = await run('conversation-multiple-turns', ['Reply only PROBE-NONCE-739.', 'What exact nonce did you just reply with?'], ['--safe-mode', '--session-id', sessionId, '--tools', '']);
  if (!conversation.results.some(r => !r.error)) {
    console.log(JSON.stringify({stop: 'No successful conversation; tool/resume/hook probes cannot establish runtime support.'}));
  } else {
    await run('read-edit-bash-allow', ['Read fixture.txt, replace original with edited using Edit, then run printf probe-bash via Bash.'], ['--safe-mode', '--tools', 'Read,Edit,Bash'], true);
    console.log(JSON.stringify({fixtureAfterAllow: readFileSync(join(root, 'fixture.txt'), 'utf8')}));
    await run('permission-deny', ['Use Bash to write denied.txt containing denied.'], ['--safe-mode', '--tools', 'Bash'], false);
    console.log(JSON.stringify({deniedFileExists: (await import('node:fs')).existsSync(join(root, 'denied.txt'))}));
    await run('question', ['Use AskUserQuestion to ask me to choose red or blue. Do not choose for me.'], ['--safe-mode', '--tools', 'AskUserQuestion'], false);
    await run('resume', ['What exact nonce did you reply with earlier?'], ['--safe-mode', '--resume', sessionId, '--tools', '']);
    await run('interrupt', ['Use Bash to run sleep 20 then printf finished.', 'Reply only AFTER-INTERRUPT.'], ['--safe-mode', '--tools', 'Bash'], true, true);
  }
    // SessionStart hooks can be observed before model authentication succeeds.
    const plugin = join(root, 'plugin');
    mkdirSync(join(plugin, '.claude-plugin'), {recursive: true});
    mkdirSync(join(plugin, 'hooks'));
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({name: 'nmsh-probe-only', version: '1.0.0', description: 'Disposable NMSh probe'}));
    writeFileSync(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({hooks: {SessionStart: [{hooks: [{type: 'command', command: `printf hook-ran > '${join(root, 'hook-marker')}'`}]}]}}));
    await run('native-plugin-hook', ['Reply only hook probe.'], ['--plugin-dir', plugin, '--include-hook-events', '--tools', '']);
    try {console.log(JSON.stringify({hookMarker: readFileSync(join(root, 'hook-marker'), 'utf8')}));} catch {console.log(JSON.stringify({hookMarker: 'not observed'}));}
} finally {rmSync(root, {recursive: true, force: true});}
