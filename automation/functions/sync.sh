#!/bin/bash
#
# File synchronization and change detection functions
#

# Global variable to cache R2 file list
R2_FILE_CACHE=""

cache_r2_files() {
  log "Caching R2 file list for fast change detection..."
  R2_FILE_CACHE=$(aws s3 ls "s3://${R2_BUCKET}/" \
    --endpoint-url "$R2_ENDPOINT" \
    --recursive \
    | awk '{$1=$2=$3=""; print substr($0,4)}')

  local file_count=$(echo "$R2_FILE_CACHE" | grep -v '^$' | wc -l)
  log "Cached $file_count files from R2"
}

needs_processing() {
  local local_file="$1"
  local r2_path="$2"

  # Extract filename parts
  local filename=$(basename "$r2_path")
  local name_no_ext="${filename%.*}"
  local ext="${filename##*.}"

  # Get directory path
  local dir_path=$(dirname "$r2_path")
  [ "$dir_path" = "." ] && dir_path=""
  [ -n "$dir_path" ] && dir_path="${dir_path}/"

  # Determine what to check based on file type
  local check_file=""
  if echo "$filename" | grep -qiE "\.(${VIDEO_EXTS})$"; then
    # For videos, check if the video file itself exists
    check_file="${r2_path}"
  else
    # For images, check if watermarked version exists
    check_file="${dir_path}${name_no_ext}_watermarked.${ext}"
  fi

  # Check against cached R2 file list
  if echo "$R2_FILE_CACHE" | grep -qF "$check_file"; then
    # File exists in R2, skip
    return 1
  fi

  # File doesn't exist in R2, needs processing
  return 0
}

sync_deletions() {
  log "Checking for files to delete from R2..."

  local deleted_count=0

  # Build list of what SHOULD be in R2 based on current source files
  local expected_files=""

  while IFS= read -r source_file; do
    local filename=$(basename "$source_file")
    local name_no_ext="${filename%.*}"
    local ext="${filename##*.}"
    local rel_path=$(dirname "$source_file" | sed "s|^$SOURCE_DIR||" | sed 's|^/||')
    local r2_prefix=""
    [ -n "$rel_path" ] && r2_prefix="${rel_path}/"

    # Add expected R2 files for this source file
    if echo "$filename" | grep -qiE "\.(${VIDEO_EXTS})$"; then
      # Video: original + preview + thumb
      expected_files="${expected_files}${r2_prefix}${filename}"
      expected_files="${expected_files}${r2_prefix}${name_no_ext}_preview.jpg"
      expected_files="${expected_files}${r2_prefix}${name_no_ext}_thumb.jpg"
    else
      # Image: watermarked + thumb
      expected_files="${expected_files}${r2_prefix}${name_no_ext}_watermarked.${ext}"
      expected_files="${expected_files}${r2_prefix}${name_no_ext}_thumb.${ext}"
    fi
  done < <(find "$SOURCE_DIR" -type f -regextype posix-extended -iregex ".*\.(${IMAGE_EXTS}|${VIDEO_EXTS})")

  # Check each R2 file - if not in expected list, delete it
  while IFS= read -r r2_file; do
    [ -z "$r2_file" ] && continue

    if ! echo "$expected_files" | grep -qF "$r2_file"; then
      log "  Not in source, deleting from R2: $r2_file"
      delete_from_r2 "$r2_file"
      : $((deleted_count++))
    fi
  done <<< "$R2_FILE_CACHE"

  log "Deleted $deleted_count file(s) from R2"
}