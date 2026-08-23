#!/usr/bin/env bash
#
# Build the wasms the pic/*.test.ts suite loads from .dfx/local/canisters/,
# WITHOUT a replica.
#
# `dfx build <canister>` refuses to run until the canister has an id, which
# means a running replica. This script goes straight to the pinned moc with the
# sources mops resolves — so whatever `mops sources` points at (including the
# local fork in vendor/) is what actually gets compiled — and gzips the result
# into the paths the tests expect.
#
# Usage: bash pic/build-token-wasm.sh [canister ...]     (default: all four)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# name:main — must match dfx.json
ALL=(
  "token:src/Token.mo"
  "token-mixin:src/token-mixin.mo"
  "token_icrc85:pic/TokenWithICRC85.mo"
  "dummy_collector:pic/DummyCollector.mo"
)

MOC="$(mops toolchain bin moc)"
echo "moc: $MOC ($("$MOC" --version))"
echo "icrc1-mo source: $(mops sources | grep '^--package icrc1-mo ' || echo 'NOT RESOLVED')"
SOURCES="$(mops sources | tr '\n' ' ')"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  for entry in "${ALL[@]}"; do targets+=("${entry%%:*}"); done
fi

for name in "${targets[@]}"; do
  main=""
  for entry in "${ALL[@]}"; do
    [ "${entry%%:*}" = "$name" ] && main="${entry#*:}"
  done
  if [ -z "$main" ]; then
    echo "unknown canister: $name" >&2
    exit 1
  fi

  out_dir=".dfx/local/canisters/$name"
  mkdir -p "$out_dir"
  echo "building $name from $main"
  # Same flags as dfx.json.
  # shellcheck disable=SC2086
  "$MOC" $SOURCES -v --incremental-gc -o "$out_dir/$name.wasm" "$main" >/dev/null
  gzip -9 -f "$out_dir/$name.wasm"
  ls -la "$out_dir/$name.wasm.gz"
done
