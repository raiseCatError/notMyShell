// Entry point for the local session service (nmshd). Started on demand by the
// frontend; exits by itself once no sessions or frontends remain.
import {DEFAULT_MAX_SESSIONS, runSessionService} from './session/SessionService.js';
import {defaultRuntimeDir} from './session/runtimeDir.js';
import {DEFAULT_BACKLOG_LIMITS} from './session/StreamBacklog.js';

// Test/diagnostic overrides for the detached-output retention limits.
const limit = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

try {
  await runSessionService({runtimeDir: defaultRuntimeDir(), backlogLimits: {
    memoryBytes: limit('NMSH_BACKLOG_MEMORY_BYTES', DEFAULT_BACKLOG_LIMITS.memoryBytes),
    spoolBytes: limit('NMSH_BACKLOG_SPOOL_BYTES', DEFAULT_BACKLOG_LIMITS.spoolBytes),
  }, maxSessions: limit('NMSH_MAX_SESSIONS', DEFAULT_MAX_SESSIONS)});
  process.exit(0);
} catch {
  process.exit(1);
}
