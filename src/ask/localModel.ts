import type {AskContext, AskOutcome} from './types.js';

/**
 * Questions about NMSh's optional local model, answered from the same facts
 * /llm shows (mode, configured model, service state, how the last Ask was
 * routed). Actions go to /llm, where each one is previewed and confirmed.
 */
export interface LocalModelFacts {
  mode: 'off' | 'auto' | 'always';
  model?: {label: string; runtime: string; owned: boolean};
  state?: string;
  lastRoute?: 'deterministic' | 'model';
  lastInference?: string;
  requests: number;
}

const ABOUT = /\b(?:local (?:model|llm|understanding|intelligence)|qwen|llama(?:\.cpp)?|language model|the model|which model|what model|your model|model you)\b/u;

function open(text: string, why: string): AskOutcome {
  return {kind: 'proposal', capability: 'understanding.set', safety: 'navigate', confidence: 0.95, text: `${why} Opening /llm.`,
    action: {kind: 'slash', slash: {kind: 'llm'}, label: '/llm'}};
}

export function resolveLocalModel(text: string, context: AskContext): AskOutcome | undefined {
  const facts = context.llm;
  if (!facts || !ABOUT.test(text)) return undefined;
  const configured = facts.model ? `${facts.model.label} (${facts.model.runtime}${facts.model.owned ? ', NMSh managed' : ', found on this machine'})` : undefined;
  if (/\b(?:remove|delete|uninstall|get rid of)\b/u.test(text)) {
    return open(text, facts.model?.owned ? 'Removing the model NMSh downloaded is in /llm (it shows the exact file and asks first).'
      : 'NMSh only removes a model it downloaded itself; models you or other tools installed stay.');
  }
  if (/\b(?:find|look for|detect|search for|other|better|bigger|stronger)\b.*\bmodels?\b/u.test(text)) return open(text, 'Detecting compares the models on this machine with the recommended one.');
  if (/\b(?:stop|unload|kill|shut down)\b/u.test(text)) return open(text, facts.state && /ready|busy|loading/iu.test(facts.state) ? 'Stop model unloads it now; it loads again on next use.' : 'No model is loaded right now.');
  if (/\b(?:set ?up|install|download|configure|change|switch)\b/u.test(text)) return open(text, 'Model setup detects what is here first.');
  const state = facts.mode === 'off' ? 'Local understanding is Off: no model is used.'
    : !configured ? `Local understanding is ${facts.mode === 'auto' ? 'Auto' : 'Always'}, but no model is set up yet, so Ask uses only its built-in understanding.`
    : `${configured} · ${facts.state ?? 'not running (starts on first use)'} · mode ${facts.mode === 'auto' ? 'Auto (only when built-in understanding is unsure)' : 'Always'}.`;
  const route = facts.lastRoute ? `\nThe last Ask ${facts.lastRoute === 'model' ? `used ${facts.model?.label ?? 'the model'}` : 'was resolved deterministically, without the model'}.` : '';
  const inference = facts.lastInference ? `\nLast inference: ${facts.lastInference}. Requests this window: ${facts.requests}.` : '';
  return {kind: 'answer', capability: 'understanding.set', text: `${state}${route}${inference}`,
    follow: {key: 'llm:open', label: 'Open /llm', outcome: {kind: 'proposal', capability: 'understanding.set', safety: 'navigate', confidence: 1, text: 'Opening /llm.', action: {kind: 'slash', slash: {kind: 'llm'}, label: '/llm'}}}};
}
