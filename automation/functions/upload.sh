#!/bin/bash
#
# R2 upload functions
#

upload_to_r2() {
  local local_file="$1"
  local r2_path="$2"
  
  # Upload file to R2 using AWS CLI (stdin redirected to prevent consuming loop input)
  aws s3 cp "$local_file" "s3://${R2_BUCKET}/${r2_path}" \
    --endpoint-url "$R2_ENDPOINT" \
    --no-progress \
    </dev/null \
    2>&1 | tee -a "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log "  Uploaded: $r2_path"
    return 0
  else
    log "  ERROR: Failed to upload $r2_path"
    return 1
  fi
}

delete_from_r2() {
  local r2_path="$1"
  
  # Delete file from R2 (stdin redirected to prevent consuming loop input)
  aws s3 rm "s3://${R2_BUCKET}/${r2_path}" \
    --endpoint-url "$R2_ENDPOINT" \
    </dev/null \
    2>&1 | tee -a "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log "  Deleted from R2: $r2_path"
    return 0
  else
    log "  ERROR: Failed to delete $r2_path"
    return 1
  fi
}

list_r2_files() {
  # List all files currently in R2 bucket (stdin redirected)
  aws s3 ls "s3://${R2_BUCKET}/" \
    --endpoint-url "$R2_ENDPOINT" \
    --recursive \
    </dev/null \
    | awk '{print $4}'
}
