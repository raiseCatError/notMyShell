import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeStream, parseCatalog, parseContextUsage, parseSuggestions, parseToolResult} from '../src/agents/sessions/claudeStream.js';
import {claudeEvents} from '../src/agents/sessions/claudeAdapter.js';
import {AgentSessions} from '../src/agents/sessions/manager.js';
import {applyTelemetry, contextMeter, currentModel, emptyTelemetry, modelName, sameModel} from '../src/agents/telemetry.js';

/* Shapes below are the ones Claude Code 2.1.295 sent in the recorded control probe (scripts/probes/claude-controls.mjs). */
const INITIALIZE = {
  commands: [{name: 'model', description: 'Set the AI model', argumentHint: '<model>', builtin: true}, {name: 'compact', description: 'Compact the conversation', argumentHint: '<optional custom summarization instructions>', builtin: true},
    {name: 'design', description: 'A plugin skill', argumentHint: 'consent | revoke'}, {name: 'bad name!', description: 'refused'}],
  agents: [{name: 'Explore', description: 'Fast search'}, {name: 'general-purpose', description: 'General'}],
  output_style: 'default', available_output_styles: ['default', 'Concise'],
  models: [{value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']},
    {value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Fast', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']},
    {value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'No effort'}],
  account: {email: 'person@example.com', organization: 'Org', subscriptionType: 'Claude Pro', apiProvider: 'firstParty'},
};
const CONTEXT = {categories: [{name: 'System prompt', tokens: 2356, color: 'x', kind: 'used'}, {name: 'System tools', tokens: 1807, color: 'x', kind: 'used'}, {name: 'Messages', tokens: 785, color: 'x', kind: 'used'},
  {name: 'Autocompact buffer', tokens: 33000, color: 'x', kind: 'buffer'}, {name: 'Free space', tokens: 962052, color: 'x', kind: 'free'}, {name: 'Bogus', tokens: 1, kind: 'weird'}],
totalTokens: 4948, maxTokens: 1000000, rawMaxTokens: 1000000, percentage: 0, gridRows: [], model: 'claude-sonnet-5-5', memoryFiles: [{path: '/p/CLAUDE.md', type: 'Project', tokens: 812}], mcpTools: [], agents: [],
autoCompactThreshold: 967000, isAutoCompactEnabled: true,
messageBreakdown: {toolCallTokens: 125, toolResultTokens: 100, attachmentTokens: 0, assistantMessageTokens: 16, userMessageTokens: 151, redirectedContextTokens: 0, unattributedTokens: 0,
  toolCallsByType: [{name: 'Edit', callTokens: 70, resultTokens: 71}, {name: 'Read', callTokens: 55, resultTokens: 29}], attachmentsByType: []},
apiUsage: {input_tokens: 2, output_tokens: 5, cache_creation_input_tokens: 303, cache_read_input_tokens: 4643}};

test('initialize: the model catalog, commands and account plan, with refused shapes dropped', () => {
  const catalog = parseCatalog(INITIALIZE, 5)!;
  assert.deepEqual(catalog.models.map(model => [model.value, model.name, model.resolved, model.effortLevels?.length ?? 0]),
    [['default', 'Default (recommended)', 'claude-opus-5-5', 5], ['sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5', 5], ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'claude-haiku-4-5-20251001', 0]]);
  assert.deepEqual(catalog.commands.map(command => `${command.name}${command.builtin ? '*' : ''}`), ['model*', 'compact*', 'design'], 'an unsafe command name is not offered');
  assert.deepEqual(catalog.agents, ['Explore', 'general-purpose']);
  assert.equal(catalog.account?.plan, 'Claude Pro');
  assert.equal(parseCatalog('nope', 1), undefined);
});

