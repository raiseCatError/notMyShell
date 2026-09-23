export type GlyphMode = 'nerd' | 'safe';
export type IconStylePref = 'auto' | 'nerd' | 'safe';

let userPref: IconStylePref = 'nerd';

export function setIconStyle(pref: IconStylePref): void {
  userPref = pref;
}

export function getIconStyle(): IconStylePref {
  return userPref;
}

export function getCurrentGlyphMode(): GlyphMode {
  const envPref = process.env.NMSH_ICONS;
  if (envPref === 'nerd' || envPref === 'safe') return envPref;
  if (userPref === 'nerd' || userPref === 'safe') return userPref;
  return 'nerd'; // auto defaults to fancy
}

export const GLYPHS = {
  get branch() { return getCurrentGlyphMode() === 'nerd' ? '' : 'git:'; },
  get success() { return getCurrentGlyphMode() === 'nerd' ? '✔' : '✓'; },
  get failure() { return getCurrentGlyphMode() === 'nerd' ? '✘' : '×'; },
  get info() { return getCurrentGlyphMode() === 'nerd' ? '⎿' : '›'; },
  get selection() { return getCurrentGlyphMode() === 'nerd' ? '›' : '>'; },
  get jumpDown() { return getCurrentGlyphMode() === 'nerd' ? '↓' : '↓'; },
  get separator() { return getCurrentGlyphMode() === 'nerd' ? '─' : '─'; },
  get prompt() { return getCurrentGlyphMode() === 'nerd' ? '❯' : '>'; },
  // U+E0D7 starts independent segments; U+E0B0 is the only transition/end wedge.
  get powerlineLeading() { return getCurrentGlyphMode() === 'nerd' ? '' : '<'; },
  get powerlineTrailing() { return getCurrentGlyphMode() === 'nerd' ? '' : '>'; },
  get powerlineFade() { return getCurrentGlyphMode() === 'nerd' ? '▓▒░' : '==='; },
};

export const SPINNER_FRAMES = {
  get frames() {
    return getCurrentGlyphMode() === 'nerd' 
      ? ['·', '✢', '✳', '✶', '✻', '*', '✻', '✶', '✳', '✢']
      : ['·', '*', '+', '*', '·', '*', '+', '*'];
  }
};
