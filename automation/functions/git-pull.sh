#!/bin/bash

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# Acquire lock
if ! acquire_lock; then
  exit 1
fi
trap release_lock EXIT

# Pull latest from master
REPO_DIR="/opt/asap-gallery/repo"
cd "$REPO_DIR" || exit 1

echo "$(date): Pulling latest changes from master..."
git fetch origin && git reset --hard origin/master && git clean -fd

echo "$(date): Git pull complete"
