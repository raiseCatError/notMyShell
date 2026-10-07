import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {CursorSettings} from '../prompt/configuration.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {inspectFile, planAppend, planCreate, type PlanResult} from '../ask/fileEdit.js';
import {effectPalette} from './palette.js';
import {GHOSTTY_BACKEND} from './backends.js';

/**
 * Host-native cursor effects through each terminal's own documented
 * features, set up once with a verified edit:
 *
 *   Ghostty  one optional include line in its config (`config-file = ?…`)
 *            pointing at an NMSh-managed fragment with `custom-shader`
 *            (shaders stack, so the person's own shaders keep working).
 *   Kitty    one `include …` line pointing at an NMSh-managed fragment with
 *            the built-in `cursor_trail` options.
 *
 * After that first edit (shown and confirmed), NMSh only rewrites its own
 * fragment and shader files. It never removes or replaces the person's own
 * shader, theme, font or keybinding lines. Native effects apply to the whole
 * terminal surface (including vim); the setup screen says so.
 */
export type NativeHost = 'ghostty' | 'kitty';

export const nativeHostLabel = (host: NativeHost) => host === 'ghostty' ? 'Ghostty' : 'Kitty';

export function managedDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'cursor');
}

export function fragmentPath(host: NativeHost, env: NodeJS.ProcessEnv = process.env): string {
  return join(managedDirectory(env), host === 'ghostty' ? 'ghostty-cursor.conf' : 'kitty-cursor.conf');
}

export function shaderPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(managedDirectory(env), 'nmsh-cursor.glsl');
}

/** The host's main config file (the one place the single include line goes). */
export function hostConfigPath(host: NativeHost, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config');
  if (host === 'kitty') return join(env.KITTY_CONFIG_DIRECTORY || join(xdg, 'kitty'), 'kitty.conf');
  const xdgPath = join(xdg, 'ghostty', 'config');
  const macPath = join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config');
  return platform === 'darwin' && !existsSync(xdgPath) && existsSync(macPath) ? macPath : xdgPath;
}

export function includeLine(host: NativeHost, env: NodeJS.ProcessEnv = process.env): string {
  // Ghostty's "?" prefix makes the include optional: removing NMSh's folder never breaks the person's config.
  return host === 'ghostty' ? `config-file = ?${fragmentPath('ghostty', env)}` : `include ${fragmentPath('kitty', env)}`;
}

export function nativeCursorIntegrated(host: NativeHost, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const config = readFileSync(hostConfigPath(host, env), 'utf8');
    return config.split('\n').some(line => line.trim() === includeLine(host, env)) && existsSync(fragmentPath(host, env));
  } catch { return false; }
}

/** Lines in the person's own config that touch the same feature: shown before setup, never edited. */
export function relatedSettings(host: NativeHost, env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const pattern = host === 'ghostty' ? /^\s*custom-shader(?:-animation)?\s*=/u : /^\s*cursor_trail\w*\s/u;
    return readFileSync(hostConfigPath(host, env), 'utf8').split('\n').filter(line => pattern.test(line)).slice(0, 8);
  } catch { return []; }
}

/**
 * The one verified edit setup needs: append the include line (or create the
 * config with only that line). Everything else NMSh writes is its own file.
 */
export function setupPlan(host: NativeHost, env: NodeJS.ProcessEnv = process.env, home = homedir()): {configPath: string; plan: PlanResult; related: string[]} {
  const configPath = hostConfigPath(host, env, process.platform, home);
  const roots = [home];
  const facts = inspectFile(configPath, roots);
  const line = includeLine(host, env);
  const plan = facts.refusal === 'does not exist' ? planCreate(configPath, `${line}\n`, roots) : planAppend(facts, 'text', `# NMSh cursor effects (managed file; remove this line to turn them off)\n${line}`);
  return {configPath, plan, related: relatedSettings(host, env)};
}

