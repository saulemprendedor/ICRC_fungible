# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Every owner method refuses the anonymous caller** (`src/Token.mo`, `src/token-mixin.mo`),
  in its body and, in `Token.mo`, in the ingress filter, whatever `owner` holds. `owner` starts as
  whoever installed the ledger, so a ledger installed by the anonymous principal had an anonymous
  owner, and then any anonymous caller could call `mint`, rewrite the ledger info, set the index
  and the fee collector, and administer the archives. One predicate, `isOwner`, now guards `mint`,
  `admin_update_icrc1/2/4`, `admin_set_index_canister`, `set_icrc106_index_principal`,
  `icrc107_set_fee_collector` (still `#Err(#AccessDenied)`), `upgradeArchive`,
  `update_archive_controllers` and `getUpgradeError`. Nothing changes for a caller that is not
  anonymous.
- A new archive never gets an anonymous owner as a controller (`src/Token.mo`): the archive hook
  contributes nothing when `owner` is the anonymous principal. Before, every archive such a ledger
  created could be administered by anyone through the management canister.
- **This does not make a ledger installed by the anonymous principal safe.** Such a ledger still
  has the anonymous principal as a controller (anyone can reinstall or delete it) and as its
  default minting account (anyone can mint with `icrc1_transfer` or `icrc4_transfer_batch` from
  it). Install with an authenticated identity and read `get_owner` and `icrc1_minting_account`
  before relying on a ledger.
- `admin_init` admits the owner or a controller that is not the anonymous principal. In
  `src/token-mixin.mo` it admitted every caller; it now has the same guard as `Token.mo`, which is
  a change for an authenticated stranger calling it (it only marks the ledger initialised).

### Added

- **A one-way supply lock** (`src/Token.mo`, `src/token-mixin.mo`). `admin_lock_supply()`, by the
  owner and never by the anonymous principal, sets a flag that no method clears. A second call
  changes nothing. From then on:
  - `mint` traps for every caller, the owner included (`"Supply is locked: mint is disabled"`).
  - `admin_update_icrc1` traps, and applies **nothing**, when its batch carries any
    `MintingAccount` or `MaxSupply` request, whatever its value (lowering the cap and re-setting
    the current minting account included). The whole batch is refused because a partial apply
    would answer a vector of `Bool`s that reads like success. Every other setting (name, symbol,
    logo, fee, metadata, memo bound, fee collector and the rest) stays editable.
- New query `is_supply_locked()`, open to anyone.
- `inspect` in `Token.mo` mirrors the lock, as a cycles optimisation: a mint, or a batch that
  touches either setting, is refused at ingress once locked; `admin_lock_supply` is admitted for
  the owner only. The mixin has no ingress filter; its method bodies refuse.
- New stable field `supplyLocked : Bool`, initialised to `false`. Upgrading is a plain upgrade and
  the ledger starts unlocked. Going BACK to a release without the field is refused by the Motoko
  runtime (enhanced orthogonal persistence traps in `post_upgrade` when a stable field disappears):
  measured on a local replica, the ledger stays on the new wasm and stays locked.

### What the supply lock does not do

- **It is irreversible in this code only.** A controller can upgrade the canister to a wasm that
  keeps the field and ignores it (or clears it), or reinstall it, and the lock is gone. It is as
  strong as the keys of the canister's controllers.
- **It freezes what can be minted, not how it is displayed.** `Decimals` and `Metadata` stay
  editable: a change of decimals redenominates every balance in wallets and explorers, and a
  metadata key can claim any figure. Neither moves a balance.
