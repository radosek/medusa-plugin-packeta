#!/usr/bin/env bash
# Build, pack and install this plugin into a local Medusa app for manual testing.
#   scripts/dev-install.sh /path/to/medusa-app
# Afterwards register it in the app's medusa-config.ts (see README) and run
# `npx medusa db:migrate`. Re-run after every change; the tarball path is unique
# so bun/npm never serve a stale cache.
set -euo pipefail
APP="${1:?usage: dev-install.sh <medusa-app-dir>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
NODE_ENV=production bunx medusa plugin:build
OUT="$(mktemp -d)"
bun pm pack --ignore-scripts --destination "$OUT" >/dev/null
TGZ="$(ls "$OUT"/*.tgz)"
cd "$APP"
# Detect the package manager from the nearest lockfile (workspaces keep it at the root).
uses_bun=0
dir="$PWD"
for _ in 1 2 3 4; do
	if [ -f "$dir/bun.lock" ] || [ -f "$dir/bun.lockb" ]; then uses_bun=1; break; fi
	[ -f "$dir/package-lock.json" ] && break
	dir="$(dirname "$dir")"
done
if [ "$uses_bun" = 1 ]; then
	bun remove medusa-plugin-packeta >/dev/null 2>&1 || true
	bun add "$TGZ"
else
	npm install "$TGZ"
fi
echo "Installed $TGZ into $APP — restart the Medusa dev server."
