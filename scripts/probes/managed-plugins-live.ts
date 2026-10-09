/**
 * Live validation of NMSh's Claude plugin toggle inside an NMSh-managed Claude session, in a DISPOSABLE configuration:
 * install a probe plugin from a local marketplace, start a managed session that loads it, then disable and re-enable
 * it through NMSh's own code (Claude's listing → setPluginEnabled → reload_plugins) and read Claude's own reports to
 * see it unload and load. Refuses real account directories; hashes the real accounts' settings before and after.
 *
 *   CLAUDE_CONFIG_DIR=/tmp/nmsh-cc-probe claude auth login   # once, by the person
 *   NMSH_PROBE_CONFIG_DIR=/tmp/nmsh-cc-probe NMSH_PROBE_MARKET=/tmp/nmsh-cc-market node --import=tsx scripts/probes/managed-plugins-live.ts
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentSessions} from '../../src/agents/sessions/manager.js';
import {claudePluginEntries, listClaudePlugins, setPluginEnabled} from '../../src/agents/mods/claudePlugins.js';
import {withLoadedIn} from '../../src/agents/mods/inventory.js';

const real = process.env.NMSH_PROBE_CLAUDE ?? join(homedir(), '.local/bin/claude');
const configDir = process.env.NMSH_PROBE_CONFIG_DIR ? realpathSync(process.env.NMSH_PROBE_CONFIG_DIR) : '';
const market = process.env.NMSH_PROBE_MARKET ?? '';
if (!configDir || !market) throw new Error('Set NMSH_PROBE_CONFIG_DIR (disposable, logged in) and NMSH_PROBE_MARKET');
// Never a real account: the disposable directory must live in a temp folder.
if (!/^\/(?:private\/)?tmp\//u.test(configDir) || /\.claude(?:-account\d+)?$/u.test(configDir)) throw new Error(`Refusing ${configDir}: not a disposable temp configuration`);
const realSettings = ['.claude', '.claude-account1', '.claude-account2'].map(dir => join(homedir(), dir, 'settings.json')).filter(existsSync);
const hashes = () => realSettings.map(path => createHash('sha256').update(readFileSync(path)).digest('hex')).join(',');
const before = hashes();
const env = {...process.env, CLAUDE_CONFIG_DIR: configDir};
const claude = (args: string[]) => spawnSync(real, args, {env, encoding: 'utf8', timeout: 60000});
const auth = JSON.parse(claude(['auth', 'status']).stdout || '{}') as {loggedIn?: boolean};
if (!auth.loggedIn) throw new Error('The disposable configuration is not logged in');

const note = (step: string, value: unknown) => console.log(JSON.stringify({step, ...value as object}));
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = {}) => { if (!ok) failures++; note(name, {ok, detail}); };
const until = async (what: string, test: () => boolean, ms = 120000) => {
  const end = Date.now() + ms;
  while (!test()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise(resolve => setTimeout(resolve, 100)); }
};

const work = mkdtempSync(join(tmpdir(), 'nmsh-plugins-work-'));
const wrapper = join(work, 'claude');
writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(real)} "$@" --no-session-persistence --max-budget-usd 0.5\n`);
chmodSync(wrapper, 0o755);
const sessions = new AgentSessions({resolve: name => name === 'claude' ? wrapper : undefined, scan: async () => [], now: () => Date.now(), claudeHelp: claude(['--help']).stdout});
try {
  // Setup in the disposable configuration only (Claude's own commands).
  note('marketplace add', {status: claude(['plugin', 'marketplace', 'add', market]).status});
  note('install', {status: claude(['plugin', 'install', 'nmsh-probe@nmsh-probe-market', '--scope', 'user']).status});
  const entry = async () => (await claudePluginEntries(await listClaudePlugins(real, work, configDir), work, {name: 'probe', configDir})).find(item => item.id === 'nmsh-probe@nmsh-probe-market');
  const installed = await entry();
  check('the probe plugin is listed, enabled, with a switch', installed?.enabled === 'yes' && installed.toggle?.supported === true, installed && {type: installed.nativeType, components: installed.components});

  const launched = sessions.launch('claude', work, {profile: {name: 'probe', harness: 'claude', configDir, model: 'haiku'}});
  if (!launched.ok) throw new Error(launched.reason);
  const session = launched.session;
  const turn = async (text: string) => {
    const settled = session.events.filter(event => event.kind === 'settled').length;
    sessions.send(session.id, text);
    await until('turn', () => session.events.filter(event => event.kind === 'settled').length > settled);
  };
  await turn('Reply with exactly one word: ready');
  const loaded = () => (session.telemetry?.runtime?.plugins ?? []).map(plugin => plugin.name);
  check('Claude reports the plugin loaded in the managed session', loaded().includes('nmsh-probe'), {plugins: loaded()});
  check('"Loaded in" names the session', withLoadedIn([installed!], sessions.sessions)[0]!.loadedIn?.length === 1);
  const commandBefore = (session.telemetry?.runtime?.slashCommands ?? []).filter(name => name.includes('nmsh-probe'));
  check('its command is offered', commandBefore.length > 0, {commands: commandBefore});

  // Disable through NMSh's toggle path.
  const ids = new Set(['nmsh-probe@nmsh-probe-market']);
  const off = await setPluginEnabled(real, installed!, false, ids);
  check('claude plugin disable succeeded', off.ok, off);
  check('the listing confirms it disabled', (await entry())?.enabled === 'no');
  const reloadOff = await sessions.reloadPlugins(session.id);
  check('reload_plugins: Claude no longer loads it', reloadOff.ok && !reloadOff.value.plugins.includes('nmsh-probe'), reloadOff);
  await turn('Reply with exactly one word: after');
  check('the next turn no longer offers its command', !(session.telemetry?.runtime?.slashCommands ?? []).some(name => name.includes('nmsh-probe')), {commands: session.telemetry?.runtime?.slashCommands?.filter(name => name.includes('probe'))});

  // Enable again.
  const on = await setPluginEnabled(real, (await entry())!, true, ids);
  check('claude plugin enable succeeded', on.ok, on);
  const reloadOn = await sessions.reloadPlugins(session.id);
  check('reload_plugins: Claude loads it again, with no load errors', reloadOn.ok && reloadOn.value.plugins.includes('nmsh-probe') && reloadOn.value.errors === 0, reloadOn);

  // An id that is not installed is never sent (Claude's own command would write it into settings).
  const ghost = await setPluginEnabled(real, {...installed!, claude: {...installed!.claude!, pluginId: 'ghost@nowhere'}}, true, ids);
  check('an uninstalled id is refused before any command runs', !ghost.ok, ghost);
  const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8')) as {enabledPlugins?: Record<string, boolean>};
  check('the disposable settings never gained the ghost id', !('ghost@nowhere' in (settings.enabledPlugins ?? {})), settings.enabledPlugins);
} finally {
  sessions.dispose();
  await new Promise(resolve => setTimeout(resolve, 1500));
  check('real account settings unchanged', hashes() === before, {checked: realSettings.length});
  rmSync(work, {recursive: true, force: true});
  console.log(JSON.stringify({failures}));
  process.exit(failures ? 1 : 0);
}
