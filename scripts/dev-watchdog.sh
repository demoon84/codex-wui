#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SEC=0
RUN_BUILD=0
WATCH_TARGET="."
WATCH_PATHSPEC="."

usage() {
  cat <<'EOF'
Usage:
  bash ./scripts/dev-watchdog.sh [--path DIR] [--interval SEC] [--full] [--help]

Options:
  --path DIR       Limit change snapshot to DIR (repository-relative)
  --interval SEC   Repeat checks every SEC seconds (default: run once)
  --full           Include npm run build:web in each check cycle
  --help           Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Invalid --path value. Expected a directory path."
        exit 1
      fi
      WATCH_TARGET="$1"
      ;;
    --interval)
      shift
      if [[ $# -eq 0 || ! "$1" =~ ^[1-9][0-9]*$ ]]; then
        echo "Invalid --interval value. Expected a positive integer."
        exit 1
      fi
      INTERVAL_SEC="$1"
      ;;
    --full)
      RUN_BUILD=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

print_snapshot() {
  local change_count untracked_count shortstat latest_commit
  change_count="$(git -C "$ROOT_DIR" status --porcelain -- "$WATCH_PATHSPEC" | wc -l | tr -d ' ')"
  untracked_count="$(git -C "$ROOT_DIR" status --porcelain -- "$WATCH_PATHSPEC" | grep -c '^??' || true)"
  shortstat="$(git -C "$ROOT_DIR" diff --shortstat -- "$WATCH_PATHSPEC" || true)"
  latest_commit="$(git -C "$ROOT_DIR" log --date=iso --pretty=format:'%h %ad %s' -n 1)"

  echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "Latest commit: $latest_commit"
  echo "Watch path: $WATCH_PATHSPEC"
  echo "Working tree changes: $change_count files ($untracked_count untracked)"
  if [[ -n "$shortstat" ]]; then
    echo "Diff summary: $shortstat"
  fi
}

run_checks() {
  echo "Running: npm run tsc"
  npm --prefix "$ROOT_DIR" run tsc

  echo "Running: npm run test:quiet"
  npm --prefix "$ROOT_DIR" run test:quiet

  if [[ "$RUN_BUILD" -eq 1 ]]; then
    echo "Running: npm run build:web"
    npm --prefix "$ROOT_DIR" run build:web
  fi

  echo "Running: cargo check"
  cargo check --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
}

run_cycle() {
  echo "========================================"
  print_snapshot
  run_checks
  echo "Status: HEALTHY"
}

require_cmd git
require_cmd npm
require_cmd cargo

if [[ "$WATCH_TARGET" == "." ]]; then
  WATCH_PATHSPEC="."
else
  if [[ "$WATCH_TARGET" == /* ]]; then
    WATCH_ABS="$WATCH_TARGET"
  else
    WATCH_ABS="$ROOT_DIR/$WATCH_TARGET"
  fi

  if [[ ! -d "$WATCH_ABS" ]]; then
    echo "Invalid --path value. Directory not found: $WATCH_TARGET"
    exit 1
  fi

  case "$WATCH_ABS" in
    "$ROOT_DIR")
      WATCH_PATHSPEC="."
      ;;
    "$ROOT_DIR"/*)
      WATCH_PATHSPEC="${WATCH_ABS#"$ROOT_DIR"/}"
      ;;
    *)
      echo "Invalid --path value. Path must be inside repository: $WATCH_TARGET"
      exit 1
      ;;
  esac
fi

if [[ "$INTERVAL_SEC" -eq 0 ]]; then
  run_cycle
  exit 0
fi

echo "Starting development watchdog (path: ${WATCH_PATHSPEC}, interval: ${INTERVAL_SEC}s, full: ${RUN_BUILD})"
while true; do
  if run_cycle; then
    echo "Next check in ${INTERVAL_SEC}s..."
  else
    echo "Status: UNHEALTHY"
    echo "Next check in ${INTERVAL_SEC}s..."
  fi
  sleep "$INTERVAL_SEC"
done
