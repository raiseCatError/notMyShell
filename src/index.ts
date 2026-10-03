import {resolveZsh} from './shell/zshExecutable.js';
import {SessionPresetStore, validatePresetCwd, presetNeedsAcknowledgement, type SessionPreset} from './session/SessionPresets.js';
import {isVersionInvocation, formatBuildIdentity, readBuildIdentity} from './buildInfo.js';
import {NESTED_NMSH_MESSAGE, createOrdinaryZshEnvironment, isManagedNmshEnvironment} from './shell/ShellHandoff.js';
import {spawn} from 'node:child_process';
import {PRODUCT_ABBREVIATION, PRODUCT_NAME} from './config.js';

function startOrdinaryZsh(cwd?: string): Promise<number> {
  return new Promise(resolve => {
    try {
      const shell = spawn(resolveZsh(), ['-i'], {
        ...(cwd ? {cwd} : {}),
        env: createOrdinaryZshEnvironment(),
        stdio: 'inherit',
      });
      shell.once('error', error => {
        process.stderr.write(`NMSh could not start ordinary zsh: ${error.message}\n`);
        resolve(1);
      });
      shell.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`NMSh could not start ordinary zsh: ${message}\n`);
      resolve(1);
    }
  });
}

async function runMaintenanceCommand(argv: string[]): Promise<number> {
  const out = (text: string) => process.stdout.write(text);
  const err = (text: string) => process.stderr.write(text);
  const version = readBuildIdentity().version;
  if (argv[0] === 'doctor') {
    const {doctorReport} = await import('./cli/doctor.js');
    out(doctorReport());
    return 0;
  }
  const {ttyConfirm} = await import('./cli/configCommand.js');
  const confirm = process.stdin.isTTY && process.stderr.isTTY ? ttyConfirm : undefined;
  if (argv[0] === 'config') {
    const {runConfigCommand} = await import('./cli/configCommand.js');
    return runConfigCommand(argv.slice(1), {out, err, confirm, version});
  }
  const {runUninstallCommand} = await import('./cli/uninstallCommand.js');
  return runUninstallCommand(argv.slice(1), {out, err, confirm});
}

const args = process.argv.slice(2);
const attachIndex = args.indexOf('--attach');
const presetIndex = args.indexOf('--preset');

