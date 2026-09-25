import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {Key} from '../src/terminal/keys.js';

const ESCAPE: Key = {kind: 'escape'};

function makeApp(): TerminalApp {
  return new TerminalApp();
}

function cleanup(app: TerminalApp): void {
  app['stop'](0);
  app['session'].kill();
}

test('a panel opened from /settings returns to the settings root on Esc, not the composer', () => {
  const app = makeApp();
  try {
    app['settingsPanelState'] = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 2, glyphStyle: 'nerd', onboarding: false};
    app['handleKey']({kind: 'enter'});
    assert.ok(app['promptPanelState'], 'selecting Prompt from settings opens the prompt panel');
    assert.equal(app['settingsPanelState'], undefined);

    app['handleKey'](ESCAPE);
    assert.equal(app['promptPanelState'], undefined, 'Esc closes the prompt panel');
    assert.ok(app['settingsPanelState'], 'Esc returns to settings instead of the composer');
    assert.equal(app['settingsPanelState']!.section, 'root');
    assert.equal(app['settingsPanelState']!.view, 'settings');
    assert.equal(app['settingsPanelState']!.contentIndex, 2, 'settings reopens at the row it was launched from');
  } finally {
    cleanup(app);
  }
});

test('a panel opened directly via its slash command closes straight to the composer on Esc', async () => {
  const app = makeApp();
  try {
    await app['startPromptSettings'](false);
    assert.ok(app['promptPanelState']);
    assert.equal(app['settingsPanelState'], undefined);

    app['handleKey'](ESCAPE);
    assert.equal(app['promptPanelState'], undefined);
    assert.equal(app['settingsPanelState'], undefined, 'no settings panel appears for a directly-opened panel');
  } finally {
    cleanup(app);
  }
});

test('settings root closes to the composer on Esc', () => {
  const app = makeApp();
  try {
    app['settingsPanelState'] = {section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false};
    app['handleKey'](ESCAPE);
    assert.equal(app['settingsPanelState'], undefined);
  } finally {
    cleanup(app);
  }
});

test('a nested child step cancels back to its parent step, not the whole panel', () => {
  const app = makeApp();
  try {
    app['promptPanelState'] = {onboarding: false, step: 'starshipModules', selectedIndex: 0,
      draft: structuredClone(app['promptConfiguration']), saved: structuredClone(app['promptConfiguration']),
      starshipModules: [true, false]};
    app['handleKey'](ESCAPE);
    assert.ok(app['promptPanelState'], 'the panel stays open');
    assert.equal(app['promptPanelState']!.step, 'starship', 'Esc backs out one nested level');
  } finally {
    cleanup(app);
  }
});

test('a confirmation step cancels rather than confirming on Esc', () => {
  const app = makeApp();
  try {
    app['promptPanelState'] = {onboarding: false, step: 'p10kConfirm', selectedIndex: 0,
      draft: structuredClone(app['promptConfiguration']), saved: structuredClone(app['promptConfiguration']),
      p10kStatus: {installed: true, themePath: '/fake/theme', configPath: '/fake/.p10k.zsh', configExists: true}};
    app['handleKey'](ESCAPE);
    assert.equal(app['promptPanelState']!.step, 'powerlevel10k', 'Esc cancels the confirmation instead of proceeding');
  } finally {
    cleanup(app);
  }
});

test('repeated Esc from a deeply nested settings-opened panel eventually reaches the composer', () => {
  const app = makeApp();
  try {
    app['settingsPanelState'] = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 2, glyphStyle: 'nerd', onboarding: false};
    app['handleKey']({kind: 'enter'}); // settings -> prompt panel
    app['promptPanelState']!.step = 'starshipModules';

    app['handleKey'](ESCAPE); // nested child -> parent step
    assert.equal(app['promptPanelState']!.step, 'starship');

    app['handleKey'](ESCAPE); // panel root -> back to settings
    assert.equal(app['promptPanelState'], undefined);
    assert.ok(app['settingsPanelState']);

    app['handleKey'](ESCAPE); // settings root -> composer
    assert.equal(app['settingsPanelState'], undefined);
    assert.equal(app['promptPanelState'], undefined);
  } finally {
    cleanup(app);
  }
});

test('Esc with no panel open neither submits the composer nor reaches the managed shell', () => {
  const app = makeApp();
  try {
    app['editor'].insert('echo hello');
    let submitted = false;
    Object.defineProperty(app, 'submit', {value: async () => { submitted = true; }});
    let wroteToSession = false;
    const originalWrite = app['session'].write.bind(app['session']);
    app['session'].write = (data: string) => { wroteToSession = true; originalWrite(data); };

    app['handleKey'](ESCAPE);

    assert.equal(submitted, false, 'Esc must never submit composer text');
    assert.equal(wroteToSession, false, 'Esc must never leak escape bytes to the managed shell');
    assert.equal(app['editor'].text, 'echo hello', 'composer text is untouched');
  } finally {
    cleanup(app);
  }
});

test('the keyboard panel returns to settings on Esc when opened from there', () => {
  // Bypasses startKeyboard()'s real Ghostty-detection gate (environment-dependent)
  // to isolate the navigation-origin behavior it's responsible for setting up.
  const app = makeApp();
  try {
    app['panelOrigin'] = 'settings';
    app['panelOriginView'] = 'settings';
    app['panelOriginRow'] = 4;
    app['keyboardState'] = {selectedIndex: 0};
    app['handleKey'](ESCAPE);
    assert.equal(app['keyboardState'], undefined);
    assert.ok(app['settingsPanelState'], 'Esc returns to settings instead of the composer');
    assert.equal(app['settingsPanelState']!.contentIndex, 4);
  } finally {
    cleanup(app);
  }
});

test('the keyboard panel closes to the composer on Esc when opened directly', () => {
  const app = makeApp();
  try {
    app['panelOrigin'] = undefined;
    app['keyboardState'] = {selectedIndex: 0};
    app['handleKey'](ESCAPE);
    assert.equal(app['keyboardState'], undefined);
    assert.equal(app['settingsPanelState'], undefined);
  } finally {
    cleanup(app);
  }
});
