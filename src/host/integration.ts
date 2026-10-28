import {applyHostAppearance, planHostAppearance, planHostRemoval, readHostAppearance, appearanceGuidance, type AppearanceRead, type AppearancePlanResult, type HostAppearancePlan, type HostAppearanceSettings} from '../appearance/hostAppearance.js';
import {terminalProfile} from './capabilities.js';
import {installGhosttyKeybinding} from '../keyboard/ghosttyKeyboard.js';
import {resolveHostCapabilities} from './capabilities.js';

/** Explicit panel actions only. Constructing an adapter never reads or writes preferences. */
export interface HostIntegration {
  readAppearance(): Promise<AppearanceRead>;
  planAppearance(settings: HostAppearanceSettings): AppearancePlanResult;
  planAppearanceRemoval(): AppearancePlanResult;
  applyAppearance(plan: HostAppearancePlan): ReturnType<typeof applyHostAppearance>;
  /** Present only where NMSh can install a host key binding (Ghostty); other hosts show guidance. */
  installKeyboard?(): Promise<{success: boolean; error?: string}>;
  keyboardReload?: string;
  appearanceRestart: string;
}

export function hostIntegration(env: NodeJS.ProcessEnv = process.env): HostIntegration | undefined {
  if (!resolveHostCapabilities(env).hostConfiguration) return undefined;
  const profile = terminalProfile(env);
  if (profile !== 'kitty' && profile !== 'ghostty') return undefined;
  const context = {env, platform: process.platform};
  return {
    readAppearance: async () => readHostAppearance(profile, context),
    planAppearance: settings => planHostAppearance(profile, settings, context),
    planAppearanceRemoval: () => planHostRemoval(profile, context),
    applyAppearance: applyHostAppearance,
    ...(profile === 'ghostty' ? {installKeyboard: installGhosttyKeybinding, keyboardReload: 'Reload Ghostty config (Cmd+Shift+,) for changes to take effect.'} : {}),
    appearanceRestart: appearanceGuidance(profile, process.platform),
  };
}

export function keyboardGuidance(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TERM_PROGRAM === 'vscode') return [
    'VS Code sends identical bytes for Enter and Shift+Enter.',
    'To enable Shift+Enter, add this to your VS Code keybindings.json:', '',
    '  { "key": "shift+enter",',
    '    "command": "workbench.action.terminal.sendSequence",',
    '    "args": { "text": "\\u001b[13;2u" },',
    '    "when": "terminalFocus" }', '',
    'Ctrl+J always inserts a newline without configuration.',
  ].join('\n');
  return 'No keyboard configuration adapter for this host. Ctrl+J inserts a newline; Ctrl+W deletes a word; Alt+A selects the editor.';
}

/** Keep bootstrap compatibility hints out of shell core. */
export const BOOTSTRAP_TERM_COMPATIBILITY = `if [[ "$TERM" == "xterm-ghostty" ]]; then
  export TERM="xterm-256color"
fi`;
