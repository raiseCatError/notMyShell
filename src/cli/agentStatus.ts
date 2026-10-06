import {realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import type {CliIo} from './configCommand.js';
import {agentScope, agentStatusDirectory, parseClaudeStatus, pruneAgentStatus, readAgentStatus, readBoundedStdin, writeAgentStatus, type AgentStatusRecord} from '../agents/agentStatus.js';
import {applyClaudeBridge, applyClaudeBridgeRemoval, inspectClaudeBridge, planClaudeBridge, planClaudeBridgeRemoval} from '../agents/claudeStatusLine.js';
import type {ContextFacts} from '../context/facts.js';
import {findExecutable} from '../providers/providers.js';

/**
 * `nmsh agent-status`: the Claude Code status-line bridge and its explicit setup.
 *
 *   nmsh agent-status                 what is configured and the last report
 *   nmsh agent-status claude          (run by Claude Code) record allowlisted status, print a status line
 *   nmsh agent-status setup [--yes]   show the exact settings edit, then apply it on Yes
 *   nmsh agent-status remove [--yes]  remove exactly what setup added
 */
export const AGENT_STATUS_USAGE = `Usage:
  nmsh agent-status                 Show whether Claude Code reports to NMSh, and the last report
  nmsh agent-status setup [--yes]   Use NMSh as Claude Code's status line (shows the exact edit first)
  nmsh agent-status remove [--yes]  Remove exactly the status line NMSh added
  nmsh agent-status claude          The bridge itself: Claude Code runs it with status JSON on stdin

The bridge keeps model, effort, context window, rate-limit, cost and repository
fields in a private file under NMSh's runtime directory, tagged with the NMSh
session Claude runs in. Prompts, transcripts and terminal output are never read.
`;

export interface AgentStatusIo extends CliIo {
  stdin?: NodeJS.ReadableStream;
  /** The NMSh launcher Claude Code should run (defaults to this process's own launcher). */
  launcher?: string;
  now?: () => number;
}

/** This NMSh's launcher: the PATH `nmsh` when it is the same program (stable across upgrades), else the one running now. */
export function currentLauncher(env: NodeJS.ProcessEnv = process.env, argv1 = process.argv[1]): string | undefined {
  if (!argv1 || !isAbsolute(argv1) || !/(?:^|\/)nmsh$/u.test(argv1)) return undefined;
  const onPath = findExecutable('nmsh', env.PATH ?? '');
  try { if (onPath && realpathSync(onPath) === realpathSync(argv1)) return onPath; } catch { /* fall back to the running launcher */ }
  return argv1;
}

/** The compact line Claude Code shows: the same declarative modules and theme roles NMSh's own surfaces use. */
export async function renderAgentStatusLine(record: AgentStatusRecord, options: {env: NodeJS.ProcessEnv; now: number; columns: number}): Promise<string> {
  const [{loadPromptConfiguration}, {moduleDefinition}, {declarativeSegments}, {setIconStyle, getCurrentGlyphMode}, prompt, palette, capabilities, text] = await Promise.all([
    import('../prompt/configuration.js'), import('../context/modules.js'), import('../context/declarative.js'), import('../ui/glyphs.js'),
    import('../prompt/prompt.js'), import('../ui/palette.js'), import('../presentation/capabilities.js'), import('../util/text.js')]);
  const configuration = loadPromptConfiguration();
  setIconStyle(configuration.glyphStyle);
  prompt.setThemeContext(configuration.nmsh.accent, configuration.customTheme);
  const facts = {'agent.claude': {value: {...record, own: true}, source: {capability: 'agent.claude', evidence: 'bridge'}, collectedAt: options.now, freshness: 'fresh',
    trust: 'session', sensitivity: 'public', persistence: 'display-only', resolution: 'cheap'}} as ContextFacts;
  const color = capabilities.colorLevel(options.env) !== 'none';
  const parts = ['nmsh.agents:claude', 'nmsh.agents:claude-limits'].flatMap(id => {
    const definition = moduleDefinition(id);
    return definition ? declarativeSegments(definition, facts, {icons: configuration.nmsh.icons, glyphs: getCurrentGlyphMode(), now: options.now, purpose: 'display'}) : [];
  });
  const plain = parts.map(part => part.text).join('  ');
  const fitted = text.truncateText(plain, Math.max(8, options.columns - 2));
  if (!color || fitted !== plain) return fitted;
  return parts.map(part => {
    const role = prompt.vibrantRoleColors(part.role, configuration.nmsh.palette, configuration.nmsh.gitColors, configuration.nmsh.vibrance);
    return `${palette.foreground(role.background)}${part.text}\u001b[0m`;
  }).join('  ');
}

export async function runAgentStatusCommand(args: string[], io: AgentStatusIo): Promise<number> {
  // Settings paths, commands and plan previews are displayed, never trusted as terminal text (the bridge line itself is NMSh-rendered).
  const {safeContextText} = await import('../context/facts.js');
  const inert = (text: string) => text.split('\n').map(line => safeContextText(line, 400)).join('\n');
  const raw = io;
  if (args[0] !== 'claude') io = {...raw, out: text => raw.out(inert(text)), err: text => raw.err(inert(text))};
  const env = io.env ?? process.env;
  const now = io.now ?? Date.now;
  const [action, ...rest] = args;
  if (action === 'claude') {
    const input = await readBoundedStdin(io.stdin ?? process.stdin);
    let data: unknown;
    try { data = input === undefined ? undefined : JSON.parse(input) as unknown; } catch { data = undefined; }
    const record = parseClaudeStatus(data, now());
    if (!record) return 0;
    const directory = agentStatusDirectory(env);
    try {
      await writeAgentStatus(directory, agentScope(env), record);
      if (Math.floor(now() / 1000) % 600 === 0) await pruneAgentStatus(directory, now());
    } catch { /* the status line still prints; NMSh's surfaces simply have no new report */ }
    try { io.out(`${await renderAgentStatusLine(record, {env, now: now(), columns: Number(env.COLUMNS) || 80})}\n`); }
    catch { io.out(`${record.model ?? 'Claude'}\n`); }
    return 0;
  }
  if (action === undefined || action === 'status') {
    const bridge = inspectClaudeBridge(env);
    io.out(bridge.state === 'configured' ? `Claude Code reports to NMSh (${bridge.settingsPath}).\n`
      : bridge.state === 'conflict' ? `Claude Code has its own status line (${bridge.command}); NMSh does not replace it.\n`
        : bridge.state === 'unreadable' ? `${bridge.settingsPath}: ${bridge.reason}.\n`
          : 'Claude Code does not report to NMSh yet. Run `nmsh agent-status setup` to review the change.\n');
    const last = await readAgentStatus(agentStatusDirectory(env), agentScope(env));
    if (last) io.out(`Last report: ${new Date(last.record.updatedAt).toISOString()}${last.own ? '' : ' (another session)'} · ${[last.record.model, last.record.effort,
      last.record.contextPercent !== undefined ? `ctx ${Math.round(last.record.contextPercent)}%` : undefined].filter(Boolean).join(' · ')}\n`);
    return 0;
  }
  if (action === 'setup' || action === 'remove') {
    const launcher = io.launcher ?? currentLauncher(env);
    if (action === 'setup' && !launcher) { io.err('Run setup through the installed `nmsh` command so Claude Code can find it.\n'); return 1; }
    const planned = action === 'setup' ? planClaudeBridge(launcher!, env) : planClaudeBridgeRemoval(env);
    if ('noop' in planned) { io.out(`${planned.noop}\n`); return 0; }
    if ('refuse' in planned) { io.err(`${planned.refuse}\n`); return 1; }
    io.out(`${planned.plan.path} — ${planned.plan.reason}\n${planned.plan.preview.join('\n')}\n`);
    const yes = rest.includes('--yes') || (io.confirm ? await io.confirm(action === 'setup' ? 'Apply this change to Claude Code settings?' : 'Remove the NMSh status line?') : false);
    if (!yes) { io.out('Nothing was changed.\n'); return rest.includes('--yes') || io.confirm ? 0 : 1; }
    const applied = action === 'setup' ? applyClaudeBridge(planned.plan, launcher!, env) : applyClaudeBridgeRemoval(planned.plan, env);
    if (!applied.ok) { io.err(`${applied.reason}\n`); return 1; }
    io.out(action === 'setup' ? 'Done. Claude Code shows the NMSh status line from its next update; NMSh modules read its reports.\n' : 'Removed.\n');
    return 0;
  }
  io.err(AGENT_STATUS_USAGE);
  return 2;
}
