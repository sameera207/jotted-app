#!/usr/bin/env bash
# Run the jotted CLI from a jotted-cli checkout (default ../jotted-cli), for development
# before release builds exist: JOTTED_BIN=scripts/dev-jotted.sh npm run tauri dev
root="$(cd "$(dirname "$0")/.." && pwd)"
exec uv run -q --project "${JOTTED_CLI_SRC:-$root/../jotted-cli}" jotted "$@"
