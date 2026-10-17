#!/usr/bin/env bash
# Prepares the detached checkout the archived prototypes run against: the
# provenance commit, under the T7's disposable worktree root. Re-running it is a
# no-op once the checkout exists.
#   t7run bash tools/prepare-pinned-checkout.sh [repository]
#   NMSH_NODE_MODULES=/path/to/node_modules t7run bash tools/prepare-pinned-checkout.sh   (link instead of npm ci)
set -euo pipefail
commit=13a47f8798df3d74c8b887426f6cdd794e20af5a
target=/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/onboarding-design-archive-13a47f8
repo="${1:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"

[[ -n "${T7_RUN_DIR:-}" ]] || { echo "Run this through t7run so npm and git scratch stay on the T7." >&2; exit 1; }
if [[ -e "$target" ]]; then echo "Already prepared: $target"; exit 0; fi
git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null || {
  echo "$commit is not in $repo. Fetch it, or clone the archived bundle (see the archive README)." >&2; exit 1; }
git -C "$repo" worktree add --detach "$target" "$commit"
if [[ -n "${NMSH_NODE_MODULES:-}" ]]; then ln -s "$NMSH_NODE_MODULES" "$target/node_modules"
else (cd "$target" && npm ci --ignore-scripts --no-audit --no-fund); fi
echo "Prepared: $target"
