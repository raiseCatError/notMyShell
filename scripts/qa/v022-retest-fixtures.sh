#!/usr/bin/env bash
# Additions to an existing v0.22 QA folder for the targeted retests after the post-QA stabilization fixes
# (docs/testing/v022-physical-qa.md, "Retests after the stabilization fixes").
#
#   scripts/qa/v022-retest-fixtures.sh <q22-folder> <qa-build-worktree>
#
# Adds work/retest/ and a launcher, nmsh2, for the new build: the same configuration folders as ./nmsh (your QA
# settings and local model carry over), but its own session service, so the new build's shells are its own. Nothing
# already in the folder is changed or removed, nothing is downloaded or installed, and nothing runs as root.
set -euo pipefail

root=${1:-}
build=${2:-}
if [ -z "$root" ] || [ -z "$build" ]; then echo 'usage: scripts/qa/v022-retest-fixtures.sh <q22-folder> <qa-build-worktree>' >&2; exit 2; fi
root=$(cd "$root" && pwd -P)
build=$(cd "$build" && pwd -P)
if [ ! -d "$root/work" ] || [ ! -x "$root/nmsh" ]; then echo "$root is not a v0.22 QA folder (run scripts/qa/v022-fixtures.sh first)" >&2; exit 2; fi
if [ ! -f "$build/dist/index.js" ]; then echo "$build has no build: run npm run build there first" >&2; exit 2; fi
retest="$root/work/retest"
mkdir -p "$retest"
add() { if [ -e "$1" ]; then echo "kept $1"; else cat > "$1"; fi; }

add "$root/nmsh2" <<EOF
#!/usr/bin/env bash
# The retest build ($build) with this folder's configuration and its own session service: ./nmsh2 [zsh|bash|fish]
profile=\${1:-zsh}
case \$profile in zsh|bash|fish) ;; *) echo 'usage: ./nmsh2 [zsh|bash|fish]' >&2; exit 2 ;; esac
mkdir -p "$root/run2-\$profile" && chmod 700 "$root/run2-\$profile"
cd "$root/work" || exit 1
exec env XDG_CONFIG_HOME="$root/config-\$profile" NMSH_RUNTIME_DIR="$root/run2-\$profile" NMSH_DISABLE_UPDATES=1 node "$build/dist/index.js"
EOF
chmod +x "$root/nmsh2"

# R1 (Ask): a folder with a few images to ask about.
mkdir -p "$retest/images"
for name in one two three; do [ -e "$retest/images/$name.png" ] || printf '\x89PNG\r\n\x1a\n' > "$retest/images/$name.png"; done

# R2 (paste): copy with `pbcopy < retest/paste-mixed.txt`, then paste with Cmd+V.
add "$retest/paste-mixed.txt" <<'EOF'
cd modules/bun-app
/modules
EOF
add "$retest/paste-track.txt" <<'EOF'
/track ls
/track df -h
/track cat track/f.txt
/track ls missing
EOF

# R3 (/view HTML).
add "$retest/README-html.md" <<'EOF'
<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">
  <img alt="QA logo" src="logo-light.png" width="200">
</picture>

# HTML inside Markdown

<p align="center">
  <a href="https://example.com/ci"><img src="badge.svg" alt="CI badge"></a>
  <b>Bold words</b> and <i>italic words</i>; press <kbd>Ctrl</kbd>+<kbd>C</kbd>.
</p>

</div>

Markdown after the HTML: a list.

- one
- two
EOF
add "$retest/page.html" <<'EOF'
<!DOCTYPE html>
<html><head><title>QA page</title><style>body { color: red }</style></head>
<body>
<h1>A page</h1>
<p>A paragraph with <strong>strong</strong>, <em>em</em>, <code>a &lt; b</code> and a <a href="https://example.com/">link</a>.</p>
<ol><li>first<ul><li>nested</li></ul></li><li>second</li></ol>
<table><tr><th>Key</th><th align="right">Value</th></tr><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>22</td></tr></table>
<pre><code class="language-sh">echo "code block"
ls -la</code></pre>
<blockquote><p>A quote.</p></blockquote>
<hr>
<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> open</li></ul>
</body></html>
EOF
add "$retest/hostile.html" <<'EOF'
<h2>Hostile page</h2>
<p>Visible text.</p>
<script>document.title = 'QA-SCRIPT-RAN'</script>
<style>p { display: none }</style>
<img src="/etc/passwd" onerror="alert('QA-HANDLER')" alt="local file reference">
<iframe src="https://example.com/QA-IFRAME"></iframe>
<p><a href="javascript:alert('x')">js link</a> <a href="file:///etc/hosts">file link</a></p>
<p>Escape as a reference: &#27;[2J and &#x1b;]0;QA-TITLE&#7; end.</p>
EOF

# R4 (typing before a timed read nobody sees): sleeps 2 s, then a read that gives up after 1 s, then succeeds.
add "$retest/timed-read.sh" <<'EOF'
#!/usr/bin/env bash
sleep 2
read -t 1 -r reply || true
echo QA-TIMED-DONE
EOF
chmod +x "$retest/timed-read.sh"

echo "Retest fixtures ready in $retest"
echo "Start the retest build with: $root/nmsh2   (or: $root/nmsh2 fish, $root/nmsh2 bash)"
