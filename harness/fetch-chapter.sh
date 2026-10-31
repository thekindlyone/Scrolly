#!/usr/bin/env bash
# Usage: fetch-chapter.sh <series-slug> <chapter 4-digit>  -> cache/<slug>/<chapter>/NNN.png
# Downloads page images from the Weeb Central image CDN until the first 404.
set -eu
slug=$1; ch=$2; dir="$(dirname "$0")/cache/$slug/$ch"; mkdir -p "$dir"
for i in $(seq -w 1 400 | sed 's/^0*//' ); do
  n=$(printf %03d "$i"); f="$dir/$n.png"
  [ -s "$f" ] && continue
  code=$(curl -s -o "$f" -w "%{http_code}" "https://official.lowee.us/manga/$slug/$ch-$n.png")
  if [ "$code" != 200 ]; then rm -f "$f"; break; fi
done
echo "$slug $ch: $(ls "$dir" | wc -l) pages, $(du -sh "$dir" | cut -f1)"
