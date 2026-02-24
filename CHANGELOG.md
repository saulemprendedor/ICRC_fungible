# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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