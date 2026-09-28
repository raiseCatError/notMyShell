// Entry point for the local session service (nmshd). Started on demand by the
// frontend; exits by itself once no sessions or frontends remain.
import {runSessionService} from './session/SessionService.js';
import {defaultRuntimeDir} from './session/runtimeDir.js';

try {
  await runSessionService({runtimeDir: defaultRuntimeDir()});
  process.exit(0);
} catch {
  process.exit(1);
}
