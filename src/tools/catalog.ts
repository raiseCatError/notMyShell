import {installUnavailableReason, providerInstall, resolveCommand, type ProviderDescriptor, type ProviderInstall, type ProviderFamily} from '../providers/providers.js';

export const TOOL_CATEGORIES = ['Search & Files', 'Git & Development', 'Navigation & History',
  'Data / Structured Text', 'Environment & Secrets', 'Shell / Workflow', 'Containers / Infrastructure', 'Project / Language Tooling'] as const;
/**
 * Optional tiers. Recommended is a small, conservative toolkit; Enhanced is a
 * separate set some people like. Neither is "better for everyone", and NMSh
 * is complete with no tier installed.
 */
export type ToolTier = 'recommended' | 'enhanced';
export const TOOL_TIER_LABELS: Record<ToolTier, string> = {recommended: 'Recommended', enhanced: 'Enhanced CLI'};

export interface Tool extends ProviderDescriptor {
  category: typeof TOOL_CATEGORIES[number];
  /** Kept for existing callers: true exactly for the Recommended tier. */
  recommended?: boolean;
  tier?: ToolTier;
  package: string;
  source: string;
  providerFamily?: ProviderFamily;
  configuration?: 'starship';
  language?: string;
}

function tool(id: string, label: string, category: Tool['category'], description: string,
  source: string, options: Partial<Tool> = {}): Tool {
  const tier = options.tier ?? (options.recommended ? 'recommended' : undefined);
  return {id, label, category, description, source, package: id, kind: 'external', family: 'tool',
    executable: id, versionArgs: ['--version'], ...options, ...(tier ? {tier, recommended: tier === 'recommended'} : {})};
}
const ENHANCED = {tier: 'enhanced'} as const;

