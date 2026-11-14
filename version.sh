#!/bin/sh
# Stamps index.html's style.css and app.js includes with a hash of each file's contents (?v=<hash>),
# so browsers fetch fresh copies after a change instead of reusing stale cached ones.
set -e
cd "$(dirname "$0")"
for f in style.css app.js; do
  v=$(shasum -a 256 "$f" | cut -c1-8)
  perl -pi -e "s/\"\Q$f\E(\?v=[0-9a-f]*)?\"/\"$f?v=$v\"/g" index.html
  echo "$f?v=$v"
done
