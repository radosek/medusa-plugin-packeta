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
bunx medusa plugin:build
OUT="$(mktemp -d)"
bun pm pack --ignore-scripts --destination "$OUT" >/dev/null
TGZ="$(ls "$OUT"/*.tgz)"
cd "$APP"
if [ -f bun.lock ] || [ -f bun.lockb ]; then
	bun remove medusa-plugin-packeta >/dev/null 2>&1 || true
	bun add "$TGZ"
else
	npm install "$TGZ"
fi
echo "Installed $TGZ into $APP — restart the Medusa dev server."
