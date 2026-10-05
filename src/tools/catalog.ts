import {detectProvider, installUnavailableReason, providerInstall, resolveCommand, type ProviderDescriptor, type ProviderInstall, type ProviderFamily, type ProviderStatus} from '../providers/providers.js';
import type {PromptProviderId} from '../prompt/configuration.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {detectBackend as detectKeepAwake} from '../keepAwake/keepAwake.js';
import {detectAntidote, detectOhMyZsh, detectPowerlevel10kTool, detectPrezto, detectZim, detectZinit, type FilesystemFact} from './frameworks.js';

export const TOOL_CATEGORIES = ['Search & Files', 'Git & Development', 'Navigation & History',
  'Data / Structured Text', 'Environment & Secrets', 'Shell / Workflow', 'Containers / Infrastructure', 'Project / Language Tooling', 'System capabilities'] as const;
/**
 * Optional tiers. Recommended is a small, conservative toolkit; Enhanced is a
 * separate set some people like. Neither is "better for everyone", and NMSh
 * is complete with no tier installed.
 */
export type ToolTier = 'recommended' | 'enhanced';
export const TOOL_TIER_LABELS: Record<ToolTier, string> = {recommended: 'Recommended', enhanced: 'Enhanced'};
export type ToolDiscoveryKind = 'utility' | 'environment';

/**
 * How a curated tool is detected, registered explicitly. `executable` is a
 * PATH lookup; `filesystem` is a registered structural detector for
 * frameworks and themes that are not commands. Detection never grants
 * install, uninstall, configuration or provider authority.
 */
export type ToolDetection = {kind: 'executable'} | {kind: 'filesystem'; detect: (env: NodeJS.ProcessEnv) => FilesystemFact | undefined};

/** What a tool is, stated explicitly (never inferred from being installed). A tool may have several. */
export type ToolCapability = 'executable utility' | 'shell framework' | 'prompt engine' | 'Prompt provider' | 'configurable'
  | 'special installer' | 'filesystem-detected' | 'dotfiles inspect-only' | 'Theme Studio import source' | 'executable config';

export interface Tool extends ProviderDescriptor {
  category: typeof TOOL_CATEGORIES[number];
  /** Kept for existing callers: true exactly for the Recommended tier. */
  recommended?: boolean;
  tier?: ToolTier;
  /** Facts for future contextual discovery; never evaluated by running a tool. */
  relevantTo?: readonly string[];
  /**
   * Whether typing this exact executable while it is missing identifies the tool.
   * Default true: being curated means NMSh knows what the command is; the
   * recommendation tier says nothing about identity. Runtimes and
   * infrastructure clients opt out explicitly with false.
   */
  commandNotFound?: boolean;
  /** Extra exact command names for this tool; the canonical `executable` stays explicit. Package names are never aliases. */
  commandAliases?: readonly string[];
  /** Runtime or infrastructure client detected as part of the environment. */
  discoveryKind?: ToolDiscoveryKind;
  package: string;
  source: string;
  providerFamily?: ProviderFamily;
  /** Provider integration is distinct from the recommendation tier. */
  integration?: 'welcome' | 'picker' | 'navigation' | 'history' | 'completion' | 'prompt';
  /** A registered Tool Configuration adapter (src/tools/config/registry.ts); only these get Configure. */
  configuration?: 'starship' | 'tmux';
  language?: string;
  /** Default: the executable on PATH. */
  detection?: ToolDetection;
  capabilities?: readonly ToolCapability[];
  /** Shells the tool belongs to; absent means any. Shown factually, never hidden for another backend. */
  shells?: readonly ShellId[];
  /** The canonical Prompt provider this tool is (one identity with /providers and /prompt). */
  promptProvider?: Exclude<PromptProviderId, 'nmsh' | 'none'>;
  /** A first-party guided installer adapter (src/tools/frameworks.ts) instead of a package recipe. */
  installAdapter?: 'oh-my-zsh';
}

