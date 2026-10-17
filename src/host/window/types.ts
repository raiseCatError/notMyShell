import type {Operation} from './run.js';

/**
 * The window NMSh runs in, as one explicit capability. Every outcome but
 * `available` means: no offer, and the window is left exactly as it is.
 *
 *   unsupported        this host or platform has no safe mechanism NMSh uses
 *   permissionDenied   the host refused (macOS Automation, kitty remote control)
 *   uncertainIdentity  NMSh could not prove which window is its own
 *   alreadyMaximized   the window already fills the screen's usable area
 *   fullscreen         the window is in (native) fullscreen
 *   failed             the host did not answer, or answered unexpectedly
 */
export type Refusal = 'unsupported' | 'permissionDenied' | 'uncertainIdentity' | 'alreadyMaximized' | 'fullscreen' | 'failed';
export interface Refused {outcome: Refusal; reason: string}

export const refuse = (outcome: Refusal, reason: string): Refused => ({outcome, reason});

export type Probe = {outcome: 'available'; window: OwnedWindow} | Refused;

/** A window proven to be NMSh's own, seen in its normal state. Each step re-verifies before it acts. */
export interface OwnedWindow {
  host: string;
  /** Maximize from the state NMSh saw; anything else is left alone. Never a blind toggle. */
  maximize(): Operation<MaximizeResult>;
}

export type MaximizeResult =
  | {outcome: 'maximized'; restore(): Operation<RestoreResult>}
  | {outcome: 'unchanged' | Refusal; reason: string};

/** `left`: the window is no longer as NMSh left it (moved, resized, unmaximized, fullscreened, closed). */
export type RestoreResult = {outcome: 'restored'} | {outcome: 'left' | 'failed'; reason: string};

export interface WindowHost {
  name: string;
  /** Read-only: identity and state, nothing changes. */
  probe(): Operation<Probe>;
}
