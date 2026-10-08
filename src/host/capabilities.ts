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
  /**
   * The host is a multiplexer that already draws to the real terminal in its own synchronized
   * updates (tmux). NMSh then never wraps frames in DEC 2026 itself, whatever the probe says: measured
   * with tmux 3.7, an application's own 2026 block made tmux emit intermediate cursor positions after
   * its sync block, visibly, which cursor shaders and trails on the outer terminal animate.
   */
  hostSynchronizes?: true;
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

export type TerminalProfile = 'ghostty' | 'iterm2' | 'kitty' | 'wezterm' | 'zed' | 'windows-terminal' | 'baseline';

export function terminalProfile(env: NodeJS.ProcessEnv): TerminalProfile {
  // An explicit program wins over inherited outer-host variables.
  if (env.TERM_PROGRAM) {
    switch (env.TERM_PROGRAM) {
      case 'ghostty': return 'ghostty';
      case 'iTerm.app': return 'iterm2';
      case 'kitty': return 'kitty';
      case 'WezTerm': return 'wezterm';
      case 'zed': return 'zed';
      default: return 'baseline';
    }
  }
  if (env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID) return 'kitty';
  if (env.WEZTERM_PANE) return 'wezterm';
  if (env.GHOSTTY_RESOURCES_DIR) return 'ghostty';
  if (env.ZED_TERM) return 'zed';
  // Windows Terminal exports WT_SESSION and forwards it into WSL through WSLENV.
  if (env.WT_SESSION) return 'windows-terminal';
  return 'baseline';
}

/**
 * Zed's integrated terminal (alacritty_terminal) implements the standard
 * xterm button and SGR mouse modes, so wheel and click reports reach NMSh
 * while it owns the alternate screen; Shift keeps Zed's own selection.
 * Movement tracking is not needed. Hyperlinks stay opt-in (NMSH_HYPERLINKS)
 * until physical QA confirms them; truecolor follows COLORTERM, which Zed sets.
 */
const ZED_PROFILE = {
  mouseReporting: true, mouseMovement: false, clickSupport: true, textSelectionInteraction: 'shift' as const,
};

/**
 * Windows Terminal (seen from WSL through WT_SESSION): standard SGR mouse
 * reports with Shift selection, truecolor and OSC 8 hyperlinks. No movement
 * tracking, graphics or enhanced keyboard is assumed; probes decide the rest.
 */
const WINDOWS_TERMINAL_PROFILE = {
  mouseReporting: true, mouseMovement: false, clickSupport: true, textSelectionInteraction: 'shift' as const, hyperlinks: true, truecolor: true,
};

/**
 * Hosts whose documentation describes Kitty graphics support: Kitty, Ghostty
 * and WezTerm. For these NMSh sends the graphics query; support is still only
 * assumed from the reply (Kitty itself keeps its long-standing hint).
 */
export function shouldProbeGraphics(env: NodeJS.ProcessEnv): boolean {
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(tmux|screen)/u.test(env.TERM ?? '');
  return !nested && env.NMSH_IMAGES !== '0' && ['kitty', 'ghostty', 'wezterm'].includes(terminalProfile(env));
}

/**
 * Inside tmux the outer host is hidden, but tmux itself speaks xterm button and
 * SGR mouse to its panes: when the pane asks, tmux enables mouse on the outer
 * terminal and forwards wheel reports whether its own `mouse` option is on or
 * off (copy mode and tmux's own bindings still come first). Without asking,
 * the outer terminal turns the wheel into Up/Down keys (alternate scroll),
 * which NMSh cannot tell from the keyboard and which walked composer history.
 * No movement tracking; Shift keeps the terminal's own selection.
 */
const TMUX_PROFILE = {
  mouseReporting: true, mouseMovement: false, clickSupport: true, textSelectionInteraction: 'shift' as const, hostSynchronizes: true as const,
};

/** Adapter hints are subordinate to protocol evidence. Multiplexers hide outer hints. */
export function resolveHostCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const result = {...BASELINE_CAPABILITIES};
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(tmux|screen)/u.test(env.TERM ?? '');
  if (!nested && env.TERM !== 'dumb') {
    const profile = terminalProfile(env);
    if (profile === 'zed') Object.assign(result, ZED_PROFILE);
    else if (profile === 'windows-terminal') Object.assign(result, WINDOWS_TERMINAL_PROFILE);
    else if (profile !== 'baseline') Object.assign(result, MOUSE_PROFILE);
    if (profile === 'ghostty') Object.assign(result, {enhancedKeyboard: true, kittyKeyboard: true,
      appearanceIntegration: true, hostConfiguration: true});
    if (profile === 'kitty') Object.assign(result, {enhancedKeyboard: true, kittyKeyboard: true, graphicsProtocol: 'kitty'});
    if (profile === 'iterm2' || profile === 'wezterm') result.graphicsProtocol = 'iterm2';
  }
  else if (env.TMUX && !env.STY && !env.ZELLIJ && env.TERM !== 'dumb') Object.assign(result, TMUX_PROFILE);
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || /(?:direct|truecolor)/u.test(env.TERM ?? '')) result.truecolor = true;
  if (env.NMSH_HYPERLINKS === '1') result.hyperlinks = true;
  if (env.NMSH_HYPERLINKS === '0' || env.TERM === 'dumb') result.hyperlinks = false;
  return result;
}
