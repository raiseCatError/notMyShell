#!/usr/bin/env bash
# Fixtures for the v0.22 physical QA walkthrough (docs/testing/v022-physical-qa.md).
#
#   scripts/qa/v022-fixtures.sh <new-directory>
#
# Everything the v0.21 fixtures make (scripts/qa/v021-fixtures.sh: a launcher with its own NMSh configuration and
# session service, and the files for passes 1-7), plus the small scripts for the v0.22 passes: password and prompt-hook
# scenarios, and a launcher without VISUAL and EDITOR for the terminal editor choice. Nothing outside the directory is
# changed, nothing is downloaded or installed, and nothing runs as root. Delete the directory once results are recorded.
set -euo pipefail

target=${1:-}
if [ -z "$target" ]; then echo 'usage: scripts/qa/v022-fixtures.sh <new-directory>' >&2; exit 2; fi
here=$(cd "$(dirname "$0")" && pwd -P)
"$here/v021-fixtures.sh" "$target" >/dev/null
root=$(cd "$target" && pwd -P)
work="$root/work"

# The same build and configuration with VISUAL and EDITOR unset (pass 11: Settings → Terminal editor).
cat > "$root/nmsh-noeditor" <<EOF
#!/usr/bin/env bash
# ./nmsh-noeditor [zsh|bash|fish]: the QA launcher with VISUAL and EDITOR unset for NMSh itself.
exec env -u VISUAL -u EDITOR "$root/nmsh" "\$@"
EOF
chmod +x "$root/nmsh-noeditor"

# 9. Passwords and replies (#426) --------------------------------------------------------------------------------
mkdir -p "$work/input"
cat > "$work/input/prompted.sh" <<'EOF'
#!/bin/sh
# A prompted hidden read, then the reply's length (never the reply).
printf 'QA password: '
stty -echo; IFS= read -r secret; stty echo; printf '\n'
printf 'got %s characters\n' "${#secret}"
EOF
cat > "$work/input/two-passwords.sh" <<'EOF'
#!/usr/bin/env bash
# Two hidden reads with no prompt, three seconds of work between them.
read -rs first; sleep 3; read -rs second
printf 'lengths %s/%s\n' "${#first}" "${#second}"
EOF
cat > "$work/input/second-gives-up.sh" <<'EOF'
#!/usr/bin/env bash
# A hidden read with no prompt, then a second that gives up after 2 seconds.
read -rs first; read -rs -t 2 second || true
printf 'lengths %s/%s\n' "${#first}" "${#second}"
EOF
cat > "$work/input/plain-read.sh" <<'EOF'
#!/bin/sh
# A line read with no prompt.
read -r reply; printf 'reply was %s\n' "$reply"
EOF
chmod +x "$work/input/"*.sh

# 10. Prompt hooks (#436): source it in a session to make that session's prompt hook take 2 seconds.
cat > "$work/input/slow-hook.zsh" <<'EOF'
# zsh: `source input/slow-hook.zsh` in this session only; `precmd_functions=(${precmd_functions:#qa_slow_hook})` undoes it.
qa_slow_hook() { sleep 2 }
precmd_functions+=(qa_slow_hook)
EOF
cat > "$work/input/slow-hook.bash" <<'EOF'
# Bash 5.1+: `source input/slow-hook.bash` in this session only, after NMSh's own hook; `unset -f qa_slow_hook` and
# start a new session to undo it.
qa_slow_hook() { sleep 2; }
PROMPT_COMMAND+=(qa_slow_hook)
EOF

# 11. Editors (#366): a long file to open at a line from /view.
seq -f 'notes line %g' 1 400 > "$work/view/notes.txt"

echo "QA fixtures ready in $root"
echo "Start the QA build with: $root/nmsh   (or: $root/nmsh fish, $root/nmsh bash, $root/nmsh-noeditor)"
