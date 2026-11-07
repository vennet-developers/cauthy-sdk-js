#!/bin/sh
# src/generated must be exactly what scripts/gen-routes.mjs writes
# from the spec commit spec.lock pins. SPEC_DIR names a checkout of
# cauthy-sdk-spec at that commit; without it, the commit is fetched.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
ref=$(tr -d ' \n' < spec.lock)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
spec=${SPEC_DIR:-}
if [ -z "$spec" ]; then
  spec=$tmp/spec
  git init -q "$spec"
  git -C "$spec" fetch -q --depth 1 https://github.com/vennet-developers/cauthy-sdk-spec.git "$ref"
  git -C "$spec" checkout -q FETCH_HEAD
else
  have=$(git -C "$spec" rev-parse HEAD)
  [ "$have" = "$ref" ] || { echo "SPEC_DIR is at $have; spec.lock pins $ref" >&2; exit 2; }
  git -C "$spec" diff --quiet HEAD || { echo "SPEC_DIR has uncommitted changes; check against a clean checkout" >&2; exit 2; }
fi
SPEC_DIR="$spec" node scripts/gen-routes.mjs "$tmp/generated" >/dev/null
diff -ru src/generated "$tmp/generated" || { echo "src/generated is stale: run SPEC_DIR=<spec checkout> npm run gen:routes" >&2; exit 1; }
echo "routes: current with cauthy-sdk-spec $ref"
