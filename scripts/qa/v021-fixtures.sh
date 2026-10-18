#!/usr/bin/env bash
# Fixtures for the v0.21 physical QA walkthrough (docs/testing/v021-physical-qa.md).
#
#   scripts/qa/v021-fixtures.sh <new-directory>
#
# Creates, inside <new-directory> (which must not exist yet), a launcher for this checkout's build with an NMSh
# configuration and session service of its own, so the QA build never reads your settings or attaches to your running
# sessions, and the small files the checklist uses. Nothing outside that directory is changed, nothing is downloaded
# or installed, and nothing runs as root. Delete the directory once the results are recorded.
set -euo pipefail

target=${1:-}
if [ -z "$target" ]; then echo 'usage: scripts/qa/v021-fixtures.sh <new-directory>' >&2; exit 2; fi
case $target in /*) ;; *) target="$PWD/$target" ;; esac
if [ -e "$target" ]; then echo "refusing: $target already exists" >&2; exit 2; fi
repo=$(cd "$(dirname "$0")/../.." && pwd -P)
if [ ! -f "$repo/dist/index.js" ]; then echo "build first: (cd $repo && npm ci && npm run build)" >&2; exit 2; fi
# The session service's socket lives under the directory; Unix socket paths are limited to about 100 bytes.
if [ ${#target} -gt 60 ]; then echo "refusing: $target is longer than 60 characters (session sockets need a short path)" >&2; exit 2; fi

mkdir -p "$target"
root=$(cd "$target" && pwd -P)
work="$root/work"

for shell in zsh bash fish; do
  mkdir -p "$root/config-$shell/nmsh" "$root/run-$shell"
  chmod 700 "$root/run-$shell"
  printf '{"onboardingComplete":true,"toolsSetupComplete":true,"shellBackend":"%s"}\n' "$shell" > "$root/config-$shell/nmsh/config.json"
done

cat > "$root/nmsh" <<EOF
#!/usr/bin/env bash
# The QA build ($repo) with this folder's configuration and session service: ./nmsh [zsh|bash|fish|copy]
# "copy" uses config-copy/nmsh, a copy of an existing configuration you make yourself (see the walkthrough).
profile=\${1:-zsh}
case \$profile in zsh|bash|fish|copy) ;; *) echo 'usage: ./nmsh [zsh|bash|fish|copy]' >&2; exit 2 ;; esac
if [ ! -d "$root/config-\$profile/nmsh" ]; then echo "missing $root/config-\$profile/nmsh" >&2; exit 2; fi
mkdir -p "$root/run-\$profile" && chmod 700 "$root/run-\$profile"
cd "$work" || exit 1
exec env XDG_CONFIG_HOME="$root/config-\$profile" NMSH_RUNTIME_DIR="$root/run-\$profile" NMSH_DISABLE_UPDATES=1 node "$repo/dist/index.js"
EOF
chmod +x "$root/nmsh"

# 1. Progress redraws (#388) -------------------------------------------------------------------------------------
mkdir -p "$work/progress"
cat > "$work/progress/multirow.mjs" <<'EOF'
// Two rows redrawn in place (cursor up, erase line), with log lines printed between frames, as concurrent
// downloads and container pulls draw them. node multirow.mjs [steps] (default 24, a quarter second each).
const steps = Number(process.argv[2] ?? 24);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const bar = (done, width = 20) => `[${'='.repeat(Math.round(done * width)).padEnd(width)}]`;
const layers = ['layer 1/2 sha256:9f86d081884c', 'layer 2/2 sha256:60303ae22b99'];
process.stdout.write('LOG pulling two layers\n');
let drawn = 0;
for (let step = 0; step <= steps; step += 1) {
  let out = drawn ? `\x1b[${drawn}A` : '';
  if (step > 0 && step % 6 === 0) out += `\x1b[2KLOG checkpoint ${step / 6}\n`;
  layers.forEach((name, index) => {
    const done = Math.min(1, (step / steps) * (index ? 0.8 : 1.2));
    out += `\x1b[2K${name} ${bar(done)} ${Math.round(done * 100)}%\n`;
  });
  process.stdout.write(out);
  drawn = layers.length;
  await sleep(250);
}
process.stdout.write('LOG done\n');
EOF
cat > "$work/progress/wrapped.mjs" <<'EOF'
// A progress display that counts the terminal rows it drew (its line is wider than a 40-column window), moves up by
// them, erases below and redraws, as indicatif, pip and cargo do. The LOG lines must all stay.
const sleep = ms => new Promise(done => setTimeout(done, ms));
const rows = text => Math.max(1, Math.ceil(text.length / (process.stdout.columns || 80)));
process.stdout.write('LOG kept line one\nLOG kept line two\n');
let drawn = 0;
for (let n = 0; n <= 10; n += 1) {
  if (drawn) process.stdout.write(`\r\x1b[${drawn}A\x1b[J`);
  const frame = [`Downloading big-archive-name.tar.gz [${'='.repeat(n)}${' '.repeat(10 - n)}] ${n * 10}%`, `eta ${10 - n}s`];
  process.stdout.write(`${frame.join('\n')}\n`);
  drawn = frame.reduce((sum, line) => sum + rows(line), 0);
  await sleep(300);
}
process.stdout.write('LOG done\n');
EOF

# 2. /view --------------------------------------------------------------------------------------------------------
mkdir -p "$work/view/folder"
cp "$repo/README.md" "$work/view/README.md"
cp "$repo/src/viewer/ViewerPanel.ts" "$work/view/ViewerPanel.ts"
printf '\033]8;;https://example.com\a\033[31mred\033[2J\n' > "$work/view/hostile.txt"
printf 'name\tsize\tnote\nalpha\t1\tfirst\nbeta\t22\tsecond\n' > "$work/view/tabs.txt"
mkfifo "$work/view/fifo"
yes 'a log line for the 8 MiB viewer limit check' | head -c 20971520 > "$work/view/big.log" || true

# 3. /edit --------------------------------------------------------------------------------------------------------
mkdir -p "$work/edit/empty" "$work/edit/real"
ln -s real "$work/edit/alias"
printf '\357\273\277line one\r\nline two\r\n' > "$work/edit/crlf-bom.txt"
printf 'keep my mode\n' > "$work/edit/mode640.txt" && chmod 640 "$work/edit/mode640.txt"
printf 'the target\n' > "$work/edit/target.txt" && ln -s target.txt "$work/edit/link.txt"
printf 'read only\n' > "$work/edit/readonly.txt" && chmod 444 "$work/edit/readonly.txt"
yes 'a line for the 1 MiB editor limit check' | head -c 2097152 > "$work/edit/big.txt" || true

# 4. Semantic Output ----------------------------------------------------------------------------------------------
mkdir -p "$work/semantic/pass/test" "$work/semantic/fail/test" "$work/semantic/ts/node_modules/.bin" "$work/semantic/c"
for kind in pass fail; do
  printf '{"name":"qa-%s","private":true,"scripts":{"test":"node --test"}}\n' "$kind" > "$work/semantic/$kind/package.json"
  {
    echo "import test from 'node:test';"
    echo "import assert from 'node:assert/strict';"
    for n in $(seq 1 40); do echo "test('adds case $n', () => assert.equal($n + $n, $((n * 2))));"; done
    if [ "$kind" = fail ]; then
      echo "test('rounds a price', () => assert.equal(Math.round(2.5), 2));"
      echo "test('parses a date', () => assert.equal(new Date('2026-10-18').getUTCDate(), 19));"
    fi
  } > "$work/semantic/$kind/test/math.test.mjs"
done
printf '{"name":"qa-ts","private":true}\n' > "$work/semantic/ts/package.json"
printf 'const count: number = "three";\nexport const total = count + missingValue;\n' > "$work/semantic/ts/bad.ts"
ln -s "$repo/node_modules/typescript/bin/tsc" "$work/semantic/ts/node_modules/.bin/tsc"
printf 'int main(void) {\n  return undefined_name;\n}\n' > "$work/semantic/c/bad.c"
printf 'bad.o: bad.c\n\tcc -c bad.c -o bad.o\n' > "$work/semantic/c/Makefile"

# A small repository for `git status` (no remote, no hooks, a local identity for its one commit).
mkdir -p "$work/git"
printf 'tracked\n' > "$work/git/tracked.txt"
git -C "$work/git" init -q
git -C "$work/git" add tracked.txt
git -C "$work/git" -c user.name=QA -c user.email=qa@example.invalid -c commit.gpgsign=false commit -q -m 'QA fixture'
printf 'untracked\n' > "$work/git/untracked.txt"

# 5. /track -------------------------------------------------------------------------------------------------------
mkdir -p "$work/track"
printf 'one\ntwo\nthree\n' > "$work/track/f.txt"

# 6. Modules ------------------------------------------------------------------------------------------------------
mkdir -p "$work/modules/bun-app"
printf '{"name":"bun-app","private":true,"packageManager":"bun@1.1.30"}\n' > "$work/modules/bun-app/package.json"
printf '{"lockfileVersion": 1}\n' > "$work/modules/bun-app/bun.lock"

printf 'QA fixtures ready in %s\nStart the QA build with: %s/nmsh   (or: %s/nmsh fish, %s/nmsh bash)\n' "$root" "$root" "$root" "$root"
