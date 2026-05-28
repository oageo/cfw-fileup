#!/usr/bin/env bash
set -euo pipefail

config_path="${1:-}"
database_name="${2:-}"

if [ -z "$config_path" ]; then
	echo "Usage: pnpm deploy:config <wrangler-config-path> [d1-database-name]" >&2
	exit 1
fi

CF_WRANGLER_CONFIG_PATH="$config_path" pnpm build

if [ -n "$database_name" ]; then
	pnpm wrangler d1 migrations apply "$database_name" --remote --config "$config_path"
fi

pnpm wrangler deploy
