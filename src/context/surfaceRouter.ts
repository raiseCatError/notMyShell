import {modulePlacement, type ContextModuleConfig, type ContextSurface} from '../prompt/configuration.js';
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
