import {CONTEXT_MODULE_REGISTRY, modulePlacement, type ContextModuleConfig, type ContextSurface} from '../prompt/configuration.js';

/** Placement is policy over descriptions/config, never over filesystem or process state. */
export function routeModule(module: ContextModuleConfig): ContextSurface | 'hidden' {
  if (!module.visible || module.surface === 'hidden') return 'hidden';
  const definition = CONTEXT_MODULE_REGISTRY[module.id];
  const requested = module.surface === 'auto' ? definition.preferredSurface
    : module.surface ?? (modulePlacement(module) === 'right' ? 'rightContext' : 'mainPrompt');
  return definition.supportedSurfaces.includes(requested) ? requested : 'hidden';
}
