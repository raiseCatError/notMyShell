import {parseWatch, watchSafety} from '../tasks/WatchTasks.js';
import {scriptArgv} from './project.js';
import type {AskContext, AskOutcome} from './types.js';

/**
 * Watch requests in plain language, mapped to the typed /watch actions. The
 * watched command is the person's own words after "watch", the project's own
 * test script, or the command they just ran; it is classified exactly like
 * /watch (refused, confirmed or allowed) and never assembled from model text.
 */
const SECONDS = /\bevery (\d+)\s*(s|sec|secs|seconds?|m|min|minutes?)\b/u;

function interval(text: string): number | undefined {
  const match = SECONDS.exec(text);
  return match ? Number(match[1]) * (/^m/u.test(match[2]!) ? 60_000 : 1000) : undefined;
}

function proposal(command: string, intervalMs: number | undefined): AskOutcome {
  const safety = watchSafety(command);
  if (safety.kind === 'refused') return {kind: 'unsafe', text: safety.reason};
  return {kind: 'proposal', capability: 'project.task', safety: 'read', confidence: 0.9, command: `/watch ${intervalMs ? `--every ${intervalMs / 1000}s ` : ''}${command}`,
    text: `Watch ${command}${intervalMs ? ` every ${intervalMs / 1000}s` : ''}? NMSh runs it on its own schedule and shows what changes${safety.kind === 'confirm' ? ' (it can\'t tell whether this command changes anything; you confirm once more)' : ''}.`,
    action: {kind: 'watch', command, ...(intervalMs ? {intervalMs} : {})}};
}

export function resolveWatch(text: string, raw: string, context: AskContext): AskOutcome | undefined {
  if (/^(?:please )?(?:stop|end|cancel) (?:the |all )?watch(?:ing|es)?\b/u.test(text)) return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.95, direct: true, text: 'Stopping the watch.', action: {kind: 'watchControl', op: /\ball\b/u.test(text) ? 'stopAll' : 'stop'}};
  if (/^(?:please )?pause (?:the )?watch/u.test(text)) return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.95, direct: true, text: 'Pausing the watch.', action: {kind: 'watchControl', op: 'pause'}};
  if (/^(?:please )?(?:resume|unpause) (?:the )?watch/u.test(text)) return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.95, direct: true, text: 'Resuming the watch.', action: {kind: 'watchControl', op: 'resume'}};
  if (/^(?:show |view |open )?(?:me )?(?:the |my )?watch(?:es)?(?: output| results?| status)$|^(?:show|list) (?:the |my )?watch(?:es)?$/u.test(text)) return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.9, direct: true, text: 'Opening /watch.', action: {kind: 'watchControl', op: 'show'}};
  // "keep running the tests every 5 seconds", "watch the tests".
  if (/\b(?:keep running|watch|rerun|re-run|keep checking)\b.*\btests?\b/u.test(text)) {
    const project = context.project;
    const script = project?.kind === 'node' ? ['test', 'tests', 'test:unit'].find(name => project.scripts[name] !== undefined) : undefined;
    const command = script && project ? scriptArgv(project, script).join(' ') : project?.kind === 'rust' ? 'cargo test' : project?.kind === 'go' ? 'go test ./...' : undefined;
    if (!command) return {kind: 'answer', capability: 'project.task', text: 'This project has no test command NMSh recognizes. /watch <command> watches any command you name.'};
    return proposal(command, interval(text));
  }
  // "tell me when this health check changes": the command the person just ran.
  if (/\b(?:tell me|let me know|notify me|alert me) when\b.*\b(?:changes?|is up|is down|passes|fails|recovers)\b/u.test(text)) {
    const last = context.recent?.[0]?.command;
    return last ? proposal(last, interval(text)) : {kind: 'answer', capability: 'project.task', text: 'Run the command once first; then I can watch it for changes.'};
  }
  // "watch git status", "watch npm test every 10 seconds".
  const named = /^(?:please |can you |could you )?(?:watch|keep watching|monitor)\s+(.+)$/u.exec(raw.trim().replace(/[?.!]+$/u, ''));
  if (named) {
    const words = named[1]!.replace(SECONDS, '').trim();
    const parsed = parseWatch(words);
    if (!parsed.command || /^(?:it|this|that|the (?:output|transcript))$/iu.test(parsed.command)) return undefined;
    return proposal(parsed.command, interval(text) ?? parsed.intervalMs);
  }
  return undefined;
}
