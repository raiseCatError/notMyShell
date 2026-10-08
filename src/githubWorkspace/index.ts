/**
 * GitHub PR & issue workspace core (#338, phase 1): read-only data access,
 * GitHub-compatible search, PR/issue detail, diff review model, merge
 * *planning* (never execution), keyboard controller and pure renderer.
 * Not yet wired into TerminalApp; see docs/architecture/github-workspace.md.
 */
export * from './model.js';
export * from './query.js';
export * from './sanitize.js';
export * from './transport.js';
export * from './source.js';
export * from './service.js';
export * from './diff.js';
export * from './mergePlan.js';
export * from './controller.js';
export * from './render.js';
