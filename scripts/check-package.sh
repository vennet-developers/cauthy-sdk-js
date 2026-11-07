#!/bin/sh
# What npm would publish, checked before it is: the build, the export map,
# the types under both module systems, both entries loading under require
# and import with no DOM around, no runtime dependency, the bundle budget,
# the licence files, nothing of the tests or of a real tenant in the
# tarball, and npm's own dry run.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

npm run build
npx publint --strict
npx attw --pack . --profile node16

for entry in "" /theme; do
  node -e "require('@cauthyhq/js$entry')"
  node --input-type=module -e "await import('@cauthyhq/js$entry')"
done

node -e "const p=require('./package.json'); const d=Object.keys(p.dependencies??{}); if (d.length) { console.error('runtime dependencies are not allowed: '+d.join(', ')); process.exit(1) }"

node scripts/check-size.mjs
# The whole route table is for tests and tooling; the bundle ships only ROUTES.
if grep -l 'ROUTE_DETAILS\|crosssite' dist/*.js dist/*.mjs; then
  echo "the route details reached the bundle" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
npm pack --pack-destination "$tmp" >/dev/null
tar -xzf "$tmp"/cauthyhq-js-*.tgz -C "$tmp"
if find "$tmp/package" \( -name '*.test.*' -o -path '*generated*' -o -name 'gen-routes*' -o -name 'compat*' \) | grep -q .; then
  echo "the tarball carries sources or tests" >&2
  exit 1
fi
for f in LICENSE NOTICE; do
  [ -f "$tmp/package/$f" ] || { echo "the tarball lacks $f" >&2; exit 1; }
done
sh "$root/scripts/check-fixtures.sh" "$tmp/package"
npm publish --dry-run
echo "package: ready to publish"
