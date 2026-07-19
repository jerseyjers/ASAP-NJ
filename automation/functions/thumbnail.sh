#!/bin/bash
#
# Thumbnail generation functions
#

generate_thumbnail() {
  local input_file="$1"
  local output_file="$2"
  
  # Generate thumbnail with ImageMagick (stdin redirected)
  convert "$input_file" \
    -resize "${THUMBNAIL_SIZE}^" \
    -gravity center \
    -extent "$THUMBNAIL_SIZE" \
    "$output_file" \
    </dev/null \
    2>&1 | tee -a "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log "  Created thumbnail: $(basename "$output_file")"
    return 0
  else
    log "  ERROR: Failed to create thumbnail for $(basename "$input_file")"
    return 1
  fi
}
