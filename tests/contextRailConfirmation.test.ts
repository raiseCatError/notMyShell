import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, savePromptConfiguration} from '../src/prompt/configuration.js';
import {promptConfigurationPath} from '../src/configuration/paths.js';
import {stripAnsi} from '../src/util/text.js';
import {railCompositionPreview} from '../src/prompt/railComposition.js';

for (const action of ['confirm', 'cancel', 'escape', 'alreadyInside'] as const) {
  test(`Rail Inside save: ${action} preserves explicit consent and saved geometry`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nmsh-rail-confirm-'));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = directory;
    const base = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
    base.onboardingComplete = true;
    base.toolsSetupComplete = true;
    base.composerLayout = 'twoLine';
    base.placement = action === 'alreadyInside' ? 'composer' : 'header';
    base.contextRail.mode = 'always';
    base.modules = base.modules.map(module => ({...module, visible: module.id === 'project' || module.id === 'shell',
      condition: 'always', surface: module.id === 'project' ? 'contextRail' : module.id === 'shell' ? 'rightContext' : 'hidden'}));
    savePromptConfiguration(base);
    const before = readFileSync(promptConfigurationPath(), 'utf8');
    const app = new TerminalApp();
    try {
      app['render'] = () => {};
      app['refreshProviderPrompt'] = async () => {};
      app['promptConfiguration'] = structuredClone(base);
      app['context'] = {cwd: '/qa', project: 'QA'};
      await app['startPromptSettings'](false);
      const state = app['promptPanelState']!;
      state.step = 'appearance'; state.view = 'rail'; state.selectedIndex = 4;
      app['handleKey']({kind: 'right'});
      assert.equal(state.draft.contextRail.integration, 'inside', 'Integration arrow edits only the Rail draft');
      const preview = app['promptPanelPreview'](104).map(stripAnsi);
      assert.equal(state.draft.placement, base.placement, 'Preview never mutates the draft Main geometry');
      assert.equal(readFileSync(promptConfigurationPath(), 'utf8'), before);
      await app['savePromptSettings']();
      if (action !== 'alreadyInside') {
        assert.equal(state.step, 'railInsideConfirm');
        assert.equal(state.selectedIndex, 1, 'Confirmation starts on Cancel');
        assert.equal(readFileSync(promptConfigurationPath(), 'utf8'), before, 'Neither setting persists before consent');
        assert.deepEqual(app['promptConfiguration'], base);
        if (action === 'cancel' || action === 'escape') {
          if (action === 'escape') app['handleKey']({kind: 'escape'});
          else await app['advancePromptPanel']();
          assert.equal(state.step, 'appearance');
          assert.equal(readFileSync(promptConfigurationPath(), 'utf8'), before);
          app['handleKey']({kind: 'escape'});
          await app['startPromptSettings'](false);
          assert.equal(app['promptPanelState']!.draft.contextRail.integration, 'outside');
          assert.equal(app['promptPanelState']!.draft.placement, 'header');
          return;
        }
        state.selectedIndex = 0;
        await app['advancePromptPanel']();
      }
      const saved = loadPromptConfiguration();
      assert.equal(saved.contextRail.integration, 'inside');
      assert.equal(saved.placement, 'composer');
      assert.equal(saved.composerLayout, 'twoLine');
      assert.equal(saved.composerDividers, true);
      const resulting = railCompositionPreview(app['promptContext'](), 100, saved).map(stripAnsi);
      assert.deepEqual(preview.slice(preview.indexOf('  Current') + 1, preview.indexOf('  Showcase')), resulting, 'Current previews the geometry actually saved');
      await app['startPromptSettings'](false);
      assert.equal(app['promptPanelState']!.draft.contextRail.integration, 'inside');
      assert.equal(app['promptPanelState']!.draft.placement, 'composer');
    } finally {
      app['stop'](0); app['session'].kill();
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
      rmSync(directory, {recursive: true, force: true});
    }
  });
}
