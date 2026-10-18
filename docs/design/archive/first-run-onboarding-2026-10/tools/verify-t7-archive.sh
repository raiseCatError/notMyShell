#!/usr/bin/env bash
# Re-hashes the durable design archive against MANIFEST.sha256. Read-only.
#   bash tools/verify-t7-archive.sh [archive directory]
set -euo pipefail
manifest="$(cd "$(dirname "$0")/.." && pwd)/MANIFEST.sha256"
archive="${1:-/Volumes/T7 Shield/NMSh Design Archive/first-run-onboarding-2026-10-17}"
[[ -d "$archive" ]] || { echo "No archive at $archive (is the T7 Shield mounted?)" >&2; exit 1; }
cd "$archive"
shasum -a 256 -c --quiet "$manifest"
echo "All $(wc -l < "$manifest" | tr -d ' ') files match $manifest."