if (args[0] === 'config' || args[0] === 'uninstall' || args[0] === 'doctor') {
  // Non-interactive maintenance commands: allowed from inside an NMSh-managed shell too.
  process.exitCode = await runMaintenanceCommand(args);
} else if (isVersionInvocation(args)) {
  process.stdout.write(`${formatBuildIdentity(readBuildIdentity())}\n`);
} else if (args.includes('--presets')) {
  try { process.stdout.write(new SessionPresetStore().list().map(preset => `${preset.name}  ${preset.cwd}  ${preset.commands.length} startup command(s)`).join('\n') + '\n'); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Could not list presets.'}\n`); process.exitCode = 1; }
} else if (presetIndex !== -1 && (!args[presetIndex+1] || args[presetIndex+1]!.startsWith('--') || attachIndex !== -1)) {
  process.stderr.write('Usage: nmsh --preset <name> (creates a new session; cannot combine with --attach)\n');
  process.exitCode = 2;
} else if (args.includes('--sessions')) {
  const {listLiveSessions} = await import('./session/connectSession.js');
  const {formatSessionList} = await import('./session/sessionList.js');
  try {
    process.stdout.write(formatSessionList(await listLiveSessions(), Date.now()));
  } catch (error) {
    process.stderr.write(`NMSh could not list live sessions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else if (attachIndex !== -1 && !args[attachIndex + 1]) {
  process.stderr.write('Usage: nmsh --attach <session-id>   (see nmsh --sessions)\n');
  process.exitCode = 2;
} else if (isManagedNmshEnvironment()) {
  process.stderr.write(`${NESTED_NMSH_MESSAGE}\n`);
  process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write(`${PRODUCT_NAME} (${PRODUCT_ABBREVIATION}) requires an interactive terminal.\n`);
  process.exitCode = 1;
} else {
  const {TerminalApp} = await import('./app/TerminalApp.js');
  const {attachSession, connectSession, listLiveSessions, SESSION_SERVICE_ENV} = await import('./session/connectSession.js');
  // New sessions start the default backend from Settings; a missing one falls back to zsh, said plainly.
  const {loadPromptConfiguration: loadBackendConfiguration} = await import('./prompt/configuration.js');
  const {shellAdapter} = await import('./shell/adapters/registry.js');
  let backend = loadBackendConfiguration().shellBackend;
  let backendNotice: string | undefined;
  const missing = shellAdapter(backend).unavailableReason(process.env);
  if (backend !== 'zsh' && missing) {
    backendNotice = `${missing} Started zsh instead; your default stays ${shellAdapter(backend).label}.`;
    backend = 'zsh';
  }
  const size = () => ({cwd: process.cwd(), columns: process.stdout.columns || 80, rows: Math.max(2, (process.stdout.rows || 24) - 4), shell: backend});
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

  let pendingPreset: SessionPreset | undefined;
  if (presetIndex !== -1) {
    try {
      const store = new SessionPresetStore();
      const preset = store.get(args[presetIndex+1]!);
      validatePresetCwd(preset);
      if (process.env[SESSION_SERVICE_ENV] === '0') throw new Error('Presets require the live-session service.');
      if (presetNeedsAcknowledgement(preset)) {
        const {createPresetPanel, presetPanelKey, renderPresetPanel} = await import('./session/PresetPanel.js');
        const {runStartupScreen} = await import('./session/StartupPicker.js');
        const state = createPresetPanel([preset]);
        state.detail = preset; state.operation = 'launch'; state.confirm = {choice:'no'};
        const agreed = await runStartupScreen(columns => renderPresetPanel(state,columns,process.stdout.rows || 24), key => {
          if (key.kind === 'escape' || key.kind === 'interrupt') return false;
          const action = presetPanelKey(state,key,process.cwd());
          if (action === 'launch') return true;
          if (!state.confirm) return false;
        });
        if (!agreed) process.exit(0);
        pendingPreset = store.acknowledge(preset);
      } else pendingPreset = preset;
    } catch (error) {
      process.stderr.write(`${errorText(error)}\n`);
      process.exit(1);
    }
  }

  // Which session this launch attaches, if any. --attach is explicit and
  // fails loudly; discovery only ever picks a detached session, and --new
  // skips it.
  let target: string | undefined = attachIndex === -1 ? undefined : args[attachIndex + 1];
  let explicit = target !== undefined;
  let notice: string | undefined;
  if (process.env[SESSION_SERVICE_ENV] !== '0') {
    // Sessions that ended with no window attached become ordinary archives.
    const {recoverEndedSessions} = await import('./session/recovery.js');
    const {defaultRuntimeDir} = await import('./session/runtimeDir.js');
    const {TranscriptStore} = await import('./sessions/TranscriptStore.js');
    try {
      const recovered = await recoverEndedSessions(defaultRuntimeDir(), new TranscriptStore());
      if (recovered.archived.length > 0) {
        notice = `${recovered.archived.length} live session${recovered.archived.length === 1 ? '' : 's'} ended while no NMSh window was attached; see /resume.`;
      } else if (recovered.skipped === 'another NMSh session service version is running') {
        notice = 'A session service from another NMSh version is still running its own live sessions; they continue until they end but cannot be attached from this version.';
      }
    } catch { /* recovery is best effort and never blocks launch */ }
  }
  if (!pendingPreset && !explicit && !args.includes('--new') && process.env[SESSION_SERVICE_ENV] !== '0') {
    let live: Awaited<ReturnType<typeof listLiveSessions>> = [];
    try { live = await listLiveSessions(); } catch { /* no usable service: start fresh */ }
    const {restoreAtStartup} = await import('./session/startupRestore.js');
    const picker = await import('./session/StartupPicker.js');
    const {detectTerminalHost} = await import('./host/terminalHost.js');
    const {loadPromptConfiguration, savePromptConfiguration} = await import('./prompt/configuration.js');
    const config = loadPromptConfiguration();
    const restored = await restoreAtStartup(live, {
      policy: {startup: config.liveSessionStartup, multiple: config.liveSessionMultiple},
      saveStartup: startup => {
        try { const base = loadPromptConfiguration(); savePromptConfiguration({...base, liveSessionStartup: startup}, undefined, base); } catch { /* keep going; applies this launch */ }
      },
      askOne: session => picker.runStartupScreen(columns => picker.renderSinglePrompt(session, columns, Date.now()), picker.singlePromptKey),
      pick: sessions => {
        const state = picker.createMultiPicker(sessions);
        return picker.runStartupScreen(columns => picker.renderMultiPicker(state, columns, Date.now()), key => picker.multiPickerKey(state, key));
      },
      host: detectTerminalHost(),
      selfCommand: [process.execPath, ...process.execArgv.filter(arg => !arg.startsWith('--inspect')), process.argv[1]!],
    });
    target = restored.target;
    notice = [notice, restored.notice].filter(Boolean).join(' ') || undefined;
  }

  // The loop lets /resume switch this window to another live session.
  for (;;) {
    let connection;
    if (target) {
      try {
        connection = await attachSession(target, size());
      } catch (error) {
        if (explicit) {
          process.stderr.write(`NMSh could not attach: ${errorText(error)}\n`);
          process.exit(1);
        }
        notice = `Could not reattach (${errorText(error)}); started a new session.`;
      }
    }
    connection ??= await connectSession(size());
    if (backendNotice && !connection.attached) { notice = [notice, backendNotice].filter(Boolean).join(' ') || undefined; backendNotice = undefined; }
    if (connection.shell && connection.shell !== backend && !connection.attached) {
      notice = [notice, `The running session service started ${connection.shell} (it predates shell backends); end its sessions to use ${backend}.`].filter(Boolean).join(' ');
    }
    if (notice) connection = {...connection, notice: [connection.notice, notice].filter(Boolean).join(' ')};
    if (pendingPreset && connection.mode !== 'service') {
      connection.client.kill();
      process.stderr.write('Preset launch requires an available live-session service. Existing sessions were left intact; see nmsh --sessions.\n');
      process.exit(1);
    }
    let app: InstanceType<typeof TerminalApp>;
    try { app = new TerminalApp(connection, pendingPreset); }
    catch (error) {
      connection.client.kill();
      process.stderr.write(`Could not launch session: ${errorText(error)}\n`);
      process.exit(1);
    }
    pendingPreset = undefined;
    const exitCode = await app.run();
    if (app.lostServiceConnection) {
      process.stderr.write('NMSh lost the connection to its session service; the live session ended and its transcript was archived.\n');
    }
    notice = undefined;
    if (app.switchPreset) {
      pendingPreset = app.switchPreset;
      target = undefined; explicit = false;
      continue;
    }
    if (app.switchTarget) {
      target = app.switchTarget;
      explicit = false;
      continue;
    }
    process.exitCode = app.isOrdinaryZshHandoffRequested
      ? await startOrdinaryZsh(app.ordinaryZshHandoffCwd)
      : exitCode;
    break;
  }
}
