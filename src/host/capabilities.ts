/** Capabilities of the current frontend. No shell/session serialization. */
export interface TerminalCapabilities {
  enhancedKeyboard: boolean;
  kittyKeyboard: boolean;
  appearanceIntegration: boolean;
  hostConfiguration: boolean;
  graphicsProtocol: 'none' | 'kitty' | 'iterm2' | 'sixel';
  mouseReporting: boolean;
  mouseMovement: boolean;
  clickSupport: boolean;
  textSelectionInteraction: 'native' | 'shift';
  synchronizedOutput: boolean;
  hyperlinks: boolean;
  truecolor: boolean;
}

export const BASELINE_CAPABILITIES: Readonly<TerminalCapabilities> = Object.freeze({
  enhancedKeyboard: false, kittyKeyboard: false, appearanceIntegration: false,
  hostConfiguration: false, graphicsProtocol: 'none', mouseReporting: false,
  mouseMovement: false, clickSupport: false, textSelectionInteraction: 'native',
  synchronizedOutput: false, hyperlinks: false, truecolor: false,
});

/** Profiles are passive hints. Optional keyboard/sync features still use the shared probe. */
const MOUSE_PROFILE = {
  mouseReporting: true, mouseMovement: true, clickSupport: true,
  textSelectionInteraction: 'shift' as const, hyperlinks: true, truecolor: true,
};

export function terminalProfile(env: NodeJS.ProcessEnv): 'ghostty' | 'iterm2' | 'kitty' | 'wezterm' | 'baseline' {
  // An explicit program wins over inherited outer-host variables.
  if (env.TERM_PROGRAM) {
    switch (env.TERM_PROGRAM) {
      case 'ghostty': return 'ghostty';
      case 'iTerm.app': return 'iterm2';
      case 'kitty': return 'kitty';
      case 'WezTerm': return 'wezterm';
      default: return 'baseline';
    }
  }
  if (env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID) return 'kitty';
  if (env.WEZTERM_PANE) return 'wezterm';
  if (env.GHOSTTY_RESOURCES_DIR) return 'ghostty';
  return 'baseline';
}

/** Adapter hints are subordinate to protocol evidence. Multiplexers hide outer hints. */
export function resolveHostCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const result = {...BASELINE_CAPABILITIES};
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(tmux|screen)/u.test(env.TERM ?? '');
  if (!nested && env.TERM !== 'dumb') {
    const profile = terminalProfile(env);
    if (profile !== 'baseline') Object.assign(result, MOUSE_PROFILE);
    if (profile === 'ghostty') Object.assign(result, {enhancedKeyboard: true, kittyKeyboard: true,
      appearanceIntegration: true, hostConfiguration: true});
    if (profile === 'kitty') Object.assign(result, {enhancedKeyboard: true, kittyKeyboard: true, graphicsProtocol: 'kitty'});
    if (profile === 'iterm2' || profile === 'wezterm') result.graphicsProtocol = 'iterm2';
  }
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || /(?:direct|truecolor)/u.test(env.TERM ?? '')) result.truecolor = true;
  if (env.NMSH_HYPERLINKS === '1') result.hyperlinks = true;
  if (env.NMSH_HYPERLINKS === '0' || env.TERM === 'dumb') result.hyperlinks = false;
  return result;
}
