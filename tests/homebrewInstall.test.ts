import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectHomebrewInstall, detectInstall, installProvenanceLabel, planUpdate, type CommandRunner} from '../src/update/update.js';

const release = {tag: 'v0.18.0', version: '0.18.0', url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.18.0', summary: []};
const noGit: CommandRunner = {run: async () => { throw new Error('git must not run for a Homebrew install'); }};

test('Homebrew-installed NMSh: detected from the keg and its INSTALL_RECEIPT; /update never touches the Cellar', async () => {
  const prefix = mkdtempSync(join(tmpdir(), 'nmsh-brew-'));
  try {
    const keg = join(prefix, 'Cellar', 'nmsh', '0.16.0');
    const libexec = join(keg, 'libexec');
    mkdirSync(libexec, {recursive: true});
    // Without Homebrew's receipt, a look-alike path is not claimed as Homebrew.
    assert.equal(detectHomebrewInstall(libexec), undefined);
    writeFileSync(join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify({source: {tap: 'raisecaterror/tap'}}));
    mkdirSync(join(prefix, 'opt'));
    symlinkSync(keg, join(prefix, 'opt', 'nmsh'));
    const viaOpt = join(prefix, 'opt', 'nmsh', 'libexec');
    const install = await detectInstall(viaOpt, noGit);
    assert.equal(install.kind, 'homebrew');
    assert.deepEqual(install.kind === 'homebrew' && [install.version, install.tap], ['0.16.0', 'raisecaterror/tap']);
    const planned = await planUpdate(install, release, noGit, async () => { throw new Error('no network'); });
    assert.equal(planned.ok, false);
    assert.deepEqual(!planned.ok && planned.manual, ['brew update', 'brew upgrade nmsh']);
    assert.match(!planned.ok ? planned.reason : '', /Installed with Homebrew \(raisecaterror\/tap\); Homebrew owns these files/u);
    assert.equal(installProvenanceLabel(viaOpt), 'Homebrew (raisecaterror/tap) · update with brew upgrade nmsh');
    assert.match(installProvenanceLabel(prefix), /^other\/manual installation/u);
  } finally { rmSync(prefix, {recursive: true, force: true}); }
});
