#!/bin/bash
#
# Image watermarking functions
#

generate_watermark() {
  local input_file="$1"
  local output_file="$2"
  
  local watermark_text="$WATERMARK_TEXT"
  local watermark_opacity="$WATERMARK_OPACITY"
  
  # Generate watermark with ImageMagick (stdin redirected)
  convert "$input_file" \
    -gravity SouthEast \
    -pointsize 48 \
    -fill "rgba(255,255,255,$watermark_opacity)" \
    -annotate +30+30 "$watermark_text" \
    "$output_file" \
    </dev/null \
    2>&1 | tee -a "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log "  Created watermark: $(basename "$output_file")"
    return 0
  else
    log "  ERROR: Failed to create watermark for $(basename "$input_file")"
    return 1
  fi
}
