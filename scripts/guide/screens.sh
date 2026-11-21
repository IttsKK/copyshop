#!/bin/zsh
# screens.sh: the Guide's pictures of the window (public/guide/start), taken
# from the app on the dev server (:5178) with a sample photo open, by
# screens.json's steps in a hidden WKWebView (wkshots.swift). Each step that
# takes a picture says where its part of the window is; this crops to it.
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
swiftc -O scripts/guide/wkshots.swift -o $T/wkshots 2>/dev/null || exit 1
WKTIMEOUT=150 $T/wkshots http://localhost:5178/ scripts/guide/screens.json $T 1440 900 | grep -E '^JS\[[0-9]+\]: [a-z-]+ \[' | sed 's/^JS\[[0-9]*\]: //' > $T/rects.txt
P=public/guide/start
mkdir -p $P
# How much of the tall panels to keep, in screen pixels (twice the page's).
typeset -A KEEP=(recipes 1250 modules 500 export 420)
while read -r name rect; do
  r=${rect//[\[\]]/}
  x=${r%%,*}; r=${r#*,}; y=${r%%,*}; r=${r#*,}; w=${r%%,*}; h=${r#*,}
  f=$name; [ $name = maskpanel ] && f=mask-panel
  hh=$((h * 2)); [ -n "${KEEP[$f]}" ] && hh=${KEEP[$f]}
  if [ $f = photos ]; then magick $T/$f.png -resize 1280x -quality 86 $P/$f.jpg
  else magick $T/$f.png -crop $((w * 2))x${hh}+$((x * 2))+$((y * 2)) +repage -quality 88 $P/$f.jpg; fi
  echo "$f.jpg"
done < $T/rects.txt
rm -rf $T
