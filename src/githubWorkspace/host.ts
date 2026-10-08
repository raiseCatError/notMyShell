import type {Key} from '../terminal/keys.js';
import type {WorkspaceKey} from './controller.js';
import {parseRepository} from './sanitize.js';

/** `owner/name` from a github.com remote URL (https, ssh or scp form); anything else is not a GitHub repository. */
export function githubRepositoryFromRemote(url: string): string | undefined {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/u.exec(url.trim());
  const parsed = match ? parseRepository(match[1]!) : undefined;
  return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

/** NMSh's decoded keys as the workspace controller's keyboard model; keys it does not use return undefined. */
export function workspaceKey(key: Key): WorkspaceKey | undefined {
  switch (key.kind) {
    case 'up': case 'down': case 'pageUp': case 'pageDown': case 'enter': case 'escape': case 'backspace': return key.kind;
    case 'bufferHome': case 'lineHome': return 'home';
    case 'bufferEnd': case 'lineEnd': return 'end';
    case 'complete': case 'focusNext': return 'tab';
    case 'focusPrevious': return 'shiftTab';
    case 'text': return [...key.value].length === 1 ? {char: key.value} : undefined;
    default: return undefined;
  }
}
