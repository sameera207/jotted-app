#!/usr/bin/env bash
# Record the fake CLI's answers from a real `jotted`, so they can't drift from what it prints.
#
#   scripts/record-fixtures.sh                     uses $JOTTED_BIN, else scripts/dev-jotted.sh
#
# Runs in a throwaway app folder (JOTTED_HOME/JOTTED_CONFIG in a temp dir), with no keys in
# the environment and no rmapi on PATH, so nothing touches your real Jotted or the cloud.
# JOTTED_CLAUDE_CONFIG points at a temp file too: never at the real Claude Desktop settings.
# Re-record whenever jotted.lock's pin changes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
bin="${JOTTED_BIN:-$root/scripts/dev-jotted.sh}"
out="$root/tests/fixtures"
tmp="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT

# A PATH with only the basics, so a locally installed rmapi
# isn't found and setup status shows a first run. (uv for dev-jotted.sh, node to save files.)
mkdir -p "$tmp/bin"
for tool in uv node; do ln -s "$(command -v "$tool")" "$tmp/bin/$tool"; done
export PATH="$tmp/bin:/usr/bin:/bin"
export JOTTED_HOME="$tmp/home" JOTTED_NO_UPDATE=1 JOTTED_BUNDLED=1
export JOTTED_CLAUDE_CONFIG="$tmp/Claude/claude_desktop_config.json"
unset ANTHROPIC_API_KEY TYPESAFE_API_KEY JOTTED_CONFIG

# The CLI's example config, with the database inside the temp folder.
cli_src="$(cd "${JOTTED_CLI_SRC:-$root/../jotted-cli}" && pwd -P)"
sed "s#db   = \"./data/jotted.db\"#db = \"$tmp/db.sqlite\"#" "$cli_src/src/jotted/config.example.toml" >"$tmp/config.toml"
export JOTTED_CONFIG="$tmp/config.toml"

# Temp paths, and the dev checkout's jotted, become the paths a person would see: the app's
# bundled jotted, Claude's settings, an older copy of the app in Downloads.
# The jotted `claude connect` names by default: the dev checkout's, or a release build's own.
if [[ -n "${JOTTED_BIN:-}" && "$(basename "$bin")" == "jotted" ]]; then
  current="$(cd "$(dirname "$bin")" && pwd -P)/jotted"
else
  current="$cli_src/.venv/bin/jotted"
fi
SCRUB="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- \
  "$current" "/Applications/Jotted.app/Contents/Resources/jotted/jotted" \
  "$tmp/Claude" "/Users/you/Library/Application Support/Claude" \
  "$tmp/Apps" "/Users/you/Downloads" \
  "$tmp/elsewhere" "/usr/local/bin" \
  "$tmp" "/Users/you/Library/Application Support/jotted")"
export SCRUB

rm -rf "$out" && mkdir -p "$out"

# rec NAME ARGS... : save the envelope (and exit code) of `jotted --json --local ARGS`.
rec() {
  local name="$1"; shift
  local code=0
  "$bin" --json --local "$@" >"$tmp/out.json" 2>/dev/null || code=$?
  node -e '
    const fs = require("fs");
    const [file, out, code, argv] = process.argv.slice(1);
    const pairs = JSON.parse(process.env.SCRUB);
    let text = fs.readFileSync(file, "utf8");
    let args = argv;
    for (let i = 0; i < pairs.length; i += 2) {
      text = text.split(pairs[i]).join(pairs[i + 1]);
      args = args.split(pairs[i]).join(pairs[i + 1]);
    }
    fs.writeFileSync(out, JSON.stringify({argv: JSON.parse(args), exit: Number(code), envelope: JSON.parse(text)}, null, 2) + "\n");
  ' "$tmp/out.json" "$out/$name.json" "$code" "$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@")"
  echo "  $name (exit $code)"
}

echo "recording from $bin into tests/fixtures/"
rec version version
rec setup-status setup status
rec settings settings
rec ai ai
rec status-empty status
rec events-empty events
rec items-add items add Book the retro room for Thursday
rec items-add-2 items add Tag the 0.2 release
rec items-add-3 items add Renew the passport
rec items-done items done 2
rec items-reopen items reopen 2
rec items-edit items edit 3 Renew the passport before May
rec items-dismiss items dismiss 3

# Proposals: what an agent found in someone's documents, waiting for the person.
rec proposal-add items add Send Dana the rollout plan --propose --agent --owner mine \
  --source-kind doc --source-key platform-sync-29-sep-l14 --source-title "Platform sync, 29 Sep" \
  --source-url https://docs.example.com/d/platform-sync --excerpt "Sam to send Dana the rollout plan by Friday"
rec proposal-add-2 items add Review the Q4 budget draft --propose --agent --owner others --owner-name Priya \
  --source-kind mail --source-key msg-8812 --source-title "Re: Q4 budget" --excerpt "Priya will circulate the draft for review"
rec proposal-add-3 items add Book flights for the offsite --propose --agent \
  --source-kind calendar --source-key evt-offsite-2026 --source-title "Team offsite"
rec proposal-bad-url items add Open this --propose --agent --source-kind chat --source-key c-1 --source-url "javascript:alert(1)"
rec agent-add items add Call the bank about the card --agent
rec items-proposed items --status proposed
rec items-get items get 4
rec items-accept items accept 4
rec items-accept-again items accept 4
rec proposal-dismiss items dismiss 6
rec items-all items --status all
rec settings-set settings set poll_interval_s 120
rec settings-set-add-mode settings set mcp_add_mode propose_all
rec status status
rec events events --since 0
rec error-not-found items done 999
rec error-invalid settings set poll_interval_s nope
rec library library
rec check check
rec image-line image line 0000 1:1

# Claude Desktop, in each state (specs/Claude-Desktop-spec.md, Status and repair).
rec claude-status-not-installed claude status
rec claude-connect-not-installed claude connect
mkdir -p "$tmp/Claude"
rec claude-status-not-configured claude status
rec claude-connect claude connect
rec claude-connect-unchanged claude connect
rec claude-status-connected claude status
rec claude-connect-admin claude connect --admin
rec claude-status-connected-admin claude status
old_app="$tmp/Apps/Jotted.app/Contents/Resources/jotted"
mkdir -p "$old_app" && printf '#!/bin/sh\n' >"$old_app/jotted" && chmod +x "$old_app/jotted"
rec claude-connect-other-app claude connect --command "$old_app/jotted"
rec claude-status-other-app claude status
rm -rf "$tmp/Apps"
rec claude-status-missing claude status
mkdir -p "$tmp/elsewhere" && printf '#!/bin/sh\n' >"$tmp/elsewhere/jotted" && chmod +x "$tmp/elsewhere/jotted"
rec claude-connect-another claude connect --command "$tmp/elsewhere/jotted"
rec claude-status-another claude status
rec claude-connect-invalid claude connect --command "$tmp/nope/jotted"
rec claude-disconnect claude disconnect
rec claude-disconnect-unchanged claude disconnect
printf '{"mcpServers": ' >"$JOTTED_CLAUDE_CONFIG"
rec claude-connect-bad-config claude connect
rec claude-status-bad-config claude status
