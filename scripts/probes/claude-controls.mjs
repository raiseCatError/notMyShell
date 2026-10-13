/**
 * Disposable probe of Claude Code's documented control requests over the same stream-json transport NMSh's managed
 * adapter uses (the requests the official Agent SDK's Query methods send: initialize, get_context_usage, mcp_status,
 * set_model, apply_flag_settings, set_permission_mode). It records shapes, acknowledgements and the runtime facts
 * that confirm each change; it never prints account identity values, credentials or prompts beyond fixed probe text.
 *
 * NMSH_PROBE_CLAUDE=/path/to/claude CLAUDE_CONFIG_DIR=/path/to/config node scripts/probes/claude-controls.mjs
 */
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

const executable = process.env.NMSH_PROBE_CLAUDE ?? 'claude';
const version = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000}).stdout.trim();
const root = mkdtempSync(join(tmpdir(), 'nmsh-claude-controls-'));
const facts = {version, steps: []};
const note = (step, value) => { facts.steps.push({step, ...value}); console.log(JSON.stringify({step, ...value})); };

const argv = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--setting-sources', '', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--max-budget-usd', '0.5', '--safe-mode', '--no-session-persistence',
  '--include-partial-messages', '--model', 'haiku', '--tools', 'Read,Edit'];

writeFileSync(join(root, 'fixture.txt'), 'alpha\nbeta\ngamma\n', {mode: 0o600});
const child = spawn(executable, argv, {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
const kill = setTimeout(() => { note('timeout', {}); child.kill('SIGKILL'); }, 150000);
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });

const pending = new Map();
const waiters = [];
const seen = [];
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    let event; try { event = JSON.parse(line); } catch { continue; }
    seen.push(event);
    if (event.type === 'control_response') {
      const waiter = pending.get(event.response?.request_id);
      if (waiter) { pending.delete(event.response.request_id); waiter(event.response); }
    } else if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
      note('permission-request', {tool: event.request.tool_name, inputKeys: Object.keys(event.request.input ?? {})});
      child.stdin.write(JSON.stringify({type: 'control_response', response: {subtype: 'success', request_id: event.request_id,
        response: {behavior: 'allow', updatedInput: event.request.input}}}) + '\n');
    }
    for (const waiter of [...waiters]) if (waiter.match(event)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
  }
});

const request = (body, timeout = 30000) => new Promise(resolve => {
  const id = randomUUID();
  const timer = setTimeout(() => { pending.delete(id); resolve({subtype: 'timeout'}); }, timeout);
  pending.set(id, response => { clearTimeout(timer); resolve(response); });
  child.stdin.write(JSON.stringify({type: 'control_request', request_id: id, request: body}) + '\n');
});
const until = (match, timeout = 90000) => new Promise(resolve => {
  const waiter = {match, resolve};
  waiters.push(waiter);
  setTimeout(() => { const at = waiters.indexOf(waiter); if (at >= 0) { waiters.splice(at, 1); resolve(undefined); } }, timeout);
});
const turn = async text => {
  const start = seen.length;
  child.stdin.write(JSON.stringify({type: 'user', message: {role: 'user', content: [{type: 'text', text}]}}) + '\n');
  const result = await until(event => event.type === 'result');
  return {events: seen.slice(start), result};
};
const shape = value => value && typeof value === 'object' ? Object.keys(value).sort() : typeof value;
const summarizeTurn = ({events, result}) => {
  const types = [...new Set(events.map(event => `${event.type}${event.subtype ? `/${event.subtype}` : ''}`))];
  const init = events.find(event => event.type === 'system' && event.subtype === 'init');
  const streamKinds = [...new Set(events.filter(event => event.type === 'stream_event').map(event => event.event?.type))];
  const assistantModels = [...new Set(events.filter(event => event.type === 'assistant').map(event => event.message?.model))];
  const toolResults = events.filter(event => event.type === 'user' && event.tool_use_result !== undefined).map(event => shape(event.tool_use_result));
  const patch = events.find(event => event.type === 'user' && event.tool_use_result?.structuredPatch)?.tool_use_result?.structuredPatch;
  const rateLimits = events.filter(event => event.type === 'rate_limit_event').map(event => ({status: event.rate_limit_info?.status,
    type: event.rate_limit_info?.rateLimitType, utilization: event.rate_limit_info?.utilization, hasReset: typeof event.rate_limit_info?.resetsAt === 'number'}));
  return {types, init: init && {model: init.model, effort: init.effort, permissionMode: init.permissionMode, capabilities: init.capabilities,
    slashCommands: init.slash_commands?.length, tools: init.tools, outputStyle: init.output_style, viewMode: init.view_mode},
  streamKinds, assistantModels, toolResults, patch, rateLimits,
  result: result && {subtype: result.subtype, isError: result.is_error, numTurns: result.num_turns, costUsd: result.total_cost_usd,
    usage: result.usage && {input: result.usage.input_tokens, output: result.usage.output_tokens, cacheRead: result.usage.cache_read_input_tokens, cacheWrite: result.usage.cache_creation_input_tokens},
    modelUsage: result.modelUsage && Object.fromEntries(Object.entries(result.modelUsage).map(([model, usage]) => [model, {contextWindow: usage.contextWindow,
      maxOutputTokens: usage.maxOutputTokens, input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadInputTokens}])),
    text: typeof result.result === 'string' ? result.result.slice(0, 120) : undefined}};
};

