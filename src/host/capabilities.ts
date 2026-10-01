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

/** Adapter hints are subordinate to protocol evidence. Multiplexers hide outer hints. */
export function resolveHostCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const result = {...BASELINE_CAPABILITIES};
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(tmux|screen)/u.test(env.TERM ?? '');
  if (!nested && env.TERM !== 'dumb' && (env.TERM_PROGRAM === 'ghostty' || env.GHOSTTY_RESOURCES_DIR)) {
    Object.assign(result, {enhancedKeyboard: true, kittyKeyboard: true, appearanceIntegration: true,
      hostConfiguration: true, mouseReporting: true, mouseMovement: true, clickSupport: true,
      textSelectionInteraction: 'shift', hyperlinks: true, truecolor: true});
  }
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || /(?:direct|truecolor)/u.test(env.TERM ?? '')) result.truecolor = true;
  if (env.NMSH_HYPERLINKS === '1') result.hyperlinks = true;
  if (env.NMSH_HYPERLINKS === '0' || env.TERM === 'dumb') result.hyperlinks = false;
  return result;
}
