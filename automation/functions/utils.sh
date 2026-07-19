#!/bin/bash

# Lockfile management
LOCKFILE="/tmp/gallery-sync.lock"

acquire_lock() {
  if [ -f "$LOCKFILE" ]; then
    local lock_pid=$(cat "$LOCKFILE" 2>/dev/null)
    if [ -n "$lock_pid" ] && ps -p "$lock_pid" > /dev/null 2>&1; then
      echo "$(date): Another instance is running (PID: $lock_pid). Exiting."
      return 1
    else
      echo "$(date): Stale lockfile found, removing."
      rm -f "$LOCKFILE"
    fi
  fi

  echo $$ > "$LOCKFILE"
  echo "$(date): Lock acquired (PID: $$)"
  return 0
}

release_lock() {
  rm -f "$LOCKFILE"
  echo "$(date): Lock released"
}