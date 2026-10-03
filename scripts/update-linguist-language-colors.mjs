import {writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLanguageColors, renderLanguageColorsModule} from './lib/linguistLanguageColors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = await fetch('https://api.github.com/repos/github-linguist/linguist/commits/main', {
  headers: {'User-Agent': 'notMyShell-language-color-update'},
});
if (!api.ok) throw new Error(`Unable to read Linguist revision: HTTP ${api.status}`);
const {sha} = await api.json();
if (typeof sha !== 'string' || !/^[\da-f]{40}$/u.test(sha)) throw new Error('GitHub returned an invalid Linguist revision');

const sourceUrl = `https://raw.githubusercontent.com/github-linguist/linguist/${sha}/lib/linguist/languages.yml`;
const source = await fetch(sourceUrl, {headers: {'User-Agent': 'notMyShell-language-color-update'}});
if (!source.ok) throw new Error(`Unable to read Linguist language data: HTTP ${source.status}`);
const languages = parseLanguageColors(await source.text());
if (languages.length < 100) throw new Error(`Refusing to write incomplete Linguist data (${languages.length} entries)`);

const output = resolve(root, 'src/languages/linguistLanguageColors.generated.ts');
await writeFile(output, renderLanguageColorsModule(languages, sha));
process.stdout.write(`Wrote ${languages.length} language colors from Linguist ${sha}\n`);
