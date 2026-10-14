import json, os, subprocess, sys, time
from pathlib import Path

# Isolated CI diagnostic: the original runner owns all test outcomes and limits.
env = os.environ.copy()
disabled = False
warned = False
root = None

def silence_broken_pipe(stream):
    # Avoid an interpreter-shutdown flush replacing the original child status.
    try:
        descriptor = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(descriptor, stream.fileno())
        finally:
            os.close(descriptor)
    except (OSError, ValueError):
        pass

def disable_observation(error):
    global disabled, warned
    disabled = True
    if isinstance(error, BrokenPipeError):
        silence_broken_pipe(sys.stdout)
    if not warned:
        warned = True
        try:
            print('Worker observation disabled: ' + type(error).__name__, file=sys.stderr, flush=True)
        except BrokenPipeError:
            silence_broken_pipe(sys.stderr)
        except OSError:
            pass

try:
    root = Path(os.environ['RUNNER_TEMP']) / 'nmsh-worker-diagnostics'
    root.mkdir(mode=0o700)
    observer = Path(__file__).with_name('observe-test-worker-lifecycle.mjs').resolve()
    env['NMSH_WORKER_OBSERVATIONS'] = str(root)
    env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + ' --import=' + str(observer)).strip()
except (OSError, KeyError) as error:
    disable_observation(error)

command = sys.argv[1:]
if command[:1] == ['--']:
    command = command[1:]
child = subprocess.Popen(command, env=env)

def snapshot():
    if disabled:
        return
    workers = []
    for file in root.glob('worker-*.jsonl'):
        try:
            events = [json.loads(line) for line in file.read_text().splitlines()]
            entry = events[0]
            if not isinstance(entry, dict) or entry.get('event') != 'worker-entry':
                continue
            if type(entry.get('pid')) is not int or not isinstance(entry.get('file'), str):
                continue
            proc = Path('/proc') / str(entry['pid'])
            if not proc.exists():
                continue
            row = {'pid': entry['pid'], 'file': entry['file'], 'last': events[-2:]}
            for name in ('stat', 'wchan'):
                try:
                    row[name] = (proc / name).read_text().strip()
                except OSError:
                    pass
            row['fd0-2'] = {}
            for fd in ('0', '1', '2'):
                try:
                    row['fd0-2'][fd] = os.readlink(proc / 'fd' / fd)
                except OSError:
                    pass
            workers.append(row)
        except (OSError, ValueError, IndexError):
            pass
    observation = {'at': time.time(), 'live_workers': workers}
    with (root / 'snapshots.jsonl').open('a') as stream:
        stream.write(json.dumps(observation) + '\n')
    print('WORKER_OBSERVATION ' + json.dumps(observation), flush=True)

def observe():
    try:
        snapshot()
    except OSError as error:
        disable_observation(error)

while child.poll() is None:
    observe()
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        pass
observe()
code = child.returncode
if not disabled:
    try:
        (root / 'result.json').write_text(json.dumps({'exit_code': code, 'kind': 'diagnostic, not acceptance'}, indent=2) + '\n')
    except OSError as error:
        disable_observation(error)
sys.exit(code if code >= 0 else 128 - code)
