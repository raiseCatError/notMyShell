#!/usr/bin/env bash
set -euo pipefail
processes="$(ps -axo pid,ppid,pgid,command)"
if grep -E '[z]sh.*nmsh-semantic|[n]msh-semantic|[c]onfigured-completion\.zsh|[c]apture\.zsh|[v]iewportSyntax' <<< "$processes" | grep -v grep; then
  echo "::error::NMSh helper or test processes leaked!"
  exit 1
fi
echo "No processes leaked."
