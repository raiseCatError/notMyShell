import {
  DEFAULT_PROMPT_CONFIGURATION, minimalPromptConfiguration, normalizePromptConfiguration, STARTING_POINT_IDS,
  type PromptConfiguration, type StartingPointId,
} from '../../prompt/configuration.js';
import type {SkyMood} from '../../idle/auroraMoods.js';
import type {EnvironmentEvidence} from '../environment/detect.js';
import {keepExistingDraft, type KeepState} from '../environment/keepExisting.js';

/**
 * The four starting points, each a legitimate way to use NMSh. Highlighting
 * one only changes the selector's draft; nothing applies until the explicit
 * review and Apply. The configuration records which one was applied as a
 * label only.
 */
export const STARTING_POINTS = STARTING_POINT_IDS;
export type {StartingPointId};
export type MinimalLayout = 'twoLine' | 'oneLine';

/** The sky's mood follows the highlighted choice. */
export const STARTING_POINT_MOODS: Readonly<Record<StartingPointId, SkyMood>> = {recommended: 'aurora', minimal: 'calm', customize: 'spectrum', existing: 'out'};

export interface StartingPointCopy {
  key: string;
  title: string;
  short: string;
  eyebrow: string;
  /** One line under the title in the list. */
  line: string;
  lead: string;
  features: readonly string[];
}

export const STARTING_POINT_COPY: Readonly<Record<StartingPointId, StartingPointCopy>> = {
  recommended: {key: '1', title: 'NMSh Recommended', short: 'Recommended', eyebrow: 'EXPRESSIVE', line: 'Expressive, colorful, complete',
    lead: 'Color, motion and smart output, ready from your very first command.',
    features: ['Lavender powerline prompt with Git', 'Rich motion for launches and results', 'Smart folding keeps long output tidy', 'Vespyr greets every new session']},
  minimal: {key: '2', title: 'Minimal Terminal', short: 'Minimal', eyebrow: 'QUIET', line: 'NMSh\'s quiet look, nothing moves',
    lead: 'A plain prompt, ordinary output and no decoration. Everything useful, nothing loud.',
    features: ['A plain prompt that stays out of the way', 'No greeting, effects or animation', 'Output exactly as programs print it', 'Every NMSh feature, one keystroke away']},
  customize: {key: '3', title: 'Customize Everything', short: 'Customize', eyebrow: 'TAILORED', line: 'A guided tour of every setting',
    lead: 'Walk through every NMSh setting with a live preview of each choice. Apply once, at the end.',
    features: ['Every setting, one clear step at a time', 'A live preview beside each choice', 'Nothing changes until you apply', 'Pick up any step later with /setup']},
  existing: {key: '4', title: 'Keep Existing', short: 'Keep Existing', eyebrow: 'YOUR OWN', line: 'Your setup, plus NMSh\'s features',
    lead: 'Your prompt, colors and tools stay exactly as you set them. NMSh adds its features around them.',
    features: ['Your own prompt: Starship, Powerlevel10k or Oh My Posh', 'Your terminal colors, font and cursor', 'Your shell, aliases and functions', 'Plus NMSh search, queue, Copy and folding']},
};

/** What happens with optional tools after a starting point applies (T on the review). Every install still asks first. */
export interface StartupToolOption {
  choice: 'keep' | 'recommended' | 'individual';
  /** Tick the missing recommended tools once they are verified. */
  preselect: boolean;
  label: string;
  short: string;
  detail: string;
}
const CHOOSE: StartupToolOption = {choice: 'individual', preselect: false, label: 'Choose tools individually', short: 'choose tools', detail: 'The full list, nothing selected.'};
export const STARTUP_TOOL_OPTIONS: Readonly<Record<Exclude<StartingPointId, 'customize'>, readonly StartupToolOption[]>> = {
  recommended: [
    {choice: 'recommended', preselect: true, label: 'Review and install recommended tools', short: 'install recommended', detail: 'Selects what\'s missing. Asks before installing.'},
    CHOOSE,
    {choice: 'keep', preselect: false, label: 'Skip tools', short: 'skip tools', detail: 'Nothing is installed. /tools anytime.'},
  ],
  minimal: [
    {choice: 'keep', preselect: false, label: 'Skip tools', short: 'skip tools', detail: 'Your tools stay as they are. /tools anytime.'},
    {choice: 'recommended', preselect: false, label: 'Review recommended tools', short: 'review tools', detail: 'Shows what\'s missing. Nothing is selected.'},
    CHOOSE,
  ],
  existing: [
    {choice: 'keep', preselect: false, label: 'Skip tools', short: 'skip tools', detail: 'Your tools stay as they are.'},
    {...CHOOSE, label: 'Browse tools', short: 'browse tools'},
  ],
};

export const startingPointAt = (index: number): StartingPointId => STARTING_POINTS[Math.max(0, Math.min(STARTING_POINTS.length - 1, Math.floor(index)))]!;
export const startingPointIndex = (id: StartingPointId | undefined): number => Math.max(0, id ? STARTING_POINTS.indexOf(id) : 0);

export interface StartingPointOptions {
  layout: MinimalLayout;
  /** Keep Existing: the answer to its question and whether to re-detect a configured install. */
  keep?: KeepState;
  /** Keep Existing: the read-only detection result, once it is in. */
  evidence?: EnvironmentEvidence;
}

/**
 * A preset's presentation over the saved configuration: shell, tools,
 * integrations, accessibility and the queue's output display are retained.
 * Recommended and Minimal keep cursor effects Off.
 */
function presetDraft(id: 'recommended' | 'minimal', saved: PromptConfiguration, layout: MinimalLayout): PromptConfiguration {
  const preset = id === 'minimal' ? minimalPromptConfiguration(layout) : structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  return normalizePromptConfiguration({...saved, provider: 'nmsh', welcome: preset.welcome,
    motion: preset.motion, transcript: preset.transcript, transcriptPresentation: preset.transcriptPresentation,
    outputFolding: preset.outputFolding, composerPosition: preset.composerPosition, composerLayout: preset.composerLayout, placement: preset.placement,
    composerDividers: preset.composerDividers, spacing: preset.spacing, gap: preset.gap,
    nmsh: {...saved.nmsh, ...preset.nmsh}, uiChrome: preset.uiChrome,
    presentation: {...saved.presentation, ...preset.presentation, reducedMotion: saved.presentation.reducedMotion},
    cursor: {...preset.cursor, shape: saved.cursor.shape, blink: saved.cursor.blink,
      ...(id === 'recommended' && saved.cursor.particles.colors.length ? {particles: saved.cursor.particles} : {})},
    idleVisuals: {...saved.idleVisuals, timeout: 0}, statusStrip: {...saved.statusStrip, enabled: false},
    liveActivity: {...saved.liveActivity, style: preset.liveActivity.style}, terminalTitle: preset.terminalTitle,
    queue: {...saved.queue, ...preset.queue, outputDisplay: saved.queue.outputDisplay}, queueFailurePolicy: 'pause'});
}

/** The draft a starting point would apply. Customize starts from the saved configuration; Keep Existing from what was detected. */
export function startingPointDraft(id: StartingPointId, saved: PromptConfiguration, options: StartingPointOptions): PromptConfiguration {
  switch (id) {
    case 'recommended': case 'minimal': return presetDraft(id, saved, options.layout);
    case 'customize': return structuredClone(saved);
    case 'existing': return keepExistingDraft(saved, options.evidence, options.keep?.answer ?? 0, options.keep?.redetect ?? false);
  }
}
