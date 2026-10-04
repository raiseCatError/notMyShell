import {CONCEPTS, conceptDestination, GUIDE_SECTIONS, type Concept} from './concepts.js';
import type {AskContext, AskOption, AskOutcome} from './types.js';

/**
 * The interactive NMSh guide, built from the concept catalog (one source for
 * /guide, /ask guide, /ask help and Ask's feature answers). Each section says
 * what a feature is, why it exists, where it lives, and a few current facts;
 * its choices open the real surfaces, whose own confirmation rules apply.
 */

const byId = new Map(CONCEPTS.map(concept => [concept.id, concept]));
export const GUIDE_REQUEST = /^(?:\/?guide(?: me)?(?: through (?:nmsh|this))?|show me what (?:nmsh|you) can do|what can nmsh do|nmsh guide|tour|give me a tour)$/u;
export const HELP_REQUEST = /^(?:help|what can you do|what can ask do|how do i use ask|ask help)$/u;

function openOption(concept: Concept): AskOption | undefined {
  const target = concept.configure ?? concept.open;
  const slash = target ? conceptDestination({...concept, open: target}) : undefined;
  if (!slash || concept.support === 'unsupported') return undefined;
  return {key: `guide:open:${concept.id}`, label: `Open ${target} (${concept.label})`,
    outcome: {kind: 'proposal', capability: 'feature.open', safety: 'navigate', confidence: 0.95, text: `Opening ${target}.`, action: {kind: 'slash', slash, label: target!}}};
}

export function guideOutcome(context?: Pick<AskContext, 'nmsh'>): AskOutcome {
  return {kind: 'choose', reason: 'missing', capability: 'help.guide', question: 'NMSh Guide · what would you like to explore?',
    options: [...GUIDE_SECTIONS.map(section => ({key: `guide:${section.id}`, label: section.title, outcome: sectionOutcome(section.id, context)})),
      {key: 'guide:everything', label: 'Everything NMSh can do', outcome: everythingOutcome(context)}]};
}

export function sectionOutcome(id: string, context?: Pick<AskContext, 'nmsh'>): AskOutcome {
  const section = GUIDE_SECTIONS.find(item => item.id === id)!;
  const concepts = section.concepts.map(conceptId => byId.get(conceptId)!).filter(Boolean);
  const lines = [section.title, section.why, ''];
  for (const concept of concepts) {
    const where = concept.support === 'unsupported' ? 'not supported' : concept.configure ?? concept.open ?? concept.where ?? '';
    const fact = context?.nmsh?.[concept.id];
    lines.push(`${concept.label}${where ? ` · ${where}` : ''}${fact ? ` · now: ${fact}` : ''}`, `  ${concept.description}`);
  }
  const next = concepts.map(openOption).filter((option): option is AskOption => Boolean(option)).slice(0, 4);
  next.push({key: 'guide:back', label: 'Back to the guide', refine: 'guide'});
  return {kind: 'answer', capability: 'help.guide', text: lines.join('\n'), next};
}

/** Every public concept in one compact list, grouped by guide section. */
export function everythingOutcome(_context?: Pick<AskContext, 'nmsh'>): AskOutcome {
  const lines = ['Everything NMSh can do'];
  for (const section of GUIDE_SECTIONS) {
    const named = section.concepts.map(id => byId.get(id)!).filter(concept => concept && concept.support !== 'unsupported');
    if (named.length) lines.push('', section.title, ...named.map(concept => `  ${concept.label}${concept.open ? ` · ${concept.open}` : ''}`));
  }
  return {kind: 'answer', capability: 'help.guide', text: lines.join('\n'), next: [{key: 'guide:back', label: 'Back to the guide', refine: 'guide'}]};
}

/** /ask help: what Ask itself does, with examples, and the way into the full guide. */
export function askHelpOutcome(): AskOutcome {
  return {kind: 'answer', capability: 'help.capabilities', text: [
    'Ask can help with:',
    '  NMSh settings and features    Commands and syntax',
    '  Git in this repository        Files and your editor',
    '  Sessions and transcripts      Providers and tools',
    '  What you just ran             Config files: open, add or update settings (shown first, never removed)',
    '',
    'Try: "what did I just do?" · "how do I push this branch?" · "what is zoxide?" · "change my ghost text" · "show untracked files" · "what does git clean -n do?"',
    '',
    'Ask never runs destructive or arbitrary commands. Anything that changes something is shown first and needs your Yes.',
  ].join('\n'), next: [{key: 'guide:open', label: 'Open the full NMSh guide', refine: 'guide'}]};
}

/** Strong, factual starters for an empty /ask: a dirty repository, a recent command; otherwise the general ones. */
export function askStarters(context: Pick<AskContext, 'repoRoot' | 'dirty' | 'recent' | 'branch'>): AskOption[] {
  const starters: AskOption[] = [];
  if (context.repoRoot && context.dirty) starters.push({key: 'start:status', label: 'Show Git status', refine: 'git status'});
  if (context.recent?.length) starters.push({key: 'start:last', label: 'Explain my recent command', refine: 'what did i just do'});
  if (context.repoRoot && context.branch) starters.push({key: 'start:branch', label: 'Help with this branch', refine: 'how do i push this branch'});
  if (!context.repoRoot) starters.push({key: 'start:settings', label: 'Open settings', refine: 'open settings'}, {key: 'start:can', label: 'What can NMSh do?', refine: 'help'});
  starters.push({key: 'start:guide', label: 'Guide me through NMSh', refine: 'guide'});
  return starters.slice(0, 4);
}
