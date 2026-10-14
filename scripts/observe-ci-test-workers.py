import json, os, subprocess, sys, time
from pathlib import Path

# Isolated CI diagnostic: the original runner owns all test outcomes and limits.
root = Path(os.environ['RUNNER_TEMP']) / 'nmsh-worker-diagnostics'
root.mkdir(mode=0o700)
env = os.environ.copy()
env['NMSH_WORKER_OBSERVATIONS'] = str(root)
observer = Path(__file__).with_name('observe-test-worker-lifecycle.mjs').resolve()
env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + ' --import=' + str(observer)).strip()
command = sys.argv[1:]
if command[:1] == ['--']:
    command = command[1:]
child = subprocess.Popen(command, env=env)

def snapshot():
    workers = []
    for file in root.glob('worker-*.jsonl'):
        try:
            lines = file.read_text().splitlines()
            events = [json.loads(line) for line in lines]
            entry = events[0]
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

while child.poll() is None:
    snapshot()
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        pass
snapshot()
code = child.returncode
(root / 'result.json').write_text(json.dumps({'exit_code': code, 'kind': 'diagnostic, not acceptance'}, indent=2) + '\n')
sys.exit(code if code >= 0 else 1)
