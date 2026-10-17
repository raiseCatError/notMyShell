import {DEFAULT_CURSOR, minimalPromptConfiguration, normalizePromptConfiguration, type PromptConfiguration} from '../../prompt/configuration.js';
import {displayPath, type EnvironmentEvidence, type ProviderEvidence} from './detect.js';

/**
 * Keep Existing: what NMSh found, the one honest question it may need, and a
 * draft that keeps what the person has. NMSh never runs startup files,
 * installs, downloads, edits rc/terminal/theme files or enables two prompts.
 */
export type KeepAnswer = 'starship' | 'powerlevel10k' | 'ohMyPosh' | 'none' | 'native' | 'minimal';
export interface KeepOption {answer: KeepAnswer; label: string; detail: string}
export interface KeepFinding {mark: 'ok' | 'warn'; what: string; why: string}
export interface KeepQuestion {kind: 'several' | 'none'; title: string; options: readonly KeepOption[]; note: string}
export interface KeepPlan {
  found: readonly KeepFinding[];
  question?: KeepQuestion;
  /** Exactly one active prompt: kept without asking. */
  kept?: ProviderEvidence;
  /** A configured install: Keep Existing changes nothing unless it is re-detected. */
  noop: boolean;
}

/** Keep Existing's answer and whether a configured install asked to re-detect. */
export interface KeepState {answer: number; redetect: boolean}

const COUNTS = ['No', 'One', 'Two', 'Three'];
const versionOf = (text: string | undefined) => /(\d+(?:\.\d+)+)/u.exec(text ?? '')?.[1];

/** A path as shown: the home directory as `~`. */
const shown = (path: string | undefined, evidence: EnvironmentEvidence): string | undefined =>
  path && evidence.home ? displayPath(path, evidence.home) : path;

/** The shell's main startup file, as shown. */
function mainFile(evidence: EnvironmentEvidence): string {
  if (evidence.shell.id === 'fish') return '~/.config/fish/config.fish';
  if (evidence.shell.id === 'bash') return evidence.files.find(file => file.endsWith('.bashrc')) ?? '~/.bashrc';
  return evidence.files.find(file => file.endsWith('.zshrc')) ?? '~/.zshrc';
}

function promptFinding(prompt: ProviderEvidence, evidence: EnvironmentEvidence): KeepFinding {
  const version = versionOf(prompt.version);
  switch (prompt.state) {
    case 'active': return {mark: 'ok', what: `${prompt.label}${version ? ` ${version}` : ''}`, why: `started by your ${prompt.startedBy ?? mainFile(evidence)}`};
    case 'broken': return {mark: 'warn', what: prompt.label, why: `started by ${prompt.startedBy ?? mainFile(evidence)} but not installed`};
    case 'configured': return {mark: 'warn', what: prompt.label,
      why: `${shown(prompt.configPath, evidence) ?? 'configured'}, not started${prompt.runnable ? '' : ' · not installed'}`};
    case 'installed': return {mark: 'warn', what: prompt.label, why: 'installed, not started'};
  }
}