- **It does not close the ICRC transfer paths.** If the minting account is an account somebody can
  sign for, an `icrc1_transfer`, an `icrc2_transfer_from` (after that account's approval) or an
  `icrc4_transfer_batch` from it is still recorded as a mint after the lock. Set the minting
  account to the ledger's own principal before locking, so that nobody can sign for it; the lock
  then keeps it there. The library does not check this: a deployer must.
- `src/snstest.mo`, `src/examples/*` and the `pic/TokenWithICRC85.mo` fixture have no lock.

### Fixed

- **`upgradeArchive` no longer fails in silence** (`src/Token.mo`). It dropped the per-archive
  results, marked the upgrade complete even when every archive failed, and `getUpgradeError`
  answered `""`. A ledger that ran it on an earlier build keeps that completion across the
  upgrade: run `upgradeArchive(true)` once after upgrading and read every entry.

### Known issues

- `icrc2-mo` 0.2.1 credits a mint from `icrc2_transfer_from` (`from` = the minting account)
  without checking `max_supply`: the other mint paths go through `validate_request`, this one does
  not. It needs an approval given by the minting account, so it is closed when the minting account
  is the ledger itself. Not fixed here (upstream package).

### Changed

- **`upgradeArchive` reports each archive** (`src/Token.mo`). It returns
  `vec record { canister_id; result : variant { Ok; Err : text } }`, one entry per archive, where
  it returned `()`; a caller that ignores the reply still decodes it. The upgrade completes only
  when every entry is `Ok`, so after a failure `upgradeArchive(false)` runs again.
  `getUpgradeError` answers the failures of the last run, joined with `"; "`, or `""`. A second
  call while one is running traps `"Upgrade already in progress"`.
- **An install with more than 8 principals in `archiveControllers` traps** (`src/Token.mo`),
  besides the ledger itself. The IC allows 10 controllers per canister and the ledger adds itself
  and the owner. An upgrade is never refused for a list stored before. On such a ledger
  `update_archive_controllers` reports `#Err("… exceeds the IC limit of 10 controllers")` for every
  archive and sends nothing.
- **The owner of the ledger changes in two steps** (`src/Token.mo`, `src/token-mixin.mo`).
  `admin_propose_owner(?Principal)`, by the owner, names a successor; `accept_ownership()`, by
  that principal, completes the hand-off. Nothing moves until the proposed principal accepts, so
  a mistyped principal, or one nobody holds the key of, cannot take the administration with it.
  `null` cancels a proposal and a new proposal replaces the pending one. The anonymous principal
  and the current owner are refused as proposals, and the anonymous caller is refused by both
  methods.
- New queries `get_owner` and `get_pending_owner`.
- New stable field `pending_owner : ?Principal`. Upgrading is a plain upgrade. Going BACK to a
  build without the field is not: the compiler refuses to drop it (M0169).
- In `src/Token.mo` the ingress filter admits `accept_ownership` for the pending principal
  alone, and for nobody while nothing is pending.

### What the hand-off does not do

- A proposal does not expire. A principal proposed long ago can accept at any later time,
  until the owner cancels or replaces the proposal.
- It does not move the archives that exist: the former owner stays among their controllers
  until the new owner runs `update_archive_controllers`.
- It does not move the minting account, which is set at install and changed with
  `admin_update_icrc1`.
- It does not repair a ledger whose owner is ALREADY the anonymous principal, which the
  one-step method allowed, and which an install by the anonymous principal still produces. Every
  owner method refuses the anonymous caller (see Security), and `admin_propose_owner` refuses it,
  so the ownership cannot be moved by a call: a controller has to fix it with a reinstall. Read
  `get_owner` before relying on this release.

### Examples moved to the two-step hand-off

- `src/snstest.mo`, `src/examples/Lotto.mo`, `src/examples/Allowlist.mo`,
  `src/examples/LottoInterface.mo`, `src/examples/AllowlistInterface.mo` and the test fixture
  `pic/TokenWithICRC85.mo` now carry `admin_propose_owner(?Principal)`, `accept_ownership()`,
  `get_owner` and `get_pending_owner`, with the rules of `src/Token.mo`. Their one-step
  `admin_update_owner` is removed: **breaking** for a caller of that method.
- Their owner methods go through the same `isOwner` predicate, so they refuse the anonymous
  caller whatever `owner` holds. None of them has an ingress filter: the method bodies refuse.
- `LottoInterface.mo` and `AllowlistInterface.mo` compared the caller with the class argument
  `_owner` and kept no owner of their own, and their `admin_update_owner` answered `true` without
  changing anything. They now persist `owner`, set at install.
- New stable field `pending_owner : ?Principal` in all six, and `owner : Principal` in the two
  `*Interface.mo` examples. Upgrading is a plain upgrade.
- Not changed: in `AllowlistInterface.mo` the allowlist is still seeded from `_owner`, and a
  hand-off does not edit the allowlist. `LottoInterface.mo` has no owner method besides the
  hand-off. None of these actors has the supply lock.
- `pic/build-token-wasm.sh` builds the examples and `src/snstest.mo` too, for
  `pic/examples_handoff.test.ts`.
- The committed declarations of the fixture (`src/declarations/token_icrc85/*`) were edited for
  these methods only.

### Removed

- **`admin_update_owner`** from `src/Token.mo` and `src/token-mixin.mo`. It handed the ledger
  over in one call and accepted any principal, the anonymous one included. **Breaking** for a
  caller of that method: use the two steps above.

### Known follow-up

- The committed declarations (`src/declarations/token/*`, `test/devefi_patches/motoko_ledger.idl.*`)
  were edited for the methods of this change only. They already differed from what the compiler
  emits for `src/Token.mo` (`get_health` is missing, `icrc21_canister_call_consent_message` is
  not marked as a query, the `icrc3` init section is not optional).

## [0.2.1] - 2026-03-14

### Updates

- Updated to core 2.1.0
- Update to moc 1.3.0

## [0.2.0] - 2026-02-24

### Added

#### Token Architecture
- **Mixin-based token** (`token-mixin.mo`): Ultra-compact ~150-line token using `include` directives for ICRC-1, ICRC-2, ICRC-3, ICRC-4, and TimerTool mixins — all ICRC endpoints auto-generated
- **Shared Inspect module** (`Inspect.mo`): Reusable argument validation for cycle drain protection with configurable limits (`Config` type), guard functions for inter-canister calls, and compound validators (account, memo, subaccount, Nat, Int, Blob, Text, array length, raw arg size)

#### Cycle Drain Protection
- Complete `system func inspect()` implementation in Token.mo covering all 40+ endpoints
- Raw arg size check first (cheapest operation) before expensive Candid decoding
- Per-standard validation: ICRC-1 (`inspectTransfer`, `inspectBalanceOf`), ICRC-2 (`inspectApprove`, `inspectTransferFrom`, `inspectAllowance`, `inspectGetAllowances`), ICRC-3 (`inspectGetBlocks`, `inspectGetArchives`, `inspectLegacyBlocks`), ICRC-4 (`inspectTransferBatch`, `inspectBalanceOfBatch`)
- Mint/burn argument validation using `isValidAccount`, `isValidNat`, `isValidMemo`

#### New Standard Support
- **ICRC-106** (Index Principal): `icrc106_get_index_principal()`, `set_icrc106_index_principal()` with owner authorization
- **ICRC-107** (Fee Collector Management): `icrc107_set_fee_collector()`, `icrc107_get_fee_collector()` with owner authorization and block type `107feecol`
- **ICRC-21** (Consent Messages): `icrc21_canister_call_consent_message()` with pluggable consent builders for `icrc1_transfer`, `icrc107_set_fee_collector`, `icrc2_approve`, `icrc2_transfer_from`, `icrc4_transfer_batch`
- **ICRC-10**: `icrc10_supported_standards()` aliasing ICRC-1 standards list
- **ICRC-85** (Open Value Sharing): Timer auto-initialization via ClassPlus pattern — no manual `init_icrc85_timer` call needed
- **ICRC-103**: Allowance query endpoint `icrc103_get_allowances()` with configurable `icrc103_max_take_value` and `icrc103_public_allowances`
- **ICRC-130**: Alias for allowance discovery (via ICRC-2 library)

#### Index Push Notifications
- Timer-based push notification system: token proactively notifies index canister when new blocks are added with out spamming it
- `admin_set_index_canister()` / `get_index_canister()` for configuring the index target
- Batched notification with 2-second delay to coalesce multiple blocks
- Best-effort messaging with 60-second timeout and error recovery

#### Rosetta & SNS Compatibility
- `get_data_certificate()` — legacy alias for `icrc3_get_tip_certificate` matching SNS ledger interface
- `is_ledger_ready()` — SNS parity readiness check
- `get_blocks()` — Rosetta-compatible block retrieval with archive callbacks
- `get_transactions()` — Legacy transaction retrieval format
- `archives()` — Legacy archive info endpoint with `block_range_start`/`block_range_end`
- `get_tip()` — Legacy ICRC-3 tip endpoint
- SNS token actor (`snstest.mo`) matching SNS ledger argument format for devefi integration

#### Testing
- **8 new PocketIC test suites** for ICRC_fungible:
  - `icrc106.test.ts` — Index principal management
  - `icrc107.test.ts` — Fee collector get/set
  - `icrc107_lifecycle.test.ts` — End-to-end fee collector changes with real transfers
  - `icrc21.test.ts` — Consent message generation for all supported methods
  - `icrc85.test.ts` — ICRC-85 cycle sharing functionality
  - `index_push.test.ts` — Push notification system with mock index canister
  - `inspect.test.ts` — `system func inspect()` validation for oversized arguments
  - `verify_token_timer.test.ts` — ICRC-85 timer auto-initialization via ClassPlus
- **Comprehensive test runner** (`runners/run_all_tests.sh`, 860 lines):
  - Runs ICRC-1, ICRC-2, ICRC-3, ICRC-4 library mops + PocketIC tests
  - ICRC_fungible mops + PocketIC tests
  - DFINITY official ICRC-1/2 test suite against both `token` and `token-mixin`
  - Devefi integration tests against both `token` and `token-mixin`
  - Rosetta integration tests (including fee collector and archive scenarios)
  - Index-NG and index.mo integration tests against both token variants
  - `--skip-*` and `--only-*` flags for selective test execution
- Integration test scripts for Index-NG (`test_index_ng.sh`), index.mo (`test_index_mo.sh`), Rosetta (`test_rosetta.sh`, `test_rosetta_archive.sh`, `test_rosetta_feecol.sh`)

### Changed

#### Core Migration
- Migrated from `mo:base` to `mo:core` throughout all source files (Token.mo, token-mixin.mo, snstest.mo, Inspect.mo, examples)
- Uses `mo:core/List` instead of `mo:vector` / `mo:base/List`
- Uses `mo:core/Map` and `mo:core/Set` via library re-exports (`ICRC2.CoreMap`, `ICRC2.CoreSet`)
- `persistent actor class` syntax (Motoko 1.1.0+ Enhanced Orthogonal Persistence)
- `transient` annotations on init-time-only bindings
- `Runtime.trap` replaces `D.trap`

#### Dependency Updates
- `icrc1-mo` 0.2.0 — mixin, inspect, ICRC-106/107/21/10/85, mo:core migration
- `icrc2-mo` 0.2.0 — mixin, inspect, ICRC-103/130, cleanup options, mo:core migration
- `icrc3-mo` 0.4.0 — mixin, inspect, query archives, LEB128 certificates, mo:core migration
- `icrc4-mo` 0.2.0 — mixin, inspect, ICRC-21 consent, mo:core migration
- `class-plus` 0.2.0 — ClassPlus initialization manager
- `timer-tool` 0.2.0 — TimerTool with mixin support
- `ic-certification` 1.1.0
- `star` 0.1.1
- `core` 2.0.0
- Toolchain: `moc = "1.1.0"`, `pocket-ic = "12.0.0"`

#### Code Quality
- Removed redundant `stable` keywords on persistent actor fields
- Removed unguarded debug statements from production code
- Fixed unused identifier warnings across Token.mo, snstest.mo, examples
- Fixed ClassPlus system capability (added `<system>` type parameter)

### Fixed

- ICRC-2 `InitArgs` updated with required fields: `cleanup_interval`, `cleanup_on_zero_balance`, `icrc103_max_take_value`, `icrc103_public_allowances`

### Library Changes (upstream)

These changes are in the underlying libraries consumed by this project:

- **icrc1-mo 0.2.0**: Added mixin, inspect module, ICRC-107/106/21/10/85 support, mo:core migration
- **icrc2-mo 0.2.0**: Added mixin, inspect module, ICRC-103/130, cleanup timers, fixed double fee collection bug, fixed ICRC-103 access control, fixed index iterator, mo:core migration
- **icrc3-mo 0.4.0**: Added mixin, inspect module, query archives, fixed certificate LEB128 encoding, mo:core migration
- **icrc4-mo 0.2.0**: Added mixin, inspect module, ICRC-21 consent, batch size guards, mo:core migration

## [0.0.7] - 2025-03-01

### Changed

- Updated dependencies, compiler, and dfx

## [0.0.6] - 2025-01-15

### Added

- Implemented ICRC-3 with legacy `get_transactions` backfill
- ICRC-103 endpoint for retrieving allowances
- ICRC-106 endpoint for retrieving index canister
- SNS token actor (`snstest.mo`) matching SNS initialization interface for devefi integration

### Technical Details

- Uses ClassPlus initialization pattern for ICRC-3
- Supports Rosetta-compatible transaction queries via legacy endpoints