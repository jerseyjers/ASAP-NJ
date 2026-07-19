#!/bin/bash
#
# Video processing functions
#

process_video() {
  local input_video="$1"
  local output_video="$2"
  local max_duration=180  # 3 minutes in seconds
  
  # Get video duration in seconds (stdin redirected)
  local duration=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$input_video" \
    </dev/null 2>/dev/null)
  
  if [ -z "$duration" ]; then
    log "  ERROR: Could not determine video duration for $(basename "$input_video")"
    return 1
  fi
  
  local duration_int=$(printf "%.0f" "$duration")
  
  if [ "$duration_int" -gt "$max_duration" ]; then
    # Video exceeds limit - trim to 3 minutes
    log "  Trimming video from ${duration_int}s to ${max_duration}s: $(basename "$input_video")"
    ffmpeg -i "$input_video" -t "$max_duration" -c copy "$output_video" \
      -loglevel error \
      </dev/null \
      2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      log "  ERROR: Failed to trim video $(basename "$input_video")"
      return 1
    fi
  else
    # Video is under limit - just copy it
    log "  Video within limit (${duration_int}s): $(basename "$input_video")"
    cp "$input_video" "$output_video"
  fi
  
  return 0
}

extract_video_frame() {
  local video_file="$1"
  local output_file="$2"
  
  # Get video duration in seconds (stdin redirected)
  local duration=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$video_file" \
    </dev/null 2>/dev/null)
  
  if [ -z "$duration" ]; then
    log "  ERROR: Could not determine video duration for $(basename "$video_file")"
    return 1
  fi
  
  # Calculate middle timestamp
  local middle=$(awk "BEGIN {print $duration / 2}")
  
  # Extract frame from middle of video (stdin redirected)
  ffmpeg -ss "$middle" -i "$video_file" -frames:v 1 -q:v 2 "$output_file" \
    -loglevel error \
    </dev/null \
    2>&1 | tee -a "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log "  Extracted frame from video: $(basename "$video_file")"
    return 0
  else
    log "  ERROR: Failed to extract frame from $(basename "$video_file")"
    return 1
  fi
}
