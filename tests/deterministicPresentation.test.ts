import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {presentationNow} from '../src/presentation/environment.js';

test('deterministic presentation keeps Vespyr in its stable open frame without a blink timer', () => {
  const previous = process.env.NMSH_DETERMINISTIC;
  process.env.NMSH_DETERMINISTIC = '1';
  let app: TerminalApp | undefined;
  try {
    app = new TerminalApp();
    assert.equal(app['welcomeBlinkTimer'], undefined);
    assert.ok(app['output'].transcript().welcome);
    assert.doesNotMatch(app['output'].wrapped(80)[1]!.plain, /▂/u, 'welcome stays in its open-eye frame');
  } finally {
    app?.['stop'](0);
    app?.['session'].kill();
    if (previous === undefined) delete process.env.NMSH_DETERMINISTIC;
    else process.env.NMSH_DETERMINISTIC = previous;
  }
});

test('deterministic presentation helpers leave user config bytes untouched', async () => {
  const previousDeterministic = process.env.NMSH_DETERMINISTIC;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = await mkdtemp(join(tmpdir(), 'nmsh-deterministic-'));
  const configDirectory = join(configHome, 'nmsh');
  const configPath = join(configDirectory, 'config.json');
  const configContents = '{"provider":"nmsh","onboardingComplete":true}\n';
  await mkdir(configDirectory, {recursive: true});
  await writeFile(configPath, configContents);
  process.env.NMSH_DETERMINISTIC = '1';
  process.env.XDG_CONFIG_HOME = configHome;
  try {
    assert.ok(presentationNow() instanceof Date);
    assert.equal(await readFile(configPath, 'utf8'), configContents);
  } finally {
    if (previousDeterministic === undefined) delete process.env.NMSH_DETERMINISTIC;
    else process.env.NMSH_DETERMINISTIC = previousDeterministic;
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await rm(configHome, {recursive: true, force: true});
  }
});