const hex = (color: {red: number; green: number; blue: number}) => `#${[color.red, color.green, color.blue].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const vec3 = (color: {red: number; green: number; blue: number}) => `vec3(${(color.red / 255).toFixed(3)}, ${(color.green / 255).toFixed(3)}, ${(color.blue / 255).toFixed(3)})`;

/** The managed fragment for a host, from the person's cursor settings. */
export function fragmentContent(host: NativeHost, settings: CursorSettings, env: NodeJS.ProcessEnv = process.env): string {
  const header = '# Managed by NMSh (/cursor). Edits here are replaced; your own config is never changed by NMSh after setup.\n';
  if (host === 'ghostty') {
    // Only what NMSh's shader really draws counts: Smooth, Lightning, Railgun, Wireframe and idle effects leave the shader off.
    const active = GHOSTTY_BACKEND.support.motion.includes(settings.motion) || GHOSTTY_BACKEND.support.effect.includes(settings.effect);
    return `${header}${active ? `custom-shader = ${shaderPath(env)}\ncustom-shader-animation = true\n` : ''}`;
  }
  const palette = effectPalette(settings);
  const decay = {low: '0.15 0.5', medium: '0.1 0.4', high: '0.05 0.25'}[settings.speed];
  const trail = settings.motion === 'off' ? 0 : 3;
  return `${header}cursor_trail ${trail}\ncursor_trail_decay ${decay}\ncursor_trail_start_threshold ${Math.max(1, Math.round(settings.advanced.moveThreshold + 1))}\n`
    + (settings.trail.source !== 'cursor' || settings.color.source !== 'host' ? `cursor_trail_color ${hex(palette.trail[0] ?? palette.caret)}\n` : '');
}

/**
 * NMSh's own Ghostty cursor shader (GPL-3.0-only, written for NMSh; no
 * third-party shader code). It uses Ghostty's documented cursor uniforms:
 * the smear/tail is a quad between the previous and current cursor rects
 * fading after the change; Fire adds a short flickering glow above the
 * caret; Sparks scatter along the path; Ripple a ring at the destination.
 * Nothing else is drawn (see GHOSTTY_BACKEND.support).
 */
export function shaderSource(settings: CursorSettings): string {
  const palette = effectPalette(settings);
  const duration = (settings.advanced.longMoveMs * {low: 1.45, medium: 1, high: 0.65}[settings.speed] / 1000).toFixed(3);
  const tail = settings.motion === 'tail' ? 1 : 0;
  const smear = settings.motion === 'smear' || settings.motion === 'tail' ? 1 : 0;
  const fire = settings.effect === 'fire' ? 1 : 0;
  const ripple = settings.effect === 'ripple' ? 1 : 0;
  const sparks = settings.effect === 'sparks' ? 1 : 0;
  return `// NMSh cursor effect for Ghostty. Generated by NMSh from /cursor settings; GPL-3.0-only.
