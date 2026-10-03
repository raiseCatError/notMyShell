// Static extractor for withfig/autocomplete specs (MIT).
//
// Reads the TypeScript sources as syntax trees with the TypeScript compiler
// and resolves ONLY inert values: string/number/boolean literals, array and
// object literals, local `const` initializers, imports of other spec files,
// spreads of those, and `loadSpec: "<path>"` references to sibling spec
// files. Nothing is executed: functions, generators, calls and computed
// expressions are dropped and counted as degradations. The output is NMSh's
// own compact data form (see build.mjs).

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import ts from 'typescript';

const UNSUPPORTED = Symbol('unsupported');
const MAX_DEPTH = 64;

export class FigExtractor {
  constructor(srcRoot) {
    this.srcRoot = srcRoot;
    this.files = new Map();
    this.degraded = 0;
    this.loadSpecDepth = 0;
  }

  /** Resolve a module specifier from `fromFile` to a .ts file path, or undefined. */
  resolveModule(fromFile, specifier) {
    if (!specifier.startsWith('.')) return undefined; // packages (helpers) are never imported
    const base = resolve(dirname(fromFile), specifier);
    for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
    return undefined;
  }

  parse(path) {
    if (this.files.has(path)) return this.files.get(path);
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const locals = new Map();
    const imports = new Map();
    const exports = new Map();
    let defaultExport;
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = this.resolveModule(path, statement.moduleSpecifier.text);
        const clause = statement.importClause;
        if (!clause || !target) continue;
        if (clause.name) imports.set(clause.name.text, {file: target, name: 'default'});
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) imports.set(element.name.text, {file: target, name: (element.propertyName ?? element.name).text});
        }
      } else if (ts.isVariableStatement(statement)) {
        const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            locals.set(declaration.name.text, declaration.initializer);
            if (exported) exports.set(declaration.name.text, declaration.initializer);
          }
        }
      } else if (ts.isExportAssignment(statement)) {
        defaultExport = statement.expression;
      } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && !statement.moduleSpecifier) {
        for (const element of statement.exportClause.elements) {
          const local = locals.get((element.propertyName ?? element.name).text);
          if (local) exports.set(element.name.text, local);
        }
      }
    }
    const parsed = {path, source, locals, imports, exports, defaultExport};
    this.files.set(path, parsed);
    return parsed;
  }

  /** The value of an export of a file ('default' or a name), statically. */
  exportValue(file, name, depth = 0) {
    const parsed = this.parse(file);
    const node = name === 'default' ? parsed.defaultExport : parsed.exports.get(name) ?? parsed.locals.get(name);
    if (!node) return UNSUPPORTED;
    // Fig's createVersionedSpec(name, versionFiles) loads the newest version file's default export:
    // reproduced statically (the last listed version), never by running the helper.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createVersionedSpec' && node.arguments.length === 2) {
      const versions = this.value(node.arguments[1], parsed, depth + 1);
      if (Array.isArray(versions) && versions.length && typeof versions.at(-1) === 'string') {
        const versionFile = this.resolveModule(file, `./${versions.at(-1)}`);
        if (versionFile) return this.exportValue(versionFile, 'default', depth + 1);
      }
      return UNSUPPORTED;
    }
    return this.value(node, parsed, depth + 1);
  }

  value(node, file, depth = 0, seen = new Set()) {
    if (depth > MAX_DEPTH) { this.degraded += 1; return UNSUPPORTED; }
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)) node = node.expression;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
    if (ts.isArrayLiteralExpression(node)) {
      const out = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) {
          const spread = this.value(element.expression, file, depth + 1, seen);
          if (Array.isArray(spread)) out.push(...spread); else this.degraded += 1;
          continue;
        }
        const item = this.value(element, file, depth + 1, seen);
        if (item === UNSUPPORTED) this.degraded += 1; else out.push(item);
      }
      return out;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const out = {};
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = this.value(property.expression, file, depth + 1, seen);
          if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(out, spread); else this.degraded += 1;
          continue;
        }
        let key;
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = property.name;
          key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
        }
        if (key === undefined) { this.degraded += 1; continue; } // methods, getters, computed keys
        const item = ts.isShorthandPropertyAssignment(property) ? this.identifier(property.name.text, file, depth + 1, seen) : this.value(property.initializer, file, depth + 1, seen);
        if (item === UNSUPPORTED) { this.degraded += 1; continue; }
        out[key] = item;
      }
      return out;
    }
    if (ts.isIdentifier(node)) return this.identifier(node.text, file, depth + 1, seen);
    if (ts.isPropertyAccessExpression(node)) {
      const target = this.value(node.expression, file, depth + 1, seen);
      if (target && typeof target === 'object' && Object.hasOwn(target, node.name.text)) return target[node.name.text];
      return UNSUPPORTED;
    }
    if (ts.isElementAccessExpression(node) && (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression))) {
      const target = this.value(node.expression, file, depth + 1, seen);
      const key = node.argumentExpression.text;
      if (target && typeof target === 'object' && Object.hasOwn(target, key)) return target[key];
      return UNSUPPORTED;
    }
    // Functions, generators, calls, templates with substitutions, conditionals: dynamic. Never evaluated.
    return UNSUPPORTED;
  }

  identifier(name, file, depth, seen) {
    const key = `${file.path}#${name}`;
    if (seen.has(key)) return UNSUPPORTED; // cycles
    const next = new Set(seen).add(key);
    const local = file.locals.get(name);
    if (local) return this.value(local, file, depth + 1, next);
    const imported = file.imports.get(name);
    if (imported) {
      const target = this.parse(imported.file);
      const node = imported.name === 'default' ? target.defaultExport : target.exports.get(imported.name) ?? target.locals.get(imported.name);
      return node ? this.value(node, target, depth + 1, next) : UNSUPPORTED;
    }
    return UNSUPPORTED;
  }

  /** A spec file (relative to src, without .ts) for `loadSpec: "aws/s3"`. */
  loadSpecFile(spec) {
    if (typeof spec !== 'string' || !/^[\w@./+-]+$/u.test(spec) || spec.includes('..')) return undefined;
    const direct = join(this.srcRoot, `${spec}.ts`);
    if (existsSync(direct)) return direct;
    const index = join(this.srcRoot, spec, 'index.ts');
    return existsSync(index) ? index : undefined;
  }

  relative(path) { return relative(this.srcRoot, path); }
}

