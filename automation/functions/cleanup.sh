#!/bin/bash
#
# Cleanup functions
#

cleanup_temp_files() {
  log "Cleaning up temporary files..."

  # Remove processed files from working directories
  rm -f "$ORIG_DIR"/*
  rm -f "$WATER_DIR"/*
  rm -f "$THUMB_DIR"/*

  log "Cleanup complete"
}