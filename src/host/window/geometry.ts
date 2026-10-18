import type {Command} from './run.js';

/** Global screen coordinates, top-left origin at the main display's top-left (AppleScript and CoreGraphics agree). */
export interface Rect {x: number; y: number; width: number; height: number}
export interface Screen {frame: Rect; visible: Rect}

/**
 * Read-only JXA: every screen's frame and visible frame (menu bar and Dock
 * excluded), converted from AppKit's bottom-left origin; with a window number,
 * that one CoreGraphics window's owner, layer and bounds. Needs no permission
 * (no window names are read) and changes nothing.
 */
export const GEOMETRY_SCRIPT = [
  'ObjC.import("AppKit"); ObjC.import("CoreGraphics");',
  'function run(argv) {',
  '  const screens = $.NSScreen.screens.js;',
  '  if (!screens.length) return JSON.stringify({screens: []});',
  '  const mainHeight = screens[0].frame.size.height;',
  '  const rect = r => ({x: r.origin.x, y: mainHeight - (r.origin.y + r.size.height), width: r.size.width, height: r.size.height});',
  '  const out = {screens: screens.map(s => ({frame: rect(s.frame), visible: rect(s.visibleFrame)}))};',
  '  const number = Number(argv[0]);',
  '  if (Number.isInteger(number) && number > 0) {',
  '    const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow, number))) || [];',
  '    const w = list.find(item => item.kCGWindowNumber === number);',
  '    if (w) out.window = {pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, onscreen: Boolean(w.kCGWindowIsOnscreen),',
  '      bounds: {x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height}};',
  '  }',
  '  return JSON.stringify(out);',
  '}',
].join('\n');

export const geometryCommand = (windowNumber?: number): Command => ({file: '/usr/bin/osascript',
  args: ['-l', 'JavaScript', '-e', GEOMETRY_SCRIPT, ...(windowNumber !== undefined ? [String(windowNumber)] : [])], timeoutMs: 4000});

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const asRect = (value: unknown): Rect | undefined => {
  const r = value as Partial<Rect> | undefined;
  return r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height) && r.width > 0 && r.height > 0 ? {x: r.x, y: r.y, width: r.width, height: r.height} : undefined;
};

export interface Geometry {screens: Screen[]; window?: {pid: number; layer: number; bounds: Rect}}

export function parseGeometry(stdout: string): Geometry | undefined {
  let value: {screens?: unknown; window?: {pid?: unknown; layer?: unknown; bounds?: unknown}};
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!Array.isArray(value.screens)) return undefined;
  const screens: Screen[] = [];
  for (const item of value.screens as Array<{frame?: unknown; visible?: unknown}>) {
    const frame = asRect(item?.frame), visible = asRect(item?.visible);
    if (!frame || !visible) return undefined;
    screens.push({frame, visible});
  }
  const bounds = asRect(value.window?.bounds);
  const window = value.window && finite(value.window.pid) && finite(value.window.layer) && bounds ? {pid: value.window.pid, layer: value.window.layer, bounds} : undefined;
  return {screens, ...(window ? {window} : {})};
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The display holding most of the window. */
export function screenFor(bounds: Rect, screens: readonly Screen[]): Screen | undefined {
  let best: Screen | undefined, area = 0;
  for (const screen of screens) {
    const shared = overlap(bounds, screen.frame);
    if (shared > area) { best = screen; area = shared; }
  }
  return best ?? screens[0];
}

export const sameRect = (a: Rect, b: Rect, tolerance = 2): boolean =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;

/**
 * `fullscreen`: the window is its display's whole frame (native fullscreen). `maximized`: it already fills the usable
 * area, allowing for a zoom rounded down to whole character cells. Anything else is `normal`.
 */
export function windowShape(bounds: Rect, screens: readonly Screen[]): 'fullscreen' | 'maximized' | 'normal' {
  const screen = screenFor(bounds, screens);
  if (!screen) return 'normal';
  if (sameRect(bounds, screen.frame)) return 'fullscreen';
  const visible = screen.visible;
  const fills = bounds.x <= visible.x + 12 && bounds.y <= visible.y + 12
    && bounds.width >= visible.width - 32 && bounds.height >= visible.height - 40;
  return fills ? 'maximized' : 'normal';
}

/** AppleScript bounds {left, top, right, bottom} ⇄ a rect. */
export const fromAppleBounds = (left: number, top: number, right: number, bottom: number): Rect => ({x: left, y: top, width: right - left, height: bottom - top});
export const appleBounds = (rect: Rect): string[] => [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height].map(value => String(Math.round(value)));