/** Curated offline metadata. No third-party submissions, update checks or marketplace. */
export const TOOLS: readonly Tool[] = [
  tool('rg', 'ripgrep', 'Search & Files', 'Fast recursive text search.', 'https://github.com/BurntSushi/ripgrep', {package: 'ripgrep', recommended: true}),
  tool('fd', 'fd', 'Search & Files', 'Simple file discovery.', 'https://github.com/sharkdp/fd', {recommended: true}),
  tool('fzf', 'fzf', 'Search & Files', 'Optional interactive supplied-candidate picker.', 'https://github.com/junegunn/fzf', {recommended: true, providerFamily: 'picker'}),
  tool('bat', 'bat', 'Search & Files', 'File viewing with syntax colors.', 'https://github.com/sharkdp/bat', ENHANCED),
  tool('eza', 'eza', 'Search & Files', 'Optional directory listing.', 'https://github.com/eza-community/eza', ENHANCED),
  tool('gh', 'GitHub CLI', 'Git & Development', 'GitHub workflows; authentication is managed by gh.', 'https://cli.github.com/', ENHANCED),
  tool('lazygit', 'lazygit', 'Git & Development', 'Interactive Git frontend.', 'https://github.com/jesseduffield/lazygit', ENHANCED),
  tool('delta', 'delta', 'Git & Development', 'Optional Git diff presentation.', 'https://github.com/dandavison/delta', {package: 'git-delta', ...ENHANCED}),
  tool('zoxide', 'zoxide', 'Navigation & History', 'Optional directory ranking; existing hooks stay unchanged.', 'https://github.com/ajeetdsouza/zoxide', {recommended: true, providerFamily: 'navigation'}),
  tool('atuin', 'Atuin', 'Navigation & History', 'Optional local history provider; no sync or hook setup.', 'https://atuin.sh/', {providerFamily: 'history', ...ENHANCED}),
  tool('jq', 'jq', 'Data / Structured Text', 'Read and transform JSON.', 'https://jqlang.org/', {recommended: true}),
  tool('yq', 'yq', 'Data / Structured Text', 'Structured text tooling; multiple yq implementations exist.', 'https://github.com/mikefarah/yq'),
  tool('direnv', 'direnv', 'Environment & Secrets', 'Project environment tooling; approval/hooks remain yours.', 'https://direnv.net/', ENHANCED),
  tool('pass', 'pass', 'Environment & Secrets', 'Password tooling; NMSh does not read its secret store.', 'https://www.passwordstore.org/', {versionArgs: undefined}),
  tool('starship', 'Starship', 'Shell / Workflow', 'Optional prompt with supported module configuration.', 'https://starship.rs/', {configuration: 'starship'}),
  tool('fastfetch', 'Fastfetch', 'Shell / Workflow', 'Optional startup welcome capture.', 'https://github.com/fastfetch-cli/fastfetch', {providerFamily: 'welcome'}),
  tool('neofetch', 'Neofetch', 'Shell / Workflow', 'Startup welcome capture, if already installed.', 'https://github.com/dylanaraps/neofetch',
    {providerFamily: 'welcome', legacy: true, successor: 'Fastfetch', package: ''}),
  tool('macchina', 'Macchina', 'Shell / Workflow', 'Optional startup welcome capture.', 'https://github.com/Macchina-CLI/macchina',
    {providerFamily: 'welcome', lifecycle: 'maintenance'}),
  tool('stow', 'GNU Stow', 'Shell / Workflow', 'Explicitly managed dotfile symlinks.', 'https://www.gnu.org/software/stow/'),
  tool('tmux', 'tmux', 'Shell / Workflow', 'Independent terminal multiplexer.', 'https://github.com/tmux/tmux', {versionArgs: ['-V']}),
  tool('docker', 'Docker CLI', 'Containers / Infrastructure', 'Container client; daemon availability is not inferred.', 'https://docs.docker.com/', {package: 'docker'}),
  tool('kubectl', 'kubectl', 'Containers / Infrastructure', 'Kubernetes client; credentials/cluster are not inspected.', 'https://kubernetes.io/docs/reference/kubectl/', {versionArgs: undefined, package: 'kubernetes-cli'}),
  tool('mise', 'mise', 'Project / Language Tooling', 'Optional project tooling; metadata evaluation needs consent.', 'https://mise.jdx.dev/', {versionArgs: undefined, ...ENHANCED}),
  tool('node', 'Node.js', 'Project / Language Tooling', 'JavaScript runtime.', 'https://nodejs.org/', {language: 'JavaScript'}),
  tool('go', 'Go', 'Project / Language Tooling', 'Go language toolchain.', 'https://go.dev/', {language: 'Go', versionArgs: ['version']}),
  tool('python3', 'Python', 'Project / Language Tooling', 'Python runtime.', 'https://www.python.org/', {language: 'Python', package: 'python'}),
];

/** Legacy tools and tools without a curated package keep no recipe. */
function withRecipe(tool: Tool): Tool {
  return tool.legacy || !tool.package ? tool : {...tool, recipe: {brew: tool.package}};
}

/** No sudo, install scripts, custom taps, interpolation or automatic fallback. */
export function toolInstall(tool: Tool, hasBrew = resolveCommand('brew') !== undefined, platform: NodeJS.Platform = process.platform): ProviderInstall | undefined {
  return providerInstall(withRecipe(tool), platform, hasBrew);
}

/** Factual reason a catalog tool has no install here. */
export function toolInstallUnavailable(tool: Tool, hasBrew = resolveCommand('brew') !== undefined, platform: NodeJS.Platform = process.platform): string {
  return installUnavailableReason(withRecipe(tool), platform, hasBrew);
}

export function toolsInTier(tier: ToolTier): Tool[] {
  return TOOLS.filter(tool => tool.tier === tier);
}

/**
 * The curated tool a missing command word maps to, by exact executable name
 * only. Language runtimes, infrastructure clients and legacy tools are never
 * suggested; nothing is fuzzy-matched.
 */
export function suggestibleToolFor(word: string): Tool | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/u.test(word)) return undefined;
  return TOOLS.find(tool => tool.executable === word && !tool.legacy && (tool.tier !== undefined || tool.id === 'yq'));
}
