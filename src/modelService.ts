// Entry point for the user-global local model service. Started on demand by
// an NMSh window only when local understanding is enabled for a feature;
// exits by itself when no window needs it.
import {defaultRuntimeDir, ensurePrivateRuntimeDir} from './session/runtimeDir.js';
import {resolveCommand} from './providers/providers.js';
import {ModelService, modelSocketPath, serveModelService} from './understanding/ModelService.js';
import {runtimeFor} from './understanding/runtimes.js';
import {readBuildIdentity} from './buildInfo.js';

const runtimeDir = defaultRuntimeDir();
ensurePrivateRuntimeDir(runtimeDir);
let server: Awaited<ReturnType<typeof serveModelService>>;
const build = (() => { try { const id = readBuildIdentity(); return `${id.version} ${id.commit}`; } catch { return undefined; } })();
const service = new ModelService({runtimeFor: model => runtimeFor(model, name => resolveCommand(name)), ...(build ? {build} : {}),
  onExit: () => { server?.close(); process.exit(0); }});
server = await serveModelService(modelSocketPath(runtimeDir), service);
// Another window's service already owns the socket: this one is not needed.
if (!server) process.exit(0);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => { void service.unload().finally(() => process.exit(0)); });
