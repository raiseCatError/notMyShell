import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalApp } from '../src/app/TerminalApp.js';
import { UI_COLORS, foreground } from '../src/ui/palette.js';

const PRIMARY = foreground(UI_COLORS.primary);
const ACCENT = foreground(UI_COLORS.accent);
const ERROR = foreground(UI_COLORS.failure);
const SECONDARY = foreground(UI_COLORS.secondary);
const SUBTLE = foreground(UI_COLORS.subtle);
const STOPPED = foreground({red: 198, green: 156, blue: 109}); // amber/string
const RESET = '\u001B[0m';

function getRowPlain(app: TerminalApp, text: string): string | undefined {
    const wrapped = app['output'].wrapped(100);
    return wrapped.map(r => r.plain).find(r => r.includes(text));
}

function getRowAnsi(app: TerminalApp, text: string): string | undefined {
    const wrapped = app['output'].wrapped(100);
    return wrapped.find(r => r.plain.includes(text))?.ansi;
}

function submitCommand(app: TerminalApp, cmd: string) {
    for (const char of cmd.split('')) {
        app.onInput(char);
    }
    app.onInput('\r');
}

function withApp(fn: (app: TerminalApp) => void | Promise<void>) {
    return async () => {
        const app = new TerminalApp();
        try {
            await fn(app);
        } finally {
            app['stop'](0);
            app['session'].kill();
        }
    };
}

test('KNOWN COMMAND - submitted command retains ACCENT color', withApp(async (app) => {
    app['semanticService'].cache.set('git', 'executable');
    submitCommand(app, 'git status');
    
    const plain = getRowPlain(app, 'git status');
    assert.ok(plain?.includes('❯ git status'), 'plain text should include prompt');
    
    const ansi = getRowAnsi(app, 'git status');
    assert.ok(ansi?.includes(`${RESET}${ACCENT}git${RESET}${PRIMARY} status`), 'git should be accent, status should be primary');
}));

test('UNKNOWN COMMAND - submitted command retains ERROR color', withApp(async (app) => {
    app['semanticService'].cache.set('gti', 'unknown');
    submitCommand(app, 'gti status');
    
    const ansi = getRowAnsi(app, 'gti status');
    assert.ok(ansi?.includes(`${RESET}${ERROR}gti${RESET}${PRIMARY} status`), 'gti should be error, status should be primary');
}));

test('PIPELINE - echo "$HOME" | grep foo', withApp(async (app) => {
    app['semanticService'].cache.set('echo', 'builtin');
    app['semanticService'].cache.set('grep', 'executable');
    submitCommand(app, 'echo "$HOME" | grep foo');
    
    const ansi = getRowAnsi(app, 'echo "$HOME" | grep foo');
    assert.ok(ansi?.includes(`${RESET}${ACCENT}echo${RESET}${PRIMARY} `), 'echo should be accent');
    assert.ok(ansi?.includes(`${RESET}${STOPPED}"$HOME"${RESET}${PRIMARY} `), 'string should be stopped/amber');
    assert.ok(ansi?.includes(`${RESET}${SUBTLE}|${RESET}${PRIMARY} `), '| should be subtle');
    assert.ok(ansi?.includes(`${RESET}${ACCENT}grep${RESET}${PRIMARY} foo`), 'grep should be accent');
}));

test('MULTILINE - styles survive across multiline', withApp(async (app) => {
    app['semanticService'].cache.set('git', 'executable');
    submitCommand(app, 'git \\\nstatus');
    
    const wrapped = app['output'].wrapped(100);
    const line1 = wrapped.find(r => r.plain.includes('❯ git \\'))?.ansi;
    const line2 = wrapped.find(r => r.plain.includes('  status'))?.ansi;
    
    assert.ok(line1?.includes(`${RESET}${ACCENT}git${RESET}${PRIMARY}`), 'line 1 git should be accent');
    assert.ok(line2?.includes(`${PRIMARY}  status`), 'line 2 status should be primary');
}));

test('ASYNC UPDATE - resolves and updates output buffer', withApp(async (app) => {
    Object.defineProperty(app.editor, 'text', { value: '', writable: true });
    app.editor.text = 'git status';
    
    app['submit']('git status');
    
    app['semanticService'].cache.set('git', 'executable');
    const startId = app['running']!.startId;
    const newFormatted = app['formatCommandAnsi']('git status', null);
    app['output'].updateCommandHighlight(startId, newFormatted);
    
    const ansi = getRowAnsi(app, 'git status');
    assert.ok(ansi?.includes(`${RESET}${ACCENT}git${RESET}${PRIMARY} status`), 'updated to accent');
}));

test('RAW OUTPUT - PTY output remains untouched', withApp(async (app) => {
    submitCommand(app, 'git status');
    
    app['output'].write('\x1b[31mgit status error\x1b[0m\n');
    
    const ansi = getRowAnsi(app, 'git status error');
    assert.ok(ansi?.includes('\x1b[0m\x1b[31mgit status error\x1b[0m'), 'raw ansi should be preserved exactly');
}));

test('COPY - /copy remains plain text', withApp(async (app) => {
    app['semanticService'].cache.set('git', 'executable');
    submitCommand(app, 'git status');
    const record = app['output'].complete(0);
    
    assert.equal(record?.command, 'git status');
    assert.equal(record?.output, '');
    assert.ok(!record?.output.includes('\x1b'), 'no ansi in completed record');
}));
