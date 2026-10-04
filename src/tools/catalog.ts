import {installUnavailableReason, providerInstall, resolveCommand, type ProviderDescriptor, type ProviderInstall, type ProviderFamily} from '../providers/providers.js';

export const TOOL_CATEGORIES = ['Search & Files', 'Git & Development', 'Navigation & History',
  'Data / Structured Text', 'Environment & Secrets', 'Shell / Workflow', 'Containers / Infrastructure', 'Project / Language Tooling'] as const;
/**
 * Optional tiers. Recommended is a small, conservative toolkit; Enhanced is a
 * separate set some people like. Neither is "better for everyone", and NMSh
 * is complete with no tier installed.
 */
export type ToolTier = 'recommended' | 'enhanced';
export const TOOL_TIER_LABELS: Record<ToolTier, string> = {recommended: 'Recommended', enhanced: 'Enhanced'};
export type ToolDiscoveryKind = 'utility' | 'environment';

export interface Tool extends ProviderDescriptor {
  category: typeof TOOL_CATEGORIES[number];
  /** Kept for existing callers: true exactly for the Recommended tier. */
  recommended?: boolean;
  tier?: ToolTier;
  /** Facts for future contextual discovery; never evaluated by running a tool. */
  relevantTo?: readonly string[];
  /** Runtime or infrastructure client detected as part of the environment. */
  discoveryKind?: ToolDiscoveryKind;
  package: string;
  source: string;
  providerFamily?: ProviderFamily;
  /** Provider integration is distinct from the recommendation tier. */
  integration?: 'welcome' | 'picker' | 'navigation' | 'history' | 'completion' | 'prompt';
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
const ENVIRONMENT = {discoveryKind: 'environment'} as const;

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
  tool('jc', 'jc', 'Data / Structured Text', 'Convert common command output formats to JSON.', 'https://github.com/kellyjonbrazil/jc', {package: 'jc', executable: 'jc', ...ENHANCED}),
  tool('glow', 'Glow', 'Data / Structured Text', 'Render Markdown in the terminal.', 'https://github.com/charmbracelet/glow', {package: 'glow', ...ENHANCED}),
  tool('xh', 'xh', 'Data / Structured Text', 'Friendly and fast HTTP client.', 'https://github.com/ducaale/xh', {package: 'xh', ...ENHANCED}),
  tool('direnv', 'direnv', 'Environment & Secrets', 'Project environment tooling; approval/hooks remain yours.', 'https://direnv.net/', ENHANCED),
  tool('pass', 'pass', 'Environment & Secrets', 'Password tooling; NMSh does not read its secret store.', 'https://www.passwordstore.org/', {versionArgs: undefined}),
  tool('starship', 'Starship', 'Shell / Workflow', 'Optional prompt with supported module configuration.', 'https://starship.rs/', {configuration: 'starship'}),
  tool('shellcheck', 'ShellCheck', 'Shell / Workflow', 'Find common shell script mistakes.', 'https://github.com/koalaman/shellcheck', {package: 'shellcheck', ...ENHANCED, relevantTo: ['shell-scripts']}),
  tool('shfmt', 'shfmt', 'Shell / Workflow', 'Format shell scripts consistently.', 'https://github.com/mvdan/sh', {package: 'shfmt', ...ENHANCED, relevantTo: ['shell-scripts']}),
  tool('just', 'just', 'Shell / Workflow', 'A command runner for project-specific tasks.', 'https://github.com/casey/just', {package: 'just', ...ENHANCED, relevantTo: ['project']}),
  tool('hyperfine', 'hyperfine', 'Shell / Workflow', 'Benchmark command-line programs.', 'https://github.com/sharkdp/hyperfine', {package: 'hyperfine', ...ENHANCED}),
  tool('watchexec', 'watchexec', 'Shell / Workflow', 'Re-run a command when watched sources change.', 'https://github.com/watchexec/watchexec', {package: 'watchexec', ...ENHANCED, relevantTo: ['project']}),
  tool('television', 'Television', 'Search & Files', 'Optional fuzzy picker provider.', 'https://github.com/alexpasmantier/television', {package: 'television', executable: 'tv', providerFamily: 'picker', relevantTo: ['git']}),
  tool('carapace', 'Carapace', 'Shell / Workflow', 'Optional external completion provider.', 'https://github.com/carapace-sh/carapace-bin', {package: 'carapace', providerFamily: 'tool', integration: 'completion', relevantTo: ['shell-completion']}),
  tool('dust', 'dust', 'Search & Files', 'A clearer view of disk usage.', 'https://github.com/bootandy/dust', {package: 'dust', ...ENHANCED}),
  tool('duf', 'duf', 'Search & Files', 'Disk usage with a readable table.', 'https://github.com/muesli/duf', {package: 'duf', ...ENHANCED}),
  tool('procs', 'procs', 'Project / Language Tooling', 'A modern process viewer.', 'https://github.com/dalance/procs', {package: 'procs', ...ENHANCED}),
  tool('btop', 'btop', 'Project / Language Tooling', 'Interactive resource monitor.', 'https://github.com/aristocratos/btop', {package: 'btop', ...ENHANCED}),
  tool('tokei', 'tokei', 'Project / Language Tooling', 'Count code across languages.', 'https://github.com/XAMPPRocky/tokei', {package: 'tokei', ...ENHANCED, relevantTo: ['project']}),
  tool('fastfetch', 'Fastfetch', 'Shell / Workflow', 'Optional startup welcome capture.', 'https://github.com/fastfetch-cli/fastfetch', {providerFamily: 'welcome', integration: 'welcome', recommended: true}),
  tool('neofetch', 'Neofetch', 'Shell / Workflow', 'Startup welcome capture, if already installed.', 'https://github.com/dylanaraps/neofetch',
    {providerFamily: 'welcome', integration: 'welcome', legacy: true, successor: 'Fastfetch', package: ''}),
  tool('macchina', 'Macchina', 'Shell / Workflow', 'Optional startup welcome capture.', 'https://github.com/Macchina-CLI/macchina',
    {providerFamily: 'welcome', integration: 'welcome', lifecycle: 'maintenance'}),
  tool('stow', 'GNU Stow', 'Shell / Workflow', 'Explicitly managed dotfile symlinks.', 'https://www.gnu.org/software/stow/'),
  tool('tealdeer', 'tealdeer (TLDR pages)', 'Shell / Workflow', 'Optional TLDR pages client; Ask uses its local cache for practical command examples.', 'https://github.com/tealdeer-rs/tealdeer',
    {executable: 'tldr', package: 'tealdeer'}),
  tool('tmux', 'tmux', 'Shell / Workflow', 'Independent terminal multiplexer.', 'https://github.com/tmux/tmux', {versionArgs: ['-V']}),
  tool('docker', 'Docker CLI', 'Containers / Infrastructure', 'Container client; daemon availability is not inferred.', 'https://docs.docker.com/', {package: 'docker', ...ENVIRONMENT, relevantTo: ['containers']}),
  tool('kubectl', 'kubectl', 'Containers / Infrastructure', 'Kubernetes client; credentials/cluster are not inspected.', 'https://kubernetes.io/docs/reference/kubectl/', {versionArgs: undefined, package: 'kubernetes-cli', ...ENVIRONMENT, relevantTo: ['kubernetes']}),
  tool('mise', 'mise', 'Project / Language Tooling', 'Optional project tooling; metadata evaluation needs consent.', 'https://mise.jdx.dev/', {versionArgs: undefined, ...ENHANCED}),
  tool('node', 'Node.js', 'Project / Language Tooling', 'JavaScript runtime.', 'https://nodejs.org/', {language: 'JavaScript', ...ENVIRONMENT, relevantTo: ['javascript']}),
  tool('go', 'Go', 'Project / Language Tooling', 'Go language toolchain.', 'https://go.dev/', {language: 'Go', versionArgs: ['version'], ...ENVIRONMENT, relevantTo: ['go']}),
  tool('python3', 'Python', 'Project / Language Tooling', 'Python runtime.', 'https://www.python.org/', {language: 'Python', package: 'python', ...ENVIRONMENT, relevantTo: ['python']}),
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
  return TOOLS.find(tool => tool.executable === word && !tool.legacy && tool.discoveryKind !== 'environment'
    && tool.lifecycle !== 'maintenance' && !tool.integration && (tool.tier !== undefined || tool.id === 'yq'));
}