/** Everything found, read-only, in one list: shell, prompts, custom prompts, tools, the terminal. */
function findings(evidence: EnvironmentEvidence): KeepFinding[] {
  const found: KeepFinding[] = [];
  const rc = mainFile(evidence).replace(/^~\//u, '');
  found.push(evidence.shell.id ? {mark: 'ok', what: evidence.shell.label, why: `your ${rc}, aliases and functions`}
    : {mark: 'warn', what: evidence.shell.label, why: 'NMSh runs zsh, fish or bash; it keeps its own default shell'});
  for (const prompt of evidence.prompts) found.push(promptFinding(prompt, evidence));
  for (const custom of evidence.custom) found.push({mark: 'warn', what: custom.label, why: `set in ${custom.where}`});
  const active = evidence.tools.filter(tool => tool.state === 'active');
  if (active.length) found.push({mark: 'ok', what: active.map(tool => tool.label).join(' and '), why: active.map(tool => tool.role.toLowerCase()).join(' and ')});
  for (const tool of evidence.tools.filter(item => item.state === 'broken')) found.push({mark: 'warn', what: tool.label, why: `started by ${tool.startedBy ?? mainFile(evidence)} but not installed`});
  found.push({mark: 'ok', what: evidence.host ?? 'Your terminal', why: 'your theme, font and cursor'});
  return found;
}

/** The plan Keep Existing reviews. Without evidence yet, it has nothing to say. */
export function keepExistingPlan(evidence: EnvironmentEvidence | undefined, saved: PromptConfiguration, redetect = false): KeepPlan {
  const noop = saved.onboardingComplete && !redetect;
  if (!evidence) return {found: [], noop};
  const found = findings(evidence);
  if (noop) return {found, noop};
  const active = evidence.prompts.filter(prompt => prompt.state === 'active');
  if (active.length === 1) return {found, kept: active[0], noop};
  if (active.length > 1) {
    return {found, noop, question: {kind: 'several', title: `${COUNTS[active.length] ?? active.length} prompts found. Which one should NMSh keep?`,
      options: active.map(prompt => ({answer: prompt.id, label: prompt.label, detail: `started by your ${prompt.startedBy ?? mainFile(evidence)}`})),
      note: 'One prompt runs at a time. Your files stay exactly as they are either way.'}};
  }
  // Prompts NMSh can draw that your shell does not start: configured ones, and Starship or Oh My Posh with their
  // own defaults (Powerlevel10k needs its configuration first).
  const offered = evidence.prompts.filter(prompt => prompt.runnable && (prompt.state === 'configured' || (prompt.state === 'installed' && prompt.id !== 'powerlevel10k')));
  const broken = evidence.prompts.find(prompt => prompt.state === 'broken');
  const title = evidence.custom.length ? 'NMSh can\'t draw custom prompts yet. What should it show?'
    : broken ? `${broken.label} is started but not installed. What should NMSh show?`
    : 'No prompt tool is started. What should NMSh show?';
  const options: KeepOption[] = [{answer: 'none', label: 'Composer only', detail: 'no prompt row; nothing imitates yours'},
    ...offered.map(prompt => ({answer: prompt.id, label: prompt.label, detail: prompt.state === 'configured'
      ? `your config${prompt.configPath ? ` in ${shown(prompt.configPath, evidence)}` : ''}; not started by your shell` : 'installed with its own defaults; not started by your shell'})),
    {answer: 'native', label: 'NMSh Native', detail: 'NMSh\'s full prompt: folder, Git and status'},
    {answer: 'minimal', label: 'NMSh Minimal', detail: 'NMSh\'s quiet prompt'}];
  return {found, noop, question: {kind: 'none', title, options, note: `Outside NMSh your prompt is unchanged. Nothing is written to ${mainFile(evidence)}.`}};
}

/** The answer a plan resolves to: the kept prompt, the chosen option, or (for anything out of range) the first, the default. */
export function keepAnswer(plan: KeepPlan, answer: number): KeepAnswer {
  if (plan.kept) return plan.kept.id;
  const options = plan.question?.options ?? [];
  return options[Number.isInteger(answer) ? answer : -1]?.answer ?? options[0]?.answer ?? 'none';
}

/** Only what detection found: the shell, the prompt (with its own config), and active zoxide/Atuin as providers. */
function detectedSettings(saved: PromptConfiguration, evidence: EnvironmentEvidence | undefined, answer: KeepAnswer): Partial<PromptConfiguration> {
  const prompt = evidence?.prompts.find(item => item.id === answer);
  const active = (id: 'zoxide' | 'atuin') => evidence?.tools.some(tool => tool.id === id && tool.state === 'active') ?? false;
  const providers: Partial<PromptConfiguration> = {...(evidence?.shell.id ? {shellBackend: evidence.shell.id} : {}),
    navigation: active('zoxide') ? 'zoxide' : saved.navigation, history: active('atuin') ? 'atuin' : saved.history};
  switch (answer) {
    case 'starship': return {...providers, provider: 'starship', starship: {configPath: prompt?.configPath ?? null}};
    case 'powerlevel10k': return {...providers, provider: 'powerlevel10k',
      powerlevel10k: {themePath: prompt?.themePath ?? null, configPath: prompt?.configExists ? prompt.configPath ?? null : null}};
    case 'ohMyPosh': return {...providers, provider: 'ohMyPosh', ohMyPosh: {configPath: prompt?.configPath ?? null}};
    case 'none': return {...providers, provider: 'none'};
    case 'native': return {...providers, provider: 'nmsh'};
    case 'minimal': {
      const quiet = minimalPromptConfiguration('twoLine');
      return {...providers, provider: 'nmsh', nmsh: {...saved.nmsh, style: quiet.nmsh.style, styleProfiles: quiet.nmsh.styleProfiles},
        placement: quiet.placement, spacing: quiet.spacing, gap: quiet.gap};
    }
  }
}

/**
 * Keep Existing's draft. On a configured install it changes nothing unless
 * re-detected, and re-detection changes only what it detected. A fresh install
 * keeps the person's shell, prompt and tools and adds nothing loud: Grayscale
 * chrome and syntax, no Chroma, effects, shimmer or idle visuals, clean motion,
 * the host cursor, no welcome, a Normal transcript and a Flow, Two-line
 * composer, no terminal title, Theme Bridge as it was.
 */
export function keepExistingDraft(saved: PromptConfiguration, evidence: EnvironmentEvidence | undefined, answer: number, redetect: boolean): PromptConfiguration {
  if (saved.onboardingComplete && !redetect) return structuredClone(saved);
  const plan = keepExistingPlan(evidence, saved, redetect);
  const detected = detectedSettings(saved, evidence, keepAnswer(plan, answer));
  if (saved.onboardingComplete) return normalizePromptConfiguration({...saved, ...detected});
  const quiet = minimalPromptConfiguration('twoLine');
  return normalizePromptConfiguration({...saved, ...detected,
    uiChrome: {...saved.uiChrome, source: 'custom', preset: 'grayscale'},
    syntax: {...saved.syntax, colors: 'grayscale'},
    presentation: {...saved.presentation, preset: 'off', effectsOff: true, shimmer: 'off', autoEffects: false},
    idleVisuals: {...saved.idleVisuals, timeout: 0},
    motion: quiet.motion,
    cursor: structuredClone(DEFAULT_CURSOR),
    welcome: 'none', transcriptPresentation: 'normal', composerPosition: 'flow', composerLayout: 'twoLine',
    placement: detected.placement ?? 'composer', composerDividers: false,
    liveActivity: {...saved.liveActivity, style: 'classic'},
    statusStrip: {...saved.statusStrip, enabled: false},
    terminalTitle: 'off',
    themeBridge: saved.themeBridge,
  });
}

export {displayPath};
