import {homedir} from 'node:os';
import type {SessionInfo} from './SessionProtocol.js';
import {liveStatusParts} from './liveStatus.js';

/** A path under the home directory as ~/…, so status stays visible in narrow rows. */
export function tildePath(path: string, home = homedir()): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Plain factual listing for `nmsh --sessions`: one live session per line. The
 * same facts /sessions shows (backend, state); the CLI keeps full ids for --attach.
 */
export function formatSessionList(sessions: readonly SessionInfo[], now: number): string {
  if (sessions.length === 0) return 'No live NMSh sessions.\n';
  return sessions.map(session => [session.id, session.state, `pid ${session.pid}`, `age ${formatAge(now - session.createdAt)}`,
    session.cwd, liveStatusParts(session, now).join(' · '), `shell ${session.shell ?? 'zsh'}`].join('  ')).join('\n') + '\n';
}