function tool(id: string, label: string, category: Tool['category'], description: string,
  source: string, options: Partial<Tool> = {}): Tool {
  const tier = options.tier ?? (options.recommended ? 'recommended' : undefined);
  return {id, label, category, description, source, package: id, kind: 'external', family: 'tool',
    executable: id, versionArgs: ['--version'], ...options, ...(tier ? {tier, recommended: tier === 'recommended'} : {})};
}
const ENHANCED = {tier: 'enhanced'} as const;
const ENVIRONMENT = {discoveryKind: 'environment', commandNotFound: false} as const;
/** Not a command: no executable, no package recipe, never identified by command-not-found. */
const filesystem = (detect: (env: NodeJS.ProcessEnv) => FilesystemFact | undefined) =>
  ({detection: {kind: 'filesystem', detect}, executable: undefined, package: '', versionArgs: undefined, commandNotFound: false} as const);
const ZSH_FRAMEWORK = {shells: ['zsh'], capabilities: ['shell framework', 'filesystem-detected', 'dotfiles inspect-only']} as const;

/** Curated offline metadata. No third-party submissions, update checks or marketplace. */
export const TOOLS: readonly Tool[] = [
  tool('rg', 'ripgrep', 'Search & Files', 'Fast recursive text search.', 'https://github.com/BurntSushi/ripgrep', {package: 'ripgrep', recommended: true}),
  tool('fd', 'fd', 'Search & Files', 'Simple file discovery.', 'https://github.com/sharkdp/fd', {recommended: true}),
  tool('fzf', 'fzf', 'Search & Files', 'Optional interactive supplied-candidate picker.', 'https://github.com/junegunn/fzf', {recommended: true, providerFamily: 'picker'}),
  tool('bat', 'bat', 'Search & Files', 'File viewing with syntax colors.', 'https://github.com/sharkdp/bat', ENHANCED),
  tool('eza', 'eza', 'Search & Files', 'Optional directory listing.', 'https://github.com/eza-community/eza', ENHANCED),
  tool('gh', 'GitHub CLI', 'Git & Development', 'GitHub workflows; authentication is managed by gh.', 'https://cli.github.com/', {...ENHANCED, relevantTo: ['git']}),
  tool('lazygit', 'lazygit', 'Git & Development', 'Interactive Git frontend.', 'https://github.com/jesseduffield/lazygit', {...ENHANCED, relevantTo: ['git']}),
  tool('delta', 'delta', 'Git & Development', 'Optional Git diff presentation.', 'https://github.com/dandavison/delta', {package: 'git-delta', ...ENHANCED, relevantTo: ['git']}),
  tool('zoxide', 'zoxide', 'Navigation & History', 'Optional directory ranking; existing hooks stay unchanged.', 'https://github.com/ajeetdsouza/zoxide', {recommended: true, providerFamily: 'navigation'}),
  tool('atuin', 'Atuin', 'Navigation & History', 'Optional local history provider; no sync or hook setup.', 'https://atuin.sh/', {providerFamily: 'history', ...ENHANCED}),
  tool('jq', 'jq', 'Data / Structured Text', 'Read and transform JSON.', 'https://jqlang.org/', {recommended: true, relevantTo: ['kubernetes']}),
  tool('yq', 'yq', 'Data / Structured Text', 'Structured text tooling; multiple yq implementations exist.', 'https://github.com/mikefarah/yq', {relevantTo: ['kubernetes']}),
  tool('jc', 'jc', 'Data / Structured Text', 'Convert common command output formats to JSON.', 'https://github.com/kellyjonbrazil/jc', {package: 'jc', executable: 'jc', ...ENHANCED}),
  tool('glow', 'Glow', 'Data / Structured Text', 'Render Markdown in the terminal.', 'https://github.com/charmbracelet/glow', {package: 'glow', ...ENHANCED}),
  tool('xh', 'xh', 'Data / Structured Text', 'Friendly and fast HTTP client.', 'https://github.com/ducaale/xh', {package: 'xh', ...ENHANCED}),
  tool('direnv', 'direnv', 'Environment & Secrets', 'Project environment tooling; approval/hooks remain yours.', 'https://direnv.net/', ENHANCED),
  tool('pass', 'pass', 'Environment & Secrets', 'Password tooling; NMSh does not read its secret store.', 'https://www.passwordstore.org/', {versionArgs: undefined}),
  tool('starship', 'Starship', 'Shell / Workflow', 'Cross-shell prompt engine; an NMSh Prompt provider with supported module configuration.', 'https://starship.rs/',
    {configuration: 'starship', promptProvider: 'starship', capabilities: ['executable utility', 'prompt engine', 'Prompt provider', 'configurable']}),
  tool('oh-my-posh', 'Oh My Posh', 'Shell / Workflow', 'Cross-shell prompt engine; an NMSh Prompt provider rendered directly, with no shell rc change.', 'https://ohmyposh.dev/',
    {versionArgs: ['version'], promptProvider: 'ohMyPosh', capabilities: ['executable utility', 'prompt engine', 'Prompt provider', 'Theme Studio import source', 'dotfiles inspect-only']}),
  tool('powerlevel10k', 'Powerlevel10k', 'Shell / Workflow', 'Zsh prompt theme; an NMSh Prompt provider rendered in an isolated helper. Its config is Zsh code.', 'https://github.com/romkatv/powerlevel10k',
    {...filesystem(detectPowerlevel10kTool), shells: ['zsh'], promptProvider: 'powerlevel10k', capabilities: ['prompt engine', 'Prompt provider', 'filesystem-detected', 'configurable', 'executable config']}),
  tool('oh-my-zsh', 'Oh My Zsh', 'Shell / Workflow', 'Zsh framework (not a command). Guided install keeps your .zshrc; its themes and plugins are Zsh code, inspect only.', 'https://ohmyz.sh/',
    {...filesystem(detectOhMyZsh), ...ZSH_FRAMEWORK, installAdapter: 'oh-my-zsh', capabilities: [...ZSH_FRAMEWORK.capabilities, 'special installer']}),
  tool('prezto', 'Prezto', 'Shell / Workflow', 'Zsh framework, detected only. Inspect only; NMSh does not install or configure it.', 'https://github.com/sorin-ionescu/prezto',
    {...filesystem(detectPrezto), ...ZSH_FRAMEWORK}),
  tool('zim', 'Zim (zimfw)', 'Shell / Workflow', 'Zsh framework, detected only. Inspect only; NMSh does not install or configure it.', 'https://zimfw.sh/',
    {...filesystem(detectZim), ...ZSH_FRAMEWORK}),
  tool('zinit', 'zinit', 'Shell / Workflow', 'Zsh plugin manager, detected only. Inspect only; NMSh does not install or configure it.', 'https://github.com/zdharma-continuum/zinit',
    {...filesystem(detectZinit), ...ZSH_FRAMEWORK}),
  tool('antidote', 'Antidote', 'Shell / Workflow', 'Zsh plugin manager, detected only. Inspect only; NMSh does not install or configure it.', 'https://antidote.sh/',
    {...filesystem(detectAntidote), ...ZSH_FRAMEWORK}),
  tool('shellcheck', 'ShellCheck', 'Shell / Workflow', 'Find common shell script mistakes.', 'https://github.com/koalaman/shellcheck', {package: 'shellcheck', ...ENHANCED, relevantTo: ['shell-scripts']}),
  tool('shfmt', 'shfmt', 'Shell / Workflow', 'Format shell scripts consistently.', 'https://github.com/mvdan/sh', {package: 'shfmt', ...ENHANCED, relevantTo: ['shell-scripts']}),
  tool('just', 'just', 'Shell / Workflow', 'A command runner for project-specific tasks.', 'https://github.com/casey/just', {package: 'just', ...ENHANCED, relevantTo: ['project', 'javascript', 'python', 'go', 'rust']}),
  tool('hyperfine', 'hyperfine', 'Shell / Workflow', 'Benchmark command-line programs.', 'https://github.com/sharkdp/hyperfine', {package: 'hyperfine', ...ENHANCED}),
  tool('watchexec', 'watchexec', 'Shell / Workflow', 'Re-run a command when watched sources change.', 'https://github.com/watchexec/watchexec', {package: 'watchexec', ...ENHANCED, relevantTo: ['project', 'javascript', 'python', 'go', 'rust']}),
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
  tool('tealdeer', 'TLDR (tealdeer)', 'Shell / Workflow', 'Practical local command examples (command tldr, package tealdeer). Optional; Ask uses its local cache and never updates it.', 'https://github.com/tealdeer-rs/tealdeer',
    {executable: 'tldr', package: 'tealdeer', recommended: true}),
  tool('tmux', 'tmux', 'Shell / Workflow', 'Independent terminal multiplexer.', 'https://github.com/tmux/tmux', {versionArgs: ['-V'], configuration: 'tmux'}),
  tool('keep-awake', process.platform === 'darwin' ? 'Apple caffeinate' : process.platform === 'win32' ? 'Windows execution-state API' : 'systemd inhibitor', 'System capabilities',
    `${process.platform === 'darwin' ? 'Built into macOS' : process.platform === 'win32' ? 'Built into Windows' : 'System capability, detected'}; used by Keep Awake (/caffeinate, /awake, /zoomies). Nothing to install, upgrade or remove here.`,
    process.platform === 'darwin' ? 'https://ss64.com/mac/caffeinate.html' : process.platform === 'win32' ? 'https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate' : 'https://www.freedesktop.org/software/systemd/man/latest/systemd-inhibit.html',
    {...filesystem(() => { const backend = detectKeepAwake(); return backend ? {path: backend.label} : undefined; }), discoveryKind: 'environment'}),
  tool('docker', 'Docker CLI', 'Containers / Infrastructure', 'Container client; daemon availability is not inferred.', 'https://docs.docker.com/', {package: 'docker', ...ENVIRONMENT, relevantTo: ['containers']}),
  tool('kubectl', 'kubectl', 'Containers / Infrastructure', 'Kubernetes client; credentials/cluster are not inspected.', 'https://kubernetes.io/docs/reference/kubectl/', {versionArgs: undefined, package: 'kubernetes-cli', ...ENVIRONMENT, relevantTo: ['kubernetes']}),
  tool('mise', 'mise', 'Project / Language Tooling', 'Optional project tooling; metadata evaluation needs consent.', 'https://mise.jdx.dev/', {versionArgs: undefined, ...ENHANCED}),
  tool('node', 'Node.js', 'Project / Language Tooling', 'JavaScript runtime.', 'https://nodejs.org/', {language: 'JavaScript', ...ENVIRONMENT, relevantTo: ['javascript']}),
  tool('go', 'Go', 'Project / Language Tooling', 'Go language toolchain.', 'https://go.dev/', {language: 'Go', versionArgs: ['version'], ...ENVIRONMENT, relevantTo: ['go']}),
  tool('python3', 'Python', 'Project / Language Tooling', 'Python runtime.', 'https://www.python.org/', {language: 'Python', package: 'python', ...ENVIRONMENT, relevantTo: ['python']}),
];

