#!/usr/bin/env bash
# Prints the bin directory of the Node version package.json's engines.node asks for, or fails.
# Use: dir="$(fork/node-bin-dir.sh)" && export PATH="$dir:$PATH"
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
want="$(sed -n 's/^[[:space:]]*"node":[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$root/package.json" | head -n 1)"
if [[ -z "$want" ]]; then
  echo "package.json has no exact engines.node version." >&2
  exit 1
fi
if [[ "$(node --version 2>/dev/null || true)" == "v$want" ]]; then
  dirname "$(command -v node)"
  exit 0
fi
if ! command -v mise > /dev/null; then
  echo "Node $want is not on PATH and mise is not installed. Install Node $want." >&2
  exit 1
fi
bin="$(mise which node --tool "node@$want" 2> /dev/null || true)"
if [[ -z "$bin" || ! -x "$bin" ]]; then
  echo "mise has no Node $want. Install it with: mise install node@$want" >&2
  exit 1
fi
dirname "$bin"
