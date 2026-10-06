import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {agentStatusDirectory, readAgentStatus, type AgentStatusRecord} from '../../agents/agentStatus.js';

/**
 * Claude Code context through its documented status-line interface, as kept by
 * NMSh's bridge. The fact describes this session's agent when one reported
 * here, otherwise the most recent report from any session (`own: false`), so
 * account-level rate limits stay visible after the agent exits. Values carry
 * their own report time: an idle or finished agent is shown as last known,
 * never as live.
 */
export interface AgentFact extends Omit<AgentStatusRecord, 'schema'> {
  own: boolean;
}

const PRIVATE = {sensitivity: 'private', persistence: 'display-only'} as const;

export const claudeAgent = defineCapability<AgentFact>({
  id: 'agent.claude',
  title: 'Claude Code session status',
  reads: ['the private NMSh agent-context record written by `nmsh agent-status claude` when Claude Code runs it as its status line (never terminal output, prompts or transcripts)'],
  scope: 'session', family: 'agent', cost: 'bounded-async', trust: 'session', sensitivity: 'public', persistence: 'display-only',
  fieldPolicy: {sessionName: PRIVATE, costUsd: PRIVATE, session: PRIVATE},
  fields: ['harness', 'updatedAt', 'own', 'model', 'modelId', 'effort', 'fast', 'contextPercent', 'contextWindow', 'inputTokens', 'outputTokens', 'cacheReadTokens',
    'cacheWriteTokens', 'fiveHourPercent', 'fiveHourResetsAt', 'sevenDayPercent', 'sevenDayResetsAt', 'spendPercent', 'spendResetsAt', 'durationMs', 'costUsd',
    'linesAdded', 'linesRemoved', 'repo', 'worktree', 'pr', 'prReview', 'sessionName', 'agentName', 'version', 'session'],
  env: [], ttlMs: 5_000, refreshMs: 15_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {harness: 'claude', updatedAt: Date.UTC(2026, 9, 6, 9, 41), own: true, model: 'Opus', effort: 'max', contextPercent: 43, contextWindow: 200_000,
    fiveHourPercent: 61, fiveHourResetsAt: Date.UTC(2026, 9, 6, 12, 0), sevenDayPercent: 18, sevenDayResetsAt: Date.UTC(2026, 9, 10), repo: 'raiseCatError/notMyShell', pr: 325, prReview: 'pending'},
  async resolve(context) {
    const found = await readAgentStatus(agentStatusDirectory(), context.session);
    if (!found) return undefined;
    const {schema: _schema, ...record} = found.record;
    return {value: {...record, own: found.own}, evidence: found.own ? 'Claude Code status bridge (this session)' : 'Claude Code status bridge (another session)'};
  },
});

export const AGENT_CAPABILITIES = [claudeAgent] as CapabilityDefinition<unknown>[];
