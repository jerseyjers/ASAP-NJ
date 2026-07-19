#!/bin/bash
#
# JSON catalog generation functions
#

generate_catalog() {
  local source_dir="$1"
  local catalog_file="$2"

  log "Generating JSON catalog..."

  # Start JSON structure
  echo "{" > "$catalog_file"
  echo '  "categories": {' >> "$catalog_file"

  local first_category=true

  # Get all unique top-level directories (categories)
  local categories=$(find "$source_dir" -mindepth 1 -type f -regextype posix-extended \
    -iregex ".*\.(${IMAGE_EXTS}|${VIDEO_EXTS})" \
    -printf "%h\n" | \
    sed "s|^$source_dir/*||" | \
    cut -d'/' -f1 | \
    sort -u)

  # If no subdirectories, use "General" for root files
  local root_files=$(find "$source_dir" -maxdepth 1 -type f -regextype posix-extended \
    -iregex ".*\.(${IMAGE_EXTS}|${VIDEO_EXTS})" | sort)

  if [ -n "$root_files" ]; then
    echo "    \"$ROOT_CATEGORY\": [" >> "$catalog_file"

    local first_item=true
    while IFS= read -r file; do
      [ -z "$file" ] && continue

      if [ "$first_item" = false ]; then
        echo "      ," >> "$catalog_file"
      fi
      first_item=false

      generate_catalog_entry "$file" "$catalog_file"
    done <<< "$root_files"

    echo "" >> "$catalog_file"
    echo "    ]" >> "$catalog_file"
    first_category=false
  fi

  # Process each top-level category
  while IFS= read -r category; do
    [ -z "$category" ] && continue

    # Find all files in this category (including nested subdirectories)
    local category_files=$(find "$source_dir/$category" -type f -regextype posix-extended \
      -iregex ".*\.(${IMAGE_EXTS}|${VIDEO_EXTS})" | sort)

    [ -z "$category_files" ] && continue

    if [ "$first_category" = false ]; then
      echo "    ," >> "$catalog_file"
    fi
    first_category=false

    echo "    \"$category\": [" >> "$catalog_file"

    local first_item=true
    while IFS= read -r file; do
      [ -z "$file" ] && continue

      if [ "$first_item" = false ]; then
        echo "      ," >> "$catalog_file"
      fi
      first_item=false

      generate_catalog_entry "$file" "$catalog_file"
    done <<< "$category_files"

    echo "" >> "$catalog_file"
    echo "    ]" >> "$catalog_file"
  done <<< "$categories"

  # Close JSON structure
  echo "" >> "$catalog_file"
  echo '  }' >> "$catalog_file"
  echo '}' >> "$catalog_file"

  log "Catalog generated: $catalog_file"
}

generate_catalog_entry() {
  local file="$1"
  local catalog_file="$2"

  local filename=$(basename "$file")
  local name_no_ext="${filename%.*}"
  local ext="${filename##*.}"

  # Get relative path from source dir (for folder structure)
  local rel_path=$(dirname "$file" | sed "s|^$SOURCE_DIR||" | sed 's|^/||')
  local r2_prefix=""
  [ -n "$rel_path" ] && r2_prefix="${rel_path}/"

  # URL-encode spaces and special characters
  local encoded_prefix=$(echo "${r2_prefix}" | sed 's/ /%20/g')
  local encoded_name=$(echo "${name_no_ext}" | sed 's/ /%20/g')

  # Check if it's a video
  if echo "$filename" | grep -qiE "\.(${VIDEO_EXTS})$"; then
    # Video entry - URL-encode filename too
    local encoded_filename=$(echo "${filename}" | sed 's/ /%20/g')
    local video_url="${R2_PUBLIC_URL}/${encoded_prefix}${encoded_filename}"
    local preview_url="${R2_PUBLIC_URL}/${encoded_prefix}${encoded_name}_preview.jpg"
    local thumb_url="${R2_PUBLIC_URL}/${encoded_prefix}${encoded_name}_thumb.jpg"

    cat >> "$catalog_file" << EOF
      {
        "filename": "$filename",
        "type": "video",
        "video": "$video_url",
        "preview": "$preview_url",
        "thumbnail": "$thumb_url"
      }
EOF
  else
    # Image entry
    local full_url="${R2_PUBLIC_URL}/${encoded_prefix}${encoded_name}_watermarked.${ext}"
    local thumb_url="${R2_PUBLIC_URL}/${encoded_prefix}${encoded_name}_thumb.${ext}"

    cat >> "$catalog_file" << EOF
      {
        "filename": "$filename",
        "type": "image",
        "full": "$full_url",
        "thumbnail": "$thumb_url"
      }
EOF
  fi
}

push_catalog_to_github() {
  log "Pushing catalog to GitHub..."

  cd "$REPO_DIR"

  # Add and commit catalog
  git add docs/gallery-data.json
  git commit -m "Update gallery catalog - $(date '+%Y-%m-%d %H:%M:%S')" || {
    log "No changes to commit"
    return 0
  }

  # Push to remote
  git push origin $(git branch --show-current)

  if [ $? -eq 0 ]; then
    log "Catalog pushed to GitHub"
    return 0
  else
    log "ERROR: Failed to push catalog to GitHub"
    return 1
  fi
}