test('context usage: provider categories by kind, memory files and the per-tool message breakdown', () => {
  const snapshot = parseContextUsage(CONTEXT, 'summary')!;
  assert.deepEqual(snapshot.categories.map(category => category.kind), ['used', 'used', 'used', 'buffer', 'free'], 'unknown kinds are dropped, never guessed');
  assert.equal(snapshot.totalTokens, 4948);
  assert.equal(snapshot.autoCompactThreshold, 967000);
  assert.deepEqual(snapshot.memoryFiles, [{path: '/p/CLAUDE.md', type: 'Project', tokens: 812}]);
  assert.deepEqual(snapshot.messages?.byTool, [{name: 'Edit', call: 70, result: 71}, {name: 'Read', call: 55, result: 29}]);
  assert.equal(parseContextUsage({categories: []}, 'summary'), undefined);
});

test('tool results: provider patches, reads, commands, searches, plans and subagent reports; whole files are never kept', () => {
  const edit = parseToolResult({filePath: '/p/fixture.txt', oldString: 'beta', newString: 'BETA', originalFile: 'alpha\nbeta\ngamma\nSECRET-WHOLE-FILE\n', replaceAll: false, userModified: false,
    structuredPatch: [{oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' alpha', '-beta', '+BETA', ' gamma']}]})!;
  assert.deepEqual(edit, {kind: 'patch', path: '/p/fixture.txt', hunks: [{oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' alpha', '-beta', '+BETA', ' gamma']}], added: 1, removed: 1, created: false, truncated: false});
  assert.ok(!JSON.stringify(edit).includes('SECRET-WHOLE-FILE'));
  const created = parseToolResult({type: 'create', filePath: '/p/new.ts', content: 'a\nb\nc', structuredPatch: [], originalFile: null})!;
  assert.deepEqual([created.kind, (created as {created: boolean}).created, (created as {added: number}).added], ['patch', true, 3]);
  assert.deepEqual(parseToolResult({type: 'text', file: {filePath: '/p/a.ts', content: 'x', numLines: 10, startLine: 1, totalLines: 40}}), {kind: 'read', path: '/p/a.ts', lines: 10, start: 1, total: 40});
  const bash = parseToolResult({stdout: 'ok\n'.repeat(40000), stderr: '', interrupted: false})!;
  assert.equal(bash.kind, 'bash');
  assert.ok((bash as {stdout: string}).stdout.length < 70 * 1024 && (bash as {truncated: boolean}).truncated, 'long output keeps its start and end, marked');
  assert.deepEqual(parseToolResult({mode: 'files_with_matches', numFiles: 2, filenames: ['a', 'b'], numMatches: 5}), {kind: 'search', files: 2, matches: 5, names: ['a', 'b']});
  assert.deepEqual(parseToolResult({oldTodos: [], newTodos: [{content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests'}, {content: 'x', status: 'bogus'}]}),
    {kind: 'todos', todos: [{content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests'}]});
  assert.equal(parseToolResult({agentId: 'a1', content: [{type: 'text', text: 'Found 3 callers.'}], totalToolUseCount: 4, totalDurationMs: 9000, totalTokens: 1234})?.kind, 'agent');
  assert.equal(parseToolResult('text'), undefined);
});

test('permission suggestions: the provider offers in words, destinations named, unknown offers not shown', () => {
  const suggestions = parseSuggestions([
    {type: 'addRules', rules: [{toolName: 'Bash', ruleContent: 'npm test:*'}], behavior: 'allow', destination: 'session'},
    {type: 'addRules', rules: [{toolName: 'Edit'}], behavior: 'allow', destination: 'userSettings'},
    {type: 'setMode', mode: 'acceptEdits', destination: 'session'},
    {type: 'addRules', rules: [{toolName: 'Bash'}], behavior: 'deny', destination: 'session'},
    {type: 'mystery', destination: 'session'},
  ]);
  assert.deepEqual(suggestions.map(item => item.label), ['Allow Bash(npm test:*) for this session', 'Allow Edit for every project (user settings)', 'Switch to acceptEdits mode for this session']);
  assert.equal(suggestions[0]!.update.destination, 'session', 'the offer is returned verbatim when chosen');
});

test('stream: init, status, compaction, retries, rate limits, tasks, usage and partial text become telemetry', () => {
  const stream = new ClaudeStream(() => 1000);
  const init = stream.parse({type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', permissionMode: 'acceptEdits', tools: ['Edit', 'Read'], mcp_servers: [{name: 'gh', status: 'connected'}],
    slash_commands: ['compact', 'context'], skills: [], plugins: [{name: 'p', version: '1.0.0'}], output_style: 'default', claude_code_version: '2.1.295', capabilities: ['interrupt_receipt_v1']});
  assert.equal(init.telemetry[0]!.kind, 'runtime');
  assert.equal((init.telemetry[0] as {runtime: {permissionMode: string}}).runtime.permissionMode, 'acceptEdits');
  assert.equal((init.telemetry[0] as {runtime: {effort?: unknown}}).runtime.effort, undefined, 'headless init reports no effort: none is invented');
  const compact = stream.parse({type: 'system', subtype: 'compact_boundary', compact_metadata: {trigger: 'auto', pre_tokens: 182000, post_tokens: 31000}});
  assert.deepEqual(compact.events, [{kind: 'compacted', trigger: 'auto', preTokens: 182000, postTokens: 31000}]);
  const limit = stream.parse({type: 'rate_limit_event', rate_limit_info: {status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 1_800_000_000}});
  assert.deepEqual(limit.telemetry, [{kind: 'rateLimit', type: 'seven_day', at: 1000, limit: {status: 'allowed_warning', utilization: 0.5, resetsAt: 1_800_000_000_000}}]);
  const task = stream.parse({type: 'system', subtype: 'task_started', task_id: 'tk', description: 'Find callers', subagent_type: 'Explore', task_type: 'local_agent', tool_use_id: 'tu'});
  assert.equal((task.telemetry[0] as {task: {status: string}}).task.status, 'running');
  assert.deepEqual(stream.parse({type: 'system', subtype: 'task_started', task_id: 'amb', description: 'x', ambient: true}).telemetry, [], 'ambient housekeeping is not activity');
  const result = stream.parse({type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 5000, duration_api_ms: 4000, total_cost_usd: 0.018,
    usage: {input_tokens: 6, output_tokens: 271, cache_read_input_tokens: 10899, cache_creation_input_tokens: 3146},
    modelUsage: {'claude-sonnet-5-5': {inputTokens: 6, outputTokens: 271, cacheReadInputTokens: 10899, cacheCreationInputTokens: 3146, costUSD: 0.0175, contextWindow: 1000000, maxOutputTokens: 128000}}});
  assert.deepEqual(result.telemetry.map(update => update.kind), ['usage', 'settled']);
  // Streaming deltas are presentation; a subagent's stream never mixes into the main reply.
  stream.parse({type: 'stream_event', parent_tool_use_id: null, event: {type: 'message_start'}});
  stream.parse({type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_start', content_block: {type: 'text'}}});
  stream.parse({type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'Hel'}}});
  assert.deepEqual(stream.parse({type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'lo'}}}).partial, {text: 'Hello'});
  assert.equal(stream.parse({type: 'stream_event', parent_tool_use_id: 'sub', event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'X'}}}).partial, undefined);
  assert.deepEqual(stream.parse({type: 'assistant', parent_tool_use_id: null, message: {content: [{type: 'text', text: 'Hello'}]}}).partial, {}, 'the completed message replaces the stream');
  // Files: reads when requested, edits from the provider's own patch; a plan from TodoWrite.
  const tools = stream.parse({type: 'assistant', message: {content: [{type: 'tool_use', id: 'r', name: 'Read', input: {file_path: '/p/a.ts'}}, {type: 'tool_use', id: 'e', name: 'Edit', input: {file_path: '/p/a.ts'}},
    {type: 'tool_use', id: 'td', name: 'TodoWrite', input: {todos: [{content: 'Run tests', status: 'pending', activeForm: 'Running tests'}]}}]}});
  assert.deepEqual(tools.telemetry.map(update => update.kind), ['file', 'todos']);
  const edited = stream.parse({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'e', content: 'ok'}]}, tool_use_result: {filePath: '/p/a.ts', structuredPatch: [{oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c']}]}});
  assert.deepEqual(edited.telemetry.map(update => [update.kind, (update as {action?: string}).action, (update as {added?: number}).added]), [['file', 'edit', 2]]);
  const denied = stream.parse({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'e', is_error: true, content: 'denied'}]}, tool_use_result: {filePath: '/p/a.ts', structuredPatch: []}});
  assert.deepEqual(denied.telemetry, [], 'a failed edit changed nothing');
});

test('telemetry: context meter prefers the provider breakdown, estimates from the newest turn, never from lifetime totals', () => {
  const telemetry = emptyTelemetry();
  assert.equal(contextMeter(telemetry), undefined, 'nothing reported means nothing shown, never 0%');
  applyTelemetry(telemetry, {kind: 'usage', at: 10, usage: {perModel: {'claude-sonnet-5-5': {input: 900000, output: 50000, cacheRead: 5_000_000, cacheWrite: 1, contextWindow: 1_000_000}},
    lastTurn: {input: 6, output: 271, cacheRead: 10899, cacheWrite: 3146, model: 'claude-sonnet-5-5'}, turns: 3, durationMs: 1, apiMs: 1}});
  const estimate = contextMeter(telemetry)!;
  assert.equal(estimate.source, 'estimate');
  assert.equal(estimate.used, 6 + 271 + 10899 + 3146, 'the newest request, not lifetime spend (which here exceeds the window)');
  assert.equal(estimate.max, 1_000_000);
  applyTelemetry(telemetry, {kind: 'context', at: 20, snapshot: parseContextUsage(CONTEXT, 'summary')!});
  assert.deepEqual([contextMeter(telemetry)!.source, contextMeter(telemetry)!.used], ['provider', 4948]);
  applyTelemetry(telemetry, {kind: 'usage', at: 30, usage: {perModel: {}, lastTurn: {input: 1, output: 1, cacheRead: 20000, cacheWrite: 0, model: 'x'}, turns: 4, durationMs: 1, apiMs: 1}});
  assert.equal(contextMeter(telemetry)!.source, 'estimate', 'a turn after the breakdown makes the breakdown stale');
  applyTelemetry(telemetry, {kind: 'compaction', compaction: {at: 40, trigger: 'manual', preTokens: 5000, postTokens: 900}});
  assert.equal(telemetry.context, undefined, 'compaction invalidates the breakdown');
});

test('telemetry: requested model is pending until the provider reports it; aliases resolve through the catalog', () => {
  const telemetry = emptyTelemetry();
  applyTelemetry(telemetry, {kind: 'catalog', catalog: parseCatalog(INITIALIZE, 1)!});
  applyTelemetry(telemetry, {kind: 'runtime', runtime: {model: 'claude-opus-5-5', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], capabilities: [], at: 2}});
  assert.deepEqual([currentModel(telemetry)!.value, currentModel(telemetry)!.source], ['claude-opus-5-5', 'provider']);
  applyTelemetry(telemetry, {kind: 'requested', field: 'model', value: 'sonnet', at: 3});
  assert.deepEqual([currentModel(telemetry)!.value, currentModel(telemetry)!.source], ['sonnet', 'requested'], 'acknowledged, not yet reported');
  applyTelemetry(telemetry, {kind: 'runtime', runtime: {model: 'claude-sonnet-5-5', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], capabilities: [], at: 4}});
  assert.deepEqual([currentModel(telemetry)!.value, currentModel(telemetry)!.source], ['claude-sonnet-5-5', 'provider']);
  assert.ok(sameModel('sonnet', 'claude-sonnet-5-5', telemetry));
  assert.equal(modelName('claude-sonnet-5-5', telemetry), 'Sonnet 5.5');
  assert.equal(modelName('claude-opus-5-5', telemetry), 'Opus 5.5', 'never "Default (recommended)" for a concrete model');
  assert.equal(modelName('claude-fable-5-1', undefined), 'Fable 5.1');
  assert.deepEqual(telemetry.modelHistory.map(entry => [entry.model, entry.source]), [['claude-opus-5-5', 'provider'], ['sonnet', 'requested'], ['claude-sonnet-5-5', 'provider']]);
});

