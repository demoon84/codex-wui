#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   npm run dev:web
#   scripts/playwright-smoke-typed.sh http://localhost:5173 60
# Optional env:
#   PW_TYPE_DELAY_MS=60
#   PW_STREAM_WAIT_MS=1800
#   PW_PROMPT_TEXT="Playwright smoke prompt"
#   PW_HEADED=1

BASE_URL="${1:-http://localhost:5173}"
TYPE_DELAY_MS="${PW_TYPE_DELAY_MS:-${2:-60}}"
STREAM_WAIT_MS="${PW_STREAM_WAIT_MS:-1800}"
PROMPT_TEXT="${PW_PROMPT_TEXT:-Playwright smoke prompt}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/output/playwright"
SESSION="codex-wui-smoke"
MOCK_INIT_SCRIPT="$PROJECT_ROOT/scripts/playwright/mock-tauri-init.js"
PW_CONFIG_FILE="$OUTPUT_DIR/playwright-cli.smoke.json"

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PW_WRAPPER="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
LOCAL_PWCLI="$PROJECT_ROOT/node_modules/.bin/playwright-cli"

if [[ ! "$TYPE_DELAY_MS" =~ ^[0-9]+$ ]]; then
  echo "PW_TYPE_DELAY_MS must be an integer (ms). Got: $TYPE_DELAY_MS" >&2
  exit 1
fi

if [[ ! "$STREAM_WAIT_MS" =~ ^[0-9]+$ ]]; then
  echo "PW_STREAM_WAIT_MS must be an integer (ms). Got: $STREAM_WAIT_MS" >&2
  exit 1
fi

if [[ -x "$LOCAL_PWCLI" ]]; then
  PWCLI=("$LOCAL_PWCLI")
elif command -v playwright-cli >/dev/null 2>&1; then
  PWCLI=(playwright-cli)
elif command -v npx >/dev/null 2>&1; then
  PWCLI=(npx --yes --package playwright-cli playwright-cli)
elif [[ -x "$PW_WRAPPER" ]]; then
  PWCLI=("$PW_WRAPPER")
else
  echo "Playwright CLI not found. Install playwright-cli or ensure npx is available." >&2
  exit 1
fi

if ! "${PWCLI[@]}" --help >/dev/null 2>&1; then
  echo "Playwright CLI command exists but failed to execute in this environment." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Ensure a clean smoke session.
"${PWCLI[@]}" session-stop "$SESSION" >/dev/null 2>&1 || true
rm -f "$OUTPUT_DIR/02-main-initial.yml" "$OUTPUT_DIR/02-main-ready.yml" "$OUTPUT_DIR/03-after-send.yml" "$OUTPUT_DIR/final-state.png"

if [[ ! -f "$MOCK_INIT_SCRIPT" ]]; then
  echo "Mock init script not found: $MOCK_INIT_SCRIPT" >&2
  exit 1
fi

HEADLESS_JSON_VALUE="true"
if [[ "${PW_HEADED:-1}" == "1" ]]; then
  HEADLESS_JSON_VALUE="false"
fi

cat > "$PW_CONFIG_FILE" <<EOF
{
  "outputDir": "$OUTPUT_DIR",
  "browser": {
    "launchOptions": {
      "headless": ${HEADLESS_JSON_VALUE}
    },
    "initScript": [
      "$MOCK_INIT_SCRIPT"
    ]
  }
}
EOF

run_pw() {
  local output
  if ! output=$("${PWCLI[@]}" --session "$SESSION" --config "$PW_CONFIG_FILE" "$@" 2>&1); then
    printf '%s\n' "$output" >&2
    return 1
  fi
  printf '%s\n' "$output"
  if grep -q '^### Error' <<<"$output"; then
    echo "Playwright CLI reported an error for command: $*" >&2
    return 1
  fi
}

resolve_snapshot_file() {
  local name="$1"
  if [[ -f "$PROJECT_ROOT/.playwright-cli/$name" ]]; then
    printf '%s\n' "$PROJECT_ROOT/.playwright-cli/$name"
    return 0
  fi
  if [[ -f "$OUTPUT_DIR/$name" ]]; then
    printf '%s\n' "$OUTPUT_DIR/$name"
    return 0
  fi
  return 1
}

copy_if_needed() {
  local source="$1"
  local target="$2"
  if [[ "$source" != "$target" ]]; then
    cp "$source" "$target"
  fi
}

TYPE_DELAY_SECONDS="$(awk "BEGIN { printf \"%.3f\", ${TYPE_DELAY_MS}/1000 }")"

# 1) Open app with Tauri bridge mock
run_pw open "$BASE_URL" >/dev/null
run_pw snapshot --filename "02-main-initial.yml" >/dev/null
INITIAL_SNAPSHOT_FILE="$(resolve_snapshot_file "02-main-initial.yml")"
copy_if_needed "$INITIAL_SNAPSHOT_FILE" "$OUTPUT_DIR/02-main-initial.yml"

LOGIN_REF="$(sed -nE 's/.*button "[^"]*(로그인|Login)[^"]*" \[ref=(e[0-9]+)\].*/\2/p' "$INITIAL_SNAPSHOT_FILE" | head -n 1)"
if [[ -n "$LOGIN_REF" ]]; then
  run_pw click "$LOGIN_REF" >/dev/null
fi

# 2) Input prompt as human typing (NOT fill), with delay per character
INPUT_REF=""
READY_SNAPSHOT_FILE=""
for ((attempt = 0; attempt < 25; attempt++)); do
  run_pw snapshot --filename "02-main-ready.yml" >/dev/null
  READY_SNAPSHOT_FILE="$(resolve_snapshot_file "02-main-ready.yml")"
  INPUT_REF="$(sed -nE 's/.*textbox .* \[ref=(e[0-9]+)\].*/\1/p' "$READY_SNAPSHOT_FILE" | head -n 1)"
  if [[ -n "$INPUT_REF" ]]; then
    break
  fi
  sleep 0.2
done

if [[ -z "$INPUT_REF" ]]; then
  echo "Failed to locate chat input textbox ref in snapshot: $READY_SNAPSHOT_FILE" >&2
  exit 1
fi

copy_if_needed "$READY_SNAPSHOT_FILE" "$OUTPUT_DIR/02-main-ready.yml"
run_pw click "$INPUT_REF" >/dev/null
for ((idx = 0; idx < ${#PROMPT_TEXT}; idx++)); do
  run_pw type "${PROMPT_TEXT:idx:1}" >/dev/null
  sleep "$TYPE_DELAY_SECONDS"
done
run_pw press Enter >/dev/null

# 3) Wait for streamed UI updates and capture artifacts
sleep "$(awk "BEGIN { printf \"%.3f\", ${STREAM_WAIT_MS}/1000 }")"
run_pw snapshot --filename "03-after-send.yml" >/dev/null
AFTER_SEND_SNAPSHOT_FILE="$(resolve_snapshot_file "03-after-send.yml")"
copy_if_needed "$AFTER_SEND_SNAPSHOT_FILE" "$OUTPUT_DIR/03-after-send.yml"
run_pw screenshot --filename "final-state.png" >/dev/null
FINAL_SCREENSHOT_FILE="$PROJECT_ROOT/.playwright-cli/final-state.png"
if [[ -f "$FINAL_SCREENSHOT_FILE" ]]; then
  cp "$FINAL_SCREENSHOT_FILE" "$OUTPUT_DIR/final-state.png"
fi

echo "Saved smoke artifacts in $OUTPUT_DIR (type delay: ${TYPE_DELAY_MS}ms, wait: ${STREAM_WAIT_MS}ms)"