try {
  const init = await request({subtype: 'initialize', hooks: {}});
  const body = init.response ?? {};
  note('initialize', {ack: init.subtype, keys: shape(body),
    models: (body.models ?? []).map(model => ({value: model.value, resolved: model.resolvedModel, name: model.displayName, effort: model.supportsEffort,
      levels: model.supportedEffortLevels, fast: model.supportsFastMode, auto: model.supportsAutoMode})),
    commands: {count: body.commands?.length, sample: (body.commands ?? []).slice(0, 60).map(command => `${command.name}${command.builtin ? '*' : ''}${command.argumentHint ? ` ${command.argumentHint}` : ''}`)},
    agents: (body.agents ?? []).map(agent => agent.name), outputStyle: body.output_style, styles: body.available_output_styles,
    accountKeys: shape(body.account), apiProvider: body.account?.apiProvider, subscriptionType: body.account?.subscriptionType});

  const usageBefore = await request({subtype: 'get_context_usage', detail: 'summary'});
  const usage = usageBefore.response ?? {};
  note('context-before-turn', {ack: usageBefore.subtype, error: usageBefore.error, keys: shape(usage), totalTokens: usage.totalTokens, maxTokens: usage.maxTokens,
    rawMaxTokens: usage.rawMaxTokens, percentage: usage.percentage, model: usage.model, autoCompactThreshold: usage.autoCompactThreshold, isAutoCompactEnabled: usage.isAutoCompactEnabled,
    categories: (usage.categories ?? []).map(category => ({name: category.name, tokens: category.tokens, kind: category.kind})),
    memoryFiles: (usage.memoryFiles ?? []).length, mcpTools: (usage.mcpTools ?? []).length, systemTools: (usage.systemTools ?? []).length,
    skills: usage.skills && {total: usage.skills.totalSkills, included: usage.skills.includedSkills, tokens: usage.skills.tokens}, apiUsage: usage.apiUsage});

  const mcp = await request({subtype: 'mcp_status'});
  note('mcp-status', {ack: mcp.subtype, keys: shape(mcp.response), servers: (mcp.response?.mcpServers ?? []).map(server => ({name: server.name, status: server.status}))});

  const first = await turn('Reply with exactly: PROBE-ONE');
  note('turn-haiku', summarizeTurn(first));

  const model = await request({subtype: 'set_model', model: 'sonnet'});
  note('set-model', {ack: model.subtype, error: model.error, response: model.response});
  const effort = await request({subtype: 'apply_flag_settings', settings: {effortLevel: 'low'}});
  note('apply-effort', {ack: effort.subtype, error: effort.error, response: effort.response});
  const mode = await request({subtype: 'set_permission_mode', mode: 'acceptEdits'});
  note('set-permission-mode', {ack: mode.subtype, error: mode.error, response: mode.response});

  const second = await turn('Read fixture.txt, then use Edit to replace beta with BETA. Reply DONE when finished.');
  note('turn-after-changes', summarizeTurn(second));
  note('fixture-after', {content: readFileSync(join(root, 'fixture.txt'), 'utf8')});

  const usageAfter = await request({subtype: 'get_context_usage', detail: 'summary'});
  const after = usageAfter.response ?? {};
  note('context-after-turns', {ack: usageAfter.subtype, totalTokens: after.totalTokens, maxTokens: after.maxTokens, percentage: after.percentage, model: after.model,
    categories: (after.categories ?? []).map(category => ({name: category.name, tokens: category.tokens, kind: category.kind})),
    messageBreakdown: after.messageBreakdown && {toolCall: after.messageBreakdown.toolCallTokens, toolResult: after.messageBreakdown.toolResultTokens,
      assistant: after.messageBreakdown.assistantMessageTokens, user: after.messageBreakdown.userMessageTokens,
      byType: after.messageBreakdown.toolCallsByType}, apiUsage: after.apiUsage});

  const slash = await turn('/context');
  note('slash-context', {types: [...new Set(slash.events.map(event => `${event.type}${event.subtype ? `/${event.subtype}` : ''}`))],
    localOutput: slash.events.filter(event => event.subtype === 'local_command_output' || event.type === 'local_command_output').map(event => shape(event)),
    result: slash.result && {subtype: slash.result.subtype, isError: slash.result.is_error, costUsd: slash.result.total_cost_usd, text: String(slash.result.result ?? '').slice(0, 160)}});

  const reset = await request({subtype: 'apply_flag_settings', settings: {effortLevel: null}});
  note('reset-effort', {ack: reset.subtype, error: reset.error});
} catch (error) {
  note('error', {message: String(error?.message ?? error).slice(0, 300)});
} finally {
  child.stdin.end();
  await new Promise(resolve => { child.once('close', resolve); setTimeout(resolve, 8000).unref(); });
  clearTimeout(kill);
  child.kill('SIGKILL');
  if (stderr.trim()) note('stderr-tail', {text: stderr.slice(-400)});
  rmSync(root, {recursive: true, force: true});
}
