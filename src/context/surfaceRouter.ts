import {modulePlacement, type ContextModuleConfig, type ContextSurface, type PromptConfiguration} from '../prompt/configuration.js';
import {moduleDefinition} from './modules.js';

/** Placement is policy over descriptions/config, never over filesystem or process state. A module whose pack is missing is hidden. */
export function routeModule(module: ContextModuleConfig): ContextSurface | 'hidden' {
  if (!module.visible || module.surface === 'hidden') return 'hidden';
  const definition = moduleDefinition(module.id);
  if (!definition) return 'hidden';
  const requested = module.surface === 'auto' ? definition.preferredSurface
    : module.surface ?? (modulePlacement(module) === 'right' ? 'rightContext' : 'mainPrompt');
  return definition.supportedSurfaces.includes(requested) ? requested : 'hidden';
}

const PROVIDER_NAMES: Record<PromptConfiguration['provider'], string> = {nmsh: 'NMSh Native', starship: 'Starship', powerlevel10k: 'Powerlevel10k', ohMyPosh: 'Oh My Posh', none: 'Prompt None'};

/**
 * Whether a surface can present modules under the current settings, and why
 * not. Routing is never changed here: a module keeps its saved surface and
 * returns when the surface does (an external prompt draws its own prompt row;
 * the Status Strip is independent of the prompt provider).
 */
export function surfaceAvailability(surface: ContextSurface, configuration: Pick<PromptConfiguration, 'provider' | 'contextRail' | 'statusStrip'>): {available: true} | {available: false; reason: string} {
  const provider = configuration.provider;
  if (surface === 'statusStrip') return configuration.statusStrip.enabled ? {available: true} : {available: false, reason: 'Status Strip is Off (/strip)'};
  if (provider !== 'nmsh') return {available: false, reason: provider === 'none' ? 'Prompt None shows no prompt row' : `${PROVIDER_NAMES[provider] ?? provider} draws the prompt`};
  if (surface === 'contextRail' && configuration.contextRail.mode === 'off') return {available: false, reason: 'Context Rail is Off (/prompt → Rail)'};
  return {available: true};
}
