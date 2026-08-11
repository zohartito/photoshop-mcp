#!/usr/bin/env bash
# UNTIL-loop for M3 backend-B parity (docs/design/transport-layer.md §12):
# run the parity harness; while it reports diffs, hand the report to `claude -p`
# to fix the transport code, then re-run. Capped at PARITY_LOOP_MAX fix attempts.
#
# Harness exit codes (scripts/parity-uxp.ts):
#   0 = parity clean → loop exits 0
#   1 = diffs found  → fix attempt, re-run
#   2 = setup failure (no Photoshop / plugin not polling) → abort, exit 2
#
# Prereqs (same as the harness): Photoshop 2026 running, uxp-plugin/ loaded via
# UXP Developer Tools with its panel opened once so the poll loop is live.
#
# Usage:
#   bash scripts/parity-fix-loop.sh              # real run
#   bash scripts/parity-fix-loop.sh --dry-run    # loop-logic test, no Photoshop/claude
#
# Env overrides: PARITY_LOOP_MAX (default 6) · PARITY_CMD · CLAUDE_CMD

set -u
cd "$(dirname "$0")/.."

MAX_FIX_ATTEMPTS="${PARITY_LOOP_MAX:-6}"
PARITY_CMD="${PARITY_CMD:-npx tsx scripts/parity-uxp.ts}"
CLAUDE_CMD="${CLAUDE_CMD:-claude}"
REPORT="scripts/output/parity-uxp-report.json"
LOG_DIR="scripts/output/parity-loop"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$LOG_DIR/$STAMP"
mkdir -p "$RUN_DIR"

# Dry runs must never clobber the real harness report.
[ "$DRY_RUN" = 1 ] && REPORT="$RUN_DIR/dry-parity-report.json"

log() { echo "[parity-loop] $*"; }

run_parity() {
  if [ "$DRY_RUN" = 1 ]; then
    # Dry run: first check is dirty (writes a fake report), second is clean.
    if [ ! -f "$RUN_DIR/.dry-check-done" ]; then
      touch "$RUN_DIR/.dry-check-done"
      cat > "$REPORT" <<'EOF'
{
  "ranAt": "dry-run",
  "fixture": "dry-run",
  "results": [
    {
      "command": "get_layers",
      "clean": false,
      "diffs": ["$.layers[1].opacity: A=100 B=255"]
    }
  ]
}
EOF
      return 1
    fi
    return 0
  fi
  $PARITY_CMD
}

run_fixer() {
  local attempt="$1"
  local report_json
  report_json="$(cat "$REPORT")"
  local prompt="You are inside the photoshop-mcp repo. The M3 extendscript-vs-uxp transport
parity harness (scripts/parity-uxp.ts) just ran and found diffs between backend A
(ExtendScript) and backend B (UXP batchPlay). Fix attempt $attempt of $MAX_FIX_ATTEMPTS.

Full parity report (backend A payloads are the ground truth):
$report_json

Task: make backend B's normalized payloads identical to backend A's.
- Fix ONLY the backend-B side: src/transport/uxp-transport.ts,
  src/transport/uxp-commands/ (normalize.ts, descriptors.ts), and if truly
  required the uxp-plugin/ command handlers.
- Do NOT change backend A (ExtendScript) behavior, tool names, tool schemas, or
  error envelopes. Do NOT touch security tombstones (docs/security-boundaries.md).
- Known unit gotchas are documented in docs/design/transport-layer.md ('AM vs DOM'):
  opacity 0-255 vs percent, layerLocking vs locked, numberOfLayers vs layerCount,
  _index spaces, selection get throwing when empty.
- After editing, run: npm run build:server && npm run test:uxp-normalize
  and fix any failures.
Do not run scripts/parity-uxp.ts yourself — the outer loop re-runs it."
  if [ "$DRY_RUN" = 1 ]; then
    log "(dry-run) would invoke: $CLAUDE_CMD -p <prompt> (${#prompt} chars)"
    return 0
  fi
  $CLAUDE_CMD -p "$prompt" \
    --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm run build:server),Bash(npm run test:uxp-normalize)" \
    2>&1 | tee "$RUN_DIR/fix-attempt-$attempt.log"
}

attempt=0
while true; do
  log "Parity check (fix attempts so far: $attempt/$MAX_FIX_ATTEMPTS)…"
  run_parity
  code=$?
  case "$code" in
    0)
      log "PARITY CLEAN after $attempt fix attempt(s). Done."
      exit 0
      ;;
    2)
      log "Setup failure (exit 2) — Photoshop not running or UXP plugin not polling."
      log "Fix the environment (launch PS, load uxp-plugin/ in UDT, open its panel) and re-run."
      exit 2
      ;;
    1)
      cp "$REPORT" "$RUN_DIR/report-after-check-$attempt.json" 2>/dev/null || true
      if [ "$attempt" -ge "$MAX_FIX_ATTEMPTS" ]; then
        log "PARITY STILL DIRTY after $MAX_FIX_ATTEMPTS fix attempts — stopping."
        log "Reports and fixer logs: $RUN_DIR"
        exit 1
      fi
      attempt=$((attempt + 1))
      log "Diffs found — fix attempt $attempt/$MAX_FIX_ATTEMPTS via claude -p…"
      run_fixer "$attempt"
      ;;
    *)
      log "Unexpected harness exit code $code — stopping."
      exit "$code"
      ;;
  esac
done
