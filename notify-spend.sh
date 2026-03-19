#!/usr/bin/env bash
# Run Cursor Spend Tracker from CLI and show the result in a macOS notification.
# Usage: ./scripts/notify-spend.sh
# Requires: Node.js, sqlite3, and npx (tsx) in PATH. Cursor must have been used at least once (for auth).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR" && pwd)"
cd "$PROJECT_ROOT"

OUTPUT=""
TITLE="Cursor Spend"

if output=$(npx tsx cli.ts 2>&1); then
    OUTPUT="$output"
else
    exit_code=$?
    OUTPUT="$output"
    if [[ -z "$OUTPUT" ]]; then
        OUTPUT="Command failed with exit code $exit_code."
    fi
    TITLE="Cursor Spend — Error"
fi

# Escape for AppleScript: \ -> \\, " -> \", newlines -> \n (so notification shows line breaks)
BODY=$(printf '%s' "$OUTPUT" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{if(NR>1) printf "\\n"; printf "%s", $0}')

# macOS notification: prefer terminal-notifier if available, else osascript
if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "$TITLE" -message "$OUTPUT" -open "https://cursor.com/dashboard/usage"
else
    osascript -e "display notification \"$BODY\" with title \"$TITLE\""
fi
