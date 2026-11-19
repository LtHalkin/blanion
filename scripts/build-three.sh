#!/bin/sh
# Rebuild public/vendor/three-lite.min.js (tree-shaken, minified Three.js ES module). Needs: npm i three (any dir) and esbuild.
set -e
THREE_DIR=${THREE_DIR:-/tmp/mj/node_modules/three}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
npx esbuild "$ROOT/scripts/three-entry.js" --bundle --minify --format=esm --alias:three="$THREE_DIR/build/three.module.js" --outfile="$ROOT/public/vendor/three-lite.min.js" --legal-comments=none
cp "$THREE_DIR/LICENSE" "$ROOT/public/vendor/three-LICENSE.txt"
echo "three $(node -p "require('$THREE_DIR/package.json').version")" > "$ROOT/public/vendor/three-VERSION.txt"
