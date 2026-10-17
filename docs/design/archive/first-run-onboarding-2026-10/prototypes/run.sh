#!/usr/bin/env bash
# Archived NMSh first-run onboarding prototypes (2026-10-17). They run against a
# notMyShell checkout pinned at the provenance commit, so later product changes
# cannot alter them. Interactive in a real terminal; --frame prints one frame.
#   t7run bash run.sh --concept horizon --reactive
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
NMSH_SRC="${NMSH_SRC:-/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/onboarding-design-archive-13a47f8}"
if [[ ! -f "$NMSH_SRC/src/setup/SetupCat.ts" || ! -e "$NMSH_SRC/node_modules/tsx" ]]; then
  echo "No prepared checkout at $NMSH_SRC. Run tools/prepare-pinned-checkout.sh, or set NMSH_SRC." >&2
  exit 2
fi
export NMSH_SRC
cd "$NMSH_SRC"
exec node --import=tsx "$here/proto/main.ts" "$@"
