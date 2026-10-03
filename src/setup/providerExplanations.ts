/**
 * Short, factual explanations of what each provider choice actually does.
 * Native choices say no installation is needed; external choices say why
 * someone might pick them, never that they are better.
 */
export const PROVIDER_EXPLANATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  history: {
    native: 'Built in · local command history and search (/history) · no installation required',
    atuin: 'Optional external history · reads your existing local Atuin database, read-only, no sync',
  },
  navigation: {
    native: 'Built in · ranks directories you use and jumps with /dirs · no installation required',
    zoxide: 'Optional external ranking · reads your zoxide database; zoxide itself provides `z`',
  },
  picker: {
    native: "Built in · NMSh's interactive list in the composer · no installation required",
    fzf: 'Optional external picker engine · uses your installed fzf for full-screen fuzzy picking',
    television: 'Optional external picker · uses your installed Television (tv)',
  },
  suggestions: {
    nmsh: 'Built in · ghost-text predictions from your history and directory · no installation required',
    deja: 'Optional external engine · your installed Deja, which learns through its own zsh hooks',
    none: 'No ghost text while typing',
  },
  welcome: {
    vespyr: 'Built in · Vespyr the NMSh cat with build and directory · no installation required',
    fastfetch: 'Optional external · runs your installed fastfetch with its own configuration',
    neofetch: 'Optional external · legacy/archived; used only if already installed',
    macchina: 'Optional external · system information fetcher in maintenance mode',
    zigfetch: 'Optional external · minimal fetcher using your installed configuration',
    none: 'No welcome; sessions start at the first command',
  },
  prompt: {
    nmsh: 'Built in · NMSh Native prompt with themes, styles and Chroma · no installation required',
    starship: 'Optional external · renders your installed Starship and its configuration',
    powerlevel10k: 'Optional external · your existing ~/.p10k.zsh left prompt',
  },
};

export function providerExplanation(family: string, id: string): string {
  return PROVIDER_EXPLANATIONS[family]?.[id] ?? '';
}
