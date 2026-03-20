#!/usr/bin/env bash
# ci-monitor.sh — Check CI status and alert on failures
# Usage: bash scripts/ci-monitor.sh
# Schedule with cron: */10 * * * * cd /path/to/iranti-control-plane && bash scripts/ci-monitor.sh

set -euo pipefail

REPO="nfemmanuel/iranti-control-plane"
BRANCH="master"
ALERT_FILE="/tmp/iranti-ci-last-alert"

echo "=== Iranti Control Plane CI Monitor ==="
echo "$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Get last 3 runs
RUNS=$(gh run list --repo "$REPO" --branch "$BRANCH" --limit 3 \
  --json databaseId,status,conclusion,name,headBranch,createdAt,url 2>&1)

if [[ $? -ne 0 ]]; then
  echo "ERROR: Could not fetch CI runs. Is gh CLI authenticated?"
  echo "$RUNS"
  exit 1
fi

# Find most recent completed run
LATEST_CONCLUSION=$(echo "$RUNS" | jq -r '[.[] | select(.status == "completed")] | first | .conclusion // "unknown"')
LATEST_ID=$(echo "$RUNS" | jq -r '[.[] | select(.status == "completed")] | first | .databaseId // ""')
LATEST_URL=$(echo "$RUNS" | jq -r '[.[] | select(.status == "completed")] | first | .url // ""')
IN_PROGRESS=$(echo "$RUNS" | jq -r '[.[] | select(.status == "in_progress")] | length')

echo "Latest completed run: $LATEST_ID ($LATEST_CONCLUSION)"
echo "In-progress runs: $IN_PROGRESS"
echo ""

if [[ "$LATEST_CONCLUSION" == "failure" ]]; then
  # Avoid repeat alerts for the same run
  LAST_ALERTED=""
  if [[ -f "$ALERT_FILE" ]]; then
    LAST_ALERTED=$(cat "$ALERT_FILE")
  fi

  if [[ "$LAST_ALERTED" != "$LATEST_ID" ]]; then
    echo "=== ALERT: CI FAILURE DETECTED ==="
    echo "Run ID: $LATEST_ID"
    echo "URL: $LATEST_URL"
    echo ""
    echo "Failed steps:"
    gh run view "$LATEST_ID" --repo "$REPO" --log-failed 2>&1 | grep -E '(error TS|Error:|FAIL|##\[error\])' | head -30 || true
    echo ""
    echo "$LATEST_ID" > "$ALERT_FILE"

    # Optional: open in browser
    # gh run view "$LATEST_ID" --repo "$REPO" --web
  else
    echo "Already alerted for run $LATEST_ID — skipping."
  fi
elif [[ "$LATEST_CONCLUSION" == "success" ]]; then
  echo "CI is GREEN."
  # Clear alert state on success
  rm -f "$ALERT_FILE"
else
  echo "Status: $LATEST_CONCLUSION"
fi
