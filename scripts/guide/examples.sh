#!/bin/zsh
# examples.sh [module]: render the Guide's examples (examples.html) and put them in public/guide/examples.
# Needs the dev server on :5178 and wkrun (scripts/timelapse/wkrun.swift, a hidden WKWebView) at /tmp/wkrun.
cd "$(dirname "$0")/../.."
D=out/guide/examples
rm -f $D/log.txt
/tmp/wkrun "http://localhost:5178/scripts/guide/examples.html${1:+?only=$1}" 120 >/dev/null 2>&1 &
pid=$!
for i in $(seq 1 120); do grep -q "done\|ERR" $D/log.txt 2>/dev/null && break; sleep 1; done
kill -9 $pid 2>/dev/null
cat $D/log.txt; echo
grep -q ERR $D/log.txt && exit 1
mkdir -p public/guide/examples
cp $D/*.jpg public/guide/examples/
ls public/guide/examples | wc -l