test('claudeEvents: tool results carry structured results and subagent parents only when the provider sends them', () => {
  const plain = claudeEvents(JSON.stringify({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't', content: 'x'}]}})).events[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(plain).sort(), ['detail', 'id', 'kind', 'name', 'status']);
  const rich = claudeEvents(JSON.stringify({type: 'user', parent_tool_use_id: 'task-1', message: {content: [{type: 'tool_result', tool_use_id: 't', content: 'x'}]},
    tool_use_result: {filePath: '/a', structuredPatch: [{oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b']}]}})).events[0] as {result?: {kind: string}; parent?: string};
  assert.equal(rich.result?.kind, 'patch');
  assert.equal(rich.parent, 'task-1');
  const approval = claudeEvents(JSON.stringify({type: 'control_request', request_id: 'r', request: {subtype: 'can_use_tool', tool_name: 'Bash', input: {command: 'npm test'}, tool_use_id: 'tu',
    decision_reason: 'Command not in allow list', permission_suggestions: [{type: 'addRules', rules: [{toolName: 'Bash', ruleContent: 'npm test'}], behavior: 'allow', destination: 'session'}]}})).events[0] as Record<string, unknown>;
  assert.equal(approval.reason, 'Command not in allow list');
  assert.equal((approval.suggestions as Array<{label: string}>)[0]!.label, 'Allow Bash(npm test) for this session');
});

// ---- A stand-in CLI speaking the documented control protocol ------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'nmsh-control-'));
test.after(() => rmSync(root, {recursive: true, force: true}));
const HELP = 'Usage: claude [options]\n  -p, --print\n  --input-format <format> "stream-json"\n  --output-format <format> "stream-json"\n  --permission-prompts <target>  "host"\n  -r, --resume [value]\n  --session-id <uuid>\n  --include-partial-messages\n  --effort <level>\n';
const fake = join(root, 'claude');
writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(root, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));
const out = message => process.stdout.write(JSON.stringify(message) + '\\n');
let model = 'claude-opus-5-5', mode = 'default';
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    fs.appendFileSync(${JSON.stringify(join(root, 'stdin.jsonl'))}, JSON.stringify(line) + '\\n');
    const reply = (body) => out({type: 'control_response', response: {subtype: 'success', request_id: line.request_id, response: body}});
    const refuse = (error) => out({type: 'control_response', response: {subtype: 'error', request_id: line.request_id, error}});
    if (line.type === 'control_request') {
      const r = line.request;
      if (r.subtype === 'initialize') reply(${JSON.stringify(INITIALIZE)});
      else if (r.subtype === 'set_model') { model = r.model === 'sonnet' ? 'claude-sonnet-5-5' : r.model; reply(undefined); }
      else if (r.subtype === 'apply_flag_settings') reply(undefined);
      else if (r.subtype === 'set_permission_mode') { mode = r.mode; reply({mode}); }
      else if (r.subtype === 'get_context_usage') reply(${JSON.stringify(CONTEXT)});
      else if (r.subtype === 'mcp_status') reply({mcpServers: [{name: 'gh', status: 'connected', tools: [{name: 'search'}]}]});
      else refuse('Unsupported control request');
    }
    if (line.type === 'user') {
      out({type: 'system', subtype: 'init', session_id: 's1', model, permissionMode: mode, tools: [], mcp_servers: [], slash_commands: [], capabilities: []});
      out({type: 'stream_event', parent_tool_use_id: null, event: {type: 'message_start'}});
      out({type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_start', content_block: {type: 'text'}}});
      out({type: 'stream_event', parent_tool_use_id: null, event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'Done.'}}});
      out({type: 'assistant', message: {model, content: [{type: 'text', text: 'Done.'}]}});
      out({type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 10, duration_api_ms: 8, total_cost_usd: 0.01,
        usage: {input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0},
        modelUsage: {[model]: {inputTokens: 5, outputTokens: 2, cacheReadInputTokens: 4000, cacheCreationInputTokens: 0, costUSD: 0.01, contextWindow: 1000000, maxOutputTokens: 128000}}});
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`);
chmodSync(fake, 0o755);
const until = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check(), 'condition reached'); };

test('controls: set_model, effort, permission mode, context and MCP are real acknowledged requests that update the target', async () => {
  const sessions = new AgentSessions({resolve: name => name === 'claude' ? fake : undefined, scan: async () => [], now: () => Date.now(), claudeHelp: HELP});
  try {
    const launched = sessions.launch('claude', root, {profile: {name: 'p', harness: 'claude', effort: 'high'}});
    assert.ok(launched.ok);
    const session = launched.session;
    await until(() => Boolean(session.telemetry?.catalog));
    const argv = JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8')) as string[];
    assert.ok(argv.includes('--include-partial-messages'), 'streaming is requested when documented');
    assert.deepEqual(argv.slice(argv.indexOf('--effort'), argv.indexOf('--effort') + 2), ['--effort', 'high'], 'a profile effort is a launch flag, never a settings write');
    assert.equal(session.telemetry!.catalog!.models.length, 3);
    assert.equal(session.telemetry!.requested.effort?.value, 'high');

    const model = await sessions.setModel(session.id, 'sonnet');
    assert.deepEqual(model, {ok: true, value: undefined});
    assert.equal(session.telemetry!.requested.model?.value, 'sonnet');
    assert.ok(session.events.some(event => event.kind === 'control' && event.field === 'model'), 'the change is part of the conversation record');
    const effort = await sessions.setEffort(session.id, 'low');
    assert.ok(effort.ok);
    assert.equal((await sessions.setEffort(session.id, 'turbo')).ok, false, 'only documented levels are sent');
    assert.ok((await sessions.setPermissionMode(session.id, 'acceptEdits')).ok);
    assert.equal((await sessions.setPermissionMode(session.id, 'bypassPermissions')).ok, false, 'bypassing every check is never sent');
    const context = await sessions.contextUsage(session.id);
    assert.ok(context.ok && context.value.totalTokens === 4948);
    assert.equal(session.telemetry!.context?.source, 'provider');
    const mcp = await sessions.mcpStatus(session.id);
    assert.ok(mcp.ok && mcp.value.length === 1);
    const refused = await sessions.stopTask(session.id, 'none');
    assert.deepEqual(refused, {ok: false, reason: 'Unsupported control request'}, "the provider's refusal is reported, not hidden");

    let partials = 0;
    sessions.onPartial(() => { partials++; });
    sessions.send(session.id, 'go');
    await until(() => session.state === 'waiting');
    assert.ok(partials > 0, 'streaming text reached the host');
    assert.equal(session.partial, undefined, 'and was replaced by the completed message');
    assert.equal(session.telemetry!.runtime?.model, 'claude-sonnet-5-5', 'the next turn reports the requested model');
    assert.equal(session.telemetry!.runtime?.permissionMode, 'acceptEdits');
    assert.equal(session.telemetry!.usage?.costUsd, 0.01);
    const sent = readFileSync(join(root, 'stdin.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as {type: string; request?: {subtype: string; settings?: unknown}});
    assert.deepEqual(sent.filter(line => line.type === 'control_request').map(line => line.request!.subtype),
      ['initialize', 'set_model', 'apply_flag_settings', 'set_permission_mode', 'get_context_usage', 'mcp_status', 'stop_task']);
    assert.deepEqual(sent.find(line => line.request?.subtype === 'apply_flag_settings')!.request!.settings, {effortLevel: 'low'});
  } finally { sessions.dispose(); }
});