/** One detection entry point: the tool's registered strategy, never a guess. */
export function detectTool(tool: Tool, env: NodeJS.ProcessEnv = process.env): Promise<ProviderStatus> {
  if (tool.detection?.kind === 'filesystem') {
    const fact = tool.detection.detect(env);
    return Promise.resolve(fact ? {state: 'installed', detail: fact.source ? `${fact.path} · ${fact.source}` : fact.path} : {state: 'missing'});
  }
  return detectProvider(tool, env.PATH ?? '');
}

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
 * Identity only: which curated tool an exact command name belongs to. No
 * install, execution, network or package guessing. Tools that opted out with
 * `commandNotFound: false` are not identified by it.
 */
export function knownToolForExecutable(word: string, tools: readonly Tool[] = TOOLS): Tool | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/u.test(word)) return undefined;
  return tools.find(tool => tool.commandNotFound !== false && tool.detection?.kind !== 'filesystem' && ((tool.executable ?? tool.id) === word || tool.commandAliases?.includes(word)));
}

/**
 * Policy on top of identity: tools NMSh would offer to install for a missing
 * command. Archived (legacy) and maintenance-only tools are known but never
 * offered. Tier, provider integration and relevance play no part.
 */
export function suggestibleToolFor(word: string, tools: readonly Tool[] = TOOLS): Tool | undefined {
  const tool = knownToolForExecutable(word, tools);
  return tool && !tool.legacy && tool.lifecycle !== 'maintenance' ? tool : undefined;
}
