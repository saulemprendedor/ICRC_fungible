#!/usr/bin/env bash
#
# Build the ledger as it was BEFORE ICRC-85 was switched off, for the upgrade
# tests of pic/icrc85_off.test.ts: a ledger (and its archives) that shared
# cycles, upgraded in place to the current build.
#
# It checks out BASELINE_REF into a throwaway git worktree, resolves that tree's
# own dependencies, compiles its src/Token.mo with the same flags as
# build-token-wasm.sh, and writes
#   .dfx/local/canisters/token_baseline/token_baseline.wasm.gz
# The throwaway worktree is removed on exit.
#
# Usage: bash pic/build-baseline-wasm.sh [ref]    (default: BASELINE_REF below)
set -euo pipefail

# The library's main before the ICRC-85 switches landed.
BASELINE_REF="${1:-5fb6104}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$TMP/src" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git worktree add --detach "$TMP/src" "$BASELINE_REF" >/dev/null
(
  cd "$TMP/src"
  mops install >/dev/null
  MOC="$(mops toolchain bin moc)"
  SOURCES="$(mops sources | tr '\n' ' ')"
  echo "baseline $BASELINE_REF ($(git rev-parse --short HEAD)), moc $("$MOC" --version)"
  # shellcheck disable=SC2086
  "$MOC" $SOURCES -v --incremental-gc -o "$TMP/token_baseline.wasm" src/Token.mo >/dev/null
)

out_dir=".dfx/local/canisters/token_baseline"
mkdir -p "$out_dir"
gzip -9 -c "$TMP/token_baseline.wasm" > "$out_dir/token_baseline.wasm.gz"
ls -la "$out_dir/token_baseline.wasm.gz"