// Uses Ghostty's cursor uniforms: iCurrentCursor, iPreviousCursor (xy = top-left, zw = size, pixels) and iTimeCursorChange.
const float DURATION = ${duration};
const vec3 TRAIL = ${vec3(palette.trail[0] ?? palette.caret)};
const vec3 HOT = ${vec3(palette.particles[0] ?? palette.caret)};
const vec3 COOL = ${vec3(palette.particles[palette.particles.length - 1] ?? palette.caret)};

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec2 current = iCurrentCursor.xy + vec2(iCurrentCursor.z * 0.5, -iCurrentCursor.w * 0.5);
  vec2 previous = iPreviousCursor.xy + vec2(iPreviousCursor.z * 0.5, -iPreviousCursor.w * 0.5);
  float age = iTime - iTimeCursorChange;
  float progress = clamp(age / DURATION, 0.0, 1.0);
  float fade = 1.0 - progress;
  vec3 color = base.rgb;
  float width = max(iCurrentCursor.z, 1.0) * 0.5;
  if (${smear} == 1 && fade > 0.0) {
    vec2 head = mix(previous, current, smoothstep(0.0, 1.0, progress * 1.6));
    float d = segmentDistance(fragCoord, previous, head);
    float along = clamp(dot(fragCoord - previous, head - previous) / max(dot(head - previous, head - previous), 1e-4), 0.0, 1.0);
    float taper = ${tail} == 1 ? pow(along, 1.6) : 1.0;
    float band = smoothstep(width * (0.4 + 0.6 * taper), 0.0, d) * fade * taper;
    color = mix(color, TRAIL, band * 0.75);
  }
  if (${fire} == 1) {
    vec2 rel = fragCoord - current;
    float flame = smoothstep(iCurrentCursor.w * 1.4, 0.0, length(rel * vec2(1.6, 0.8) - vec2(0.0, iCurrentCursor.w * 0.4)));
    float flicker = 0.75 + 0.25 * sin(iTime * 23.0 + hash(floor(fragCoord / 3.0)) * 6.28);
    float heat = flame * flicker * (0.35 + 0.65 * fade);
    color = mix(color, mix(COOL, HOT, flame), heat * 0.6);
  }
  if (${sparks} == 1 && fade > 0.0) {
    vec2 cell = floor(fragCoord / 4.0);
    float spark = step(0.985, hash(cell + floor(iTime * 30.0))) * smoothstep(iCurrentCursor.z * 4.0, 0.0, segmentDistance(fragCoord, previous, current));
    color = mix(color, HOT, spark * fade);
  }
  if (${ripple} == 1 && fade > 0.0) {
    float ring = abs(length(fragCoord - current) - progress * iCurrentCursor.z * 6.0);
    color = mix(color, TRAIL, smoothstep(2.0, 0.0, ring) * fade * 0.6);
  }
  fragColor = vec4(color, base.a);
}
`;
}

export type ManagedFile = 'fragment' | 'shader';

/** What actually changed on disk when managed files were refreshed. Identical files are not rewritten. */
export interface ManagedWrite {changed: ManagedFile[]}

/** Write NMSh's own managed files (fragment and shader), only the ones whose content differs. Never touches the host's main config. */
export function writeManagedFiles(host: NativeHost, settings: CursorSettings, env: NodeJS.ProcessEnv = process.env): ManagedWrite {
  const changed: ManagedFile[] = [];
  const write = (kind: ManagedFile, path: string, content: string) => {
    try { if (readFileSync(path, 'utf8') === content) return; } catch { /* missing: written below */ }
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, content, {mode: 0o644});
    renameSync(temporary, path);
    changed.push(kind);
  };
  if (host === 'ghostty') write('shader', shaderPath(env), shaderSource(settings));
  write('fragment', fragmentPath(host, env), fragmentContent(host, settings, env));
  return {changed};
}

/**
 * The one line to show after managed files changed, or undefined when nothing
 * needs doing. NMSh never restarts the terminal and never signals its process
 * (an unhandled signal would end the window): a changed fragment is part of
 * the host's configuration, so the person reloads it with the host's own
 * documented shortcut; a shader-only change leaves the configuration alone,
 * and the line says what to do if the terminal has not picked it up.
 */
export function reloadInstruction(host: NativeHost, write: ManagedWrite, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!write.changed.length) return undefined;
  const mac = platform === 'darwin';
  if (host === 'ghostty') {
    if (write.changed.includes('fragment')) return `Reload Ghostty config: ${mac ? '⌘⇧,' : 'Ctrl+Shift+,'}`;
    return `Cursor shader updated · if it does not apply, reload Ghostty config: ${mac ? '⌘⇧,' : 'Ctrl+Shift+,'}`;
  }
  return `Reload Kitty config: ${mac ? '⌃⌘,' : 'Ctrl+Shift+F5'}`;
}
