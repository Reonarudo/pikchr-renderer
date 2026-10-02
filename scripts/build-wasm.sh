#!/usr/bin/env bash
# Regenerate vendor/pikchr/ from a pikchr.org check-in (ADR 0006).
#
#   scripts/build-wasm.sh <checkin>
#
# Needs fossil, make, a host C compiler and emcc 6.0.9 on PATH. Runs locally only; CI verifies
# the committed files against SHA256SUMS and never runs emcc.
set -euo pipefail

checkin=${1:?usage: scripts/build-wasm.sh <checkin>}
emcc_version=6.0.9

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/vendor/pikchr"

if ! emcc --version | head -1 | grep -q " $emcc_version"; then
  echo "emcc $emcc_version is required, found: $(emcc --version | head -1)" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fossil clone https://pikchr.org/home "$work/pikchr.fossil" >&2
mkdir "$work/src"
(
  cd "$work/src"
  fossil open --force "$work/pikchr.fossil" "$checkin" >&2
  make pikchr.c >&2
)
hash=$(cd "$work/src" && fossil info "$checkin" | awk '$1 == "hash:" { print $2 }')
date=$(cd "$work/src" && fossil info "$checkin" | awk '$1 == "hash:" { print $3 "T" $4 "Z" }')

mkdir -p "$out"
cp "$work/src/pikchr.c" "$out/pikchr.c"

# The source is copied into wasm memory with malloc and the result freed after reading, so the
# fixed heap does not leak across renders and a 64000-character source never touches the stack.
emcc -Os "$out/pikchr.c" -o "$out/pikchr.cjs" \
  -sSINGLE_FILE=1 \
  -sMODULARIZE=1 \
  -sENVIRONMENT=node \
  -sEXPORTED_FUNCTIONS='["_pikchr","_pikchr_version","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' \
  -sMALLOC=emmalloc \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=16MB \
  -sSTRICT=1

cat > "$out/provenance.json" <<EOF
{
  "source": "https://pikchr.org/home",
  "checkin": "$hash",
  "date": "$date",
  "generated": "pikchr.c by make pikchr.c",
  "compiler": "emcc $emcc_version",
  "script": "scripts/build-wasm.sh"
}
EOF

(cd "$out" && shasum -a 256 pikchr.c pikchr.cjs provenance.json > SHA256SUMS)
echo "vendor/pikchr rebuilt from $hash ($date)" >&2
