import {existsSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {loadPromptConfiguration, savePromptConfiguration} from '../prompt/configuration.js';
import {promptConfigurationPath} from '../configuration/paths.js';
import {CATEGORY_IDS, exportSettings, formatImportPlan, parseCategories, planImport, PORTABLE_CATEGORIES, readPortableFile} from '../configuration/portability.js';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Ask a yes/no question; resolves false on anything but an explicit yes. Undefined when not interactive. */
  confirm?: (question: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  version?: string;
}

export const CONFIG_USAGE = `Usage:
  nmsh config categories
  nmsh config export [--categories a,b] [--output FILE [--force]]
  nmsh config import FILE [--categories a,b] [--yes]
  nmsh config path

Exports are human-readable, versioned JSON. They never include history,
transcripts, credentials, onboarding progress or machine-specific paths.
Import previews every change first and starts on No.
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Interactive confirmation that defaults to No. */
export async function ttyConfirm(question: string): Promise<boolean> {
  const rl = createInterface({input: process.stdin, output: process.stderr});
  try { return /^(?:y|yes)$/iu.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

export async function runConfigCommand(args: string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env;
  const path = promptConfigurationPath(env);
  const [action, ...rest] = args;
  try {
    if (action === 'path') { io.out(`${path}\n`); return 0; }
    if (action === 'categories') {
      for (const id of CATEGORY_IDS) io.out(`${id.padEnd(14)} ${PORTABLE_CATEGORIES[id].join(', ')}\n`);
      return 0;
    }
    if (action === 'export') {
      const categories = parseCategories(option(rest, '--categories'));
      const document = exportSettings(loadPromptConfiguration(path), categories, {version: io.version, now: new Date()});
      const text = `${JSON.stringify(document, null, 2)}\n`;
      const output = option(rest, '--output');
      if (!output) { io.out(text); return 0; }
      if (existsSync(output) && !rest.includes('--force')) { io.err(`${output} exists; add --force to replace it.\n`); return 1; }
      writeFileSync(output, text, {mode: 0o600});
      io.err(`Exported ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} to ${output}\n`);
      return 0;
    }
    if (action === 'import') {
      const file = rest.find(item => !item.startsWith('--') && item !== option(rest, '--categories'));
      if (!file) { io.err(CONFIG_USAGE); return 2; }
      const categories = parseCategories(option(rest, '--categories'));
      const current = loadPromptConfiguration(path);
      const plan = planImport(current, readPortableFile(file), categories);
      io.out(formatImportPlan(plan));
      if (plan.changes.length === 0) return 0;
      let agreed = rest.includes('--yes');
      if (!agreed) {
        if (!io.confirm) { io.err('Not applied. Re-run with --yes to apply this preview non-interactively.\n'); return 2; }
        agreed = await io.confirm('Apply these changes?');
      }
      if (!agreed) { io.err('Not applied; nothing changed.\n'); return 1; }
      // Same atomic, merge-preserving save every Settings change uses.
      savePromptConfiguration(plan.next, path, current);
      io.err(`Applied ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'} to ${path}\n`);
      return 0;
    }
    io.err(CONFIG_USAGE);
    return 2;
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
