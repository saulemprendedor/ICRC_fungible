#!/usr/bin/env bash
#
# Build the ledger as it was at an earlier commit, for the tests that upgrade
# it in place to the current build:
#   token_baseline  (5fb6104) BEFORE ICRC-85 was switched off: a ledger, and its
#                   archives, that shared cycles (pic/icrc85_off.test.ts)
#   token_one_step  (bb166f8) BEFORE the two-step owner hand-off
#                   (pic/owner_handoff.test.ts)
#   token_pre_lock, token_mixin_pre_lock  (f3d042e) BEFORE the supply lock
#                   (pic/supply_lock.test.ts)
#   token_pre_limit (f3d042e) BEFORE the archive controller limit was
#                   checked at install (pic/archive_upgrade_results.test.ts)
#
# It checks out the ref into a throwaway git worktree, resolves that tree's
# own dependencies, compiles its src/Token.mo (or [main]) with the same flags as
# build-token-wasm.sh, and writes
#   .dfx/local/canisters/<name>/<name>.wasm.gz
# The throwaway worktree is removed on exit.
#
# Usage: bash pic/build-baseline-wasm.sh [ref] [name] [main]
#        (defaults: BASELINE_REF below, token_baseline)
# pic/build-token-wasm.sh runs it for each of those targets.
set -euo pipefail

# The library's main before the ICRC-85 switches landed.
BASELINE_REF="${1:-5fb6104}"
NAME="${2:-token_baseline}"
MAIN="${3:-src/Token.mo}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$TMP/src" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

if ! git cat-file -e "$BASELINE_REF^{commit}" 2>/dev/null; then
  echo "baseline $BASELINE_REF is not in this clone's history (shallow clone?): git fetch --unshallow, or pass a ref" >&2
  exit 1
fi
git worktree add --detach "$TMP/src" "$BASELINE_REF" >/dev/null
(
  cd "$TMP/src"
  mops install >/dev/null
  MOC="$(mops toolchain bin moc)"
  SOURCES="$(mops sources | tr '\n' ' ')"
  echo "baseline $BASELINE_REF ($(git rev-parse --short HEAD)), moc $("$MOC" --version)"
  # shellcheck disable=SC2086
  "$MOC" $SOURCES -v --incremental-gc -o "$TMP/$NAME.wasm" "$MAIN" >/dev/null
)

out_dir=".dfx/local/canisters/$NAME"
mkdir -p "$out_dir"
gzip -9 -c "$TMP/$NAME.wasm" > "$out_dir/$NAME.wasm.gz"
ls -la "$out_dir/$NAME.wasm.gz"
