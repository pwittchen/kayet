#!/bin/sh
# Removes build artifacts and installed dependencies (Cargo, npm, Vite, website).
# Run `npm ci && npm run build` afterwards before building the Rust crate again.
# Usage: scripts/clean.sh
set -eu

cd "$(dirname "$0")/.."

if command -v cargo >/dev/null 2>&1; then
  echo "cargo clean"
  cargo clean
fi

for path in \
  target \
  dist \
  node_modules \
  ui/node_modules \
  core/gen \
  website/dist \
  website/node_modules \
  website/alternatives \
  website/sitemap.xml
do
  if [ -e "$path" ]; then
    echo "removing $path"
    rm -rf "$path"
  fi
done

echo "clean"
