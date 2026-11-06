#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ -x "$PWD/.tools/node-v24.22.2-darwin-arm64/bin/node" ]]; then
  export PATH="$PWD/.tools/node-v24.22.2-darwin-arm64/bin:$PWD/.tools/pnpm/bin:$PATH"
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo 'Install Node.js 22+ and pnpm 10.28.2, then run pnpm install and pnpm dev in this folder.'
  read '?Press Enter to close.'
  exit 1
fi
pnpm dev
