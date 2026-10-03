function yamlString(value) {
  const scalar = value.trim();
  if (scalar.startsWith('"')) return JSON.parse(scalar);
  if (scalar.startsWith("'")) return scalar.slice(1, scalar.lastIndexOf("'")).replaceAll("''", "'");
  return scalar.replace(/\s+#.*$/u, '').trim();
}

/** Extracts only Linguist's canonical names, official aliases, and CSS colors. */
export function parseLanguageColors(source) {
  const languages = [];
  let current;

  const finish = () => {
    if (current?.color) languages.push(current);
  };

  for (const line of source.split(/\r?\n/u)) {
    const header = /^([^\s#].*):\s*$/u.exec(line);
    if (header && !header[1].startsWith('---')) {
      finish();
      current = {name: yamlString(header[1]), aliases: [], color: undefined};
      continue;
    }
    if (!current) continue;

    const field = /^  ([\w-]+):(?:\s*(.*))?$/u.exec(line);
    if (field) {
      current.field = field[1];
      if (field[1] === 'color') {
        const color = yamlString(field[2] ?? '');
        if (/^#[\da-fA-F]{6}$/u.test(color)) current.color = color.toUpperCase();
      }
      continue;
    }

    if (current.field === 'aliases') {
      const alias = /^  -\s+(.+?)\s*$/u.exec(line);
      if (alias) {
        const value = yamlString(alias[1]);
        if (value) current.aliases.push(value);
      }
    }
  }
  finish();
  return languages.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function renderLanguageColorsModule(languages, revision) {
  const rows = languages.map(language => `  ${JSON.stringify(language.name)}: {color: ${JSON.stringify(language.color)}, aliases: ${JSON.stringify(language.aliases)}}`).join(',\n');
  return `/** Generated from github-linguist/linguist lib/linguist/languages.yml. Do not edit by hand. */\n` +
    `export const LINGUIST_LANGUAGE_COLORS_REVISION = ${JSON.stringify(revision)};\n` +
    `export const LINGUIST_LANGUAGE_COLORS = {\n${rows}\n} as const;\n`;
}