export {UNSUPPORTED};

// ---------------------------------------------------------------- conversion to NMSh form

const asNames = value => (Array.isArray(value) ? value : [value]).filter(name => typeof name === 'string' && /^[^\s\u0000-\u001f]{1,128}$/u.test(name));
const text = value => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 300) : undefined);

function convertArg(arg, stats) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return undefined;
  const out = {};
  const name = text(arg.name);
  if (name) out.n = name;
  const description = text(arg.description);
  if (description) out.d = description;
  if (arg.suggestions !== undefined) {
    const choices = [];
    for (const suggestion of Array.isArray(arg.suggestions) ? arg.suggestions : [arg.suggestions]) {
      if (typeof suggestion === 'string') { if (asNames(suggestion).length) choices.push([suggestion]); }
      else if (suggestion && typeof suggestion === 'object') {
        for (const value of asNames(suggestion.name)) choices.push(text(suggestion.description) ? [value, text(suggestion.description)] : [value]);
      }
    }
    if (choices.length) out.c = choices.slice(0, 2000);
  }
  const template = Array.isArray(arg.template) ? arg.template : arg.template ? [arg.template] : [];
  if (template.includes('filepaths')) out.t = 'files';
  else if (template.includes('folders')) out.t = 'folders';
  if (arg.isOptional === true) out.o = 1;
  if (arg.isVariadic === true) out.v = 1;
  if (arg.generators !== undefined || arg.generator !== undefined) stats.dynamic += 1;
  return out;
}

function convertArgs(args, stats) {
  if (args === undefined) return undefined;
  const list = (Array.isArray(args) ? args : [args]).map(arg => convertArg(arg, stats)).filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * Fig spec (static value) → NMSh node: {n: names, d?, s?: subcommands, o?: options, a?: args}.
 * `loadSpec` strings pull in the referenced spec file statically.
 */
export function convertSpec(spec, extractor, stats, depth = 0) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || depth > 40) return undefined;
  let source = spec;
  if (typeof spec.loadSpec === 'string' && extractor.loadSpecDepth < 4) {
    const file = extractor.loadSpecFile(spec.loadSpec);
    if (file) {
      extractor.loadSpecDepth += 1;
      try {
        const loaded = extractor.exportValue(file, 'default');
        if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
          source = {...loaded, ...spec, subcommands: spec.subcommands ?? loaded.subcommands, options: spec.options ?? loaded.options, args: spec.args ?? loaded.args,
            description: spec.description ?? loaded.description};
          stats.loadSpecs += 1;
        } else stats.dynamic += 1;
      } finally { extractor.loadSpecDepth -= 1; }
    } else stats.dynamic += 1; // a loadSpec that is a function or names a missing file
  } else if (spec.loadSpec !== undefined || spec.generateSpec !== undefined) stats.dynamic += 1;
  const names = asNames(source.name);
  if (!names.length || source.hidden === true) return undefined;
  const node = {n: names};
  const description = text(source.description);
  if (description) node.d = description;
  if (Array.isArray(source.subcommands)) {
    const subs = source.subcommands.map(sub => convertSpec(sub, extractor, stats, depth + 1)).filter(Boolean);
    if (subs.length) node.s = subs;
    stats.subcommands += subs.length;
  }
  if (Array.isArray(source.options)) {
    const options = [];
    for (const option of source.options) {
      if (!option || typeof option !== 'object' || option.hidden === true) continue;
      const optionNames = asNames(option.name);
      if (!optionNames.length) continue;
      const converted = {n: optionNames};
      const optionDescription = text(option.description);
      if (optionDescription) converted.d = optionDescription;
      const args = convertArgs(option.args, stats);
      if (args) converted.a = args;
      if (option.isPersistent === true) converted.p = 1;
      options.push(converted);
    }
    if (options.length) node.o = options;
    stats.options += options.length;
  }
  const args = convertArgs(source.args, stats);
  if (args) node.a = args;
  return node;
}
