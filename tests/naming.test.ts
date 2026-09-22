import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CLI_COMMAND, PRODUCT_ABBREVIATION, PRODUCT_NAME} from '../src/config.js';

test('product identity uses canonical notMyShell names', async () => {
  assert.equal(PRODUCT_NAME, 'notMyShell');
  assert.equal(PRODUCT_ABBREVIATION, 'NMSh');
  assert.equal(CLI_COMMAND, 'nmsh');

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    name: string;
    description: string;
    bin: Record<string, string>;
  };
  assert.equal(packageJson.name, 'nmsh');
  assert.equal(packageJson.bin.nmsh, 'bin/nmsh');
});

test('obsolete prototype branding is absent from product files', async () => {
  const files = ['README.md', 'package.json', 'src/index.ts'];
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    assert.ok(!/shell-ui-prototype|Shell UI prototype/iu.test(contents), file);
  }
});

