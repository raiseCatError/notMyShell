import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {languageIdentityColor, normalizeLanguageName, UNKNOWN_LANGUAGE_IDENTITY_COLOR} from '../src/languages/linguistLanguageColors.js';
import {languageIdentity} from '../src/languages/linguistLanguageColors.js';
import {statusMeaning} from '../src/chroma/chroma.js';
import {parseLanguageColors, renderLanguageColorsModule} from '../scripts/lib/linguistLanguageColors.mjs';

test('known languages and official aliases resolve to Linguist identity colors', () => {
  assert.equal(languageIdentityColor('Rust'), '#DEA584');
  assert.equal(languageIdentityColor('TypeScript'), '#3178C6');
  assert.equal(languageIdentityColor('JS'), languageIdentityColor('JavaScript'));
});

test('language names normalize case, Unicode, and whitespace; unknown names use a neutral fallback', () => {
  assert.equal(normalizeLanguageName('  TYPEscript  '), 'typescript');
  assert.equal(languageIdentityColor('  TYPEscript  '), languageIdentityColor('TypeScript'));
  assert.equal(languageIdentityColor('  a language NMSh does not know '), UNKNOWN_LANGUAGE_IDENTITY_COLOR);
});

test('language identity remains separate from semantic status colors', () => {
  for (const name of ['Python', 'Rust', 'Swift', 'unknown']) {
    assert.equal(languageIdentity(name).kind, 'identity');
    assert.equal(statusMeaning(languageIdentity(name)), undefined);
  }
  assert.equal(UNKNOWN_LANGUAGE_IDENTITY_COLOR, '#8F8A98');
});

test('the checked-in generated table is deterministic for identical source input', async () => {
  const fixture = [
    '---',
    'Zulu:',
    '  color: "#abcdef"',
    '  aliases:',
    '  - zed',
    'Alpha:',
    '  color: "#123456"',
    'No Color:',
    '  type: data',
  ].join('\n');
  const first = renderLanguageColorsModule(parseLanguageColors(fixture), 'a'.repeat(40));
  const second = renderLanguageColorsModule(parseLanguageColors(fixture), 'a'.repeat(40));
  assert.equal(first, second);
  assert.ok(first.indexOf('"Alpha"') < first.indexOf('"Zulu"'));

  const generated = await readFile(join(process.cwd(), 'src/languages/linguistLanguageColors.generated.ts'), 'utf8');
  assert.match(generated, /LINGUIST_LANGUAGE_COLORS_REVISION = "[\da-f]{40}"/u);
});

test('runtime lookup is local and synchronous', () => {
  assert.equal(typeof languageIdentityColor('Go'), 'string');
  assert.equal(languageIdentityColor('Go') instanceof Promise, false);
});
