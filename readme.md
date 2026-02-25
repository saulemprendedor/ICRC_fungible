# ICRC-1, ICRC-2, ICRC-3, ICRC-4, ICRC-10, ICRC-21, ICRC-106, ICRC-107 Compatible Fungible Token

## Overview
This project is focused on the development and implementation of a fungible token standard, utilizing blockchain or distributed ledger technology. The core of the project is written in Motoko and is compatibility with the DFINITY Internet Computer platform.

## Contents
- `dfx.json`: Configuration file for project settings and canister definitions.
- `mops.toml`: Dependency management file listing various Motoko libraries and tools.
- `runners/test_deploy.sh`: Script for testing or deploying the token system.
- `runners/prod_deploy.sh`: Script for deploying to production token system.
- `src/Token.mo`: Source code for the token system written in Motoko.
- `src/examples/Allowlist.mo`: Source code for the a token who is limited to an allow list of users who can send tokens, but anyone can receive them. See the source file for more information.
- `src/examples/Lotto.mo`: Source code for a token where whenever you burn tokens you have a chance to double your tokens. See the source file for more information.

## Setup and Installation
1. **Environment Setup**: Ensure you have an environment that supports Motoko programming. This typically involves setting up the [DFINITY Internet Computer SDK](https://internetcomputer.org/docs/current/references/cli-reference/dfx-parent) and [mops tool chain](https://docs.mops.one/quick-start).
2. **Dependency Installation**: Install the dependencies listed in `mops.toml`. `mops install`.
3. **Configuration**: Adjust `dfx.json` and `mops.toml` according to your project's specific needs, such as changing canister settings or updating dependency versions.

## Usage
- **Development**: Modify and enhance `src/Token.mo` as per your requirements. This file contains the logic and structure of the fungible token system.
- **Testing and Deployment**: Use `runners/test_deploy.sh` for deploying the token system to a test or development environment. This script may need modifications to fit your deployment process.
- **Production Deployment**: Use `runners/prod_deploy.sh` for deploying the token system to a main net environment. This script will need modifications to fit your deployment process.

## Dependencies
- DFX and Mops
- Additional dependencies are listed in `mops.toml`. Ensure they are properly installed and configured.

## Contribution and Development Guidelines
- **Coding Standards**: Adhere to established Motoko coding practices. Ensure readability and maintainability of the code.
- **Testing**: Thoroughly test any new features or changes in a controlled environment before integrating them into the main project.
- **Documentation**: Update documentation and comments within the code to reflect changes or additions to the project.

## Testing

### Running devefi_ledger_tests (PocketIC Integration Tests)

The [devefi_ledger_tests](https://github.com/Neutrinomic/devefi_ledger_tests) suite provides comprehensive PocketIC-based integration tests for ICRC ledgers. These tests validate real canister behavior including transfers, burns, mints, transaction windows, and more.

**Setup:**

```bash
# Clone the test repository
git clone https://github.com/Neutrinomic/devefi_ledger_tests.git /tmp/devefi_ledger_tests
cd /tmp/devefi_ledger_tests

# Install dependencies
npm install

# Build the Motoko ledger WASM (from ICRC_fungible directory)
cd /path/to/ICRC_fungible
dfx build token --check
cp .dfx/local/canisters/token/token.wasm /tmp/devefi_ledger_tests/icrc_ledger/motoko_ledger.wasm
```

**Running Tests:**

```bash
cd /tmp/devefi_ledger_tests

# Run all applicable tests
LEDGER=motoko LEDGER_TYPE=icrc npx jest --testPathIgnorePatterns="ntc.spec.ts|fastscan.spec.ts"

# Run specific test file
LEDGER=motoko LEDGER_TYPE=icrc npx jest ledger.spec.ts

# Run with verbose output
LEDGER=motoko LEDGER_TYPE=icrc npx jest --verbose
```

**Test Suites:**

| Test File | Description | Status |
|-----------|-------------|--------|
| `ledger.spec.ts` | Core ledger operations, metadata | ✅ |
| `basic.spec.ts` | Basic transfer scenarios | ✅ |
| `mint.spec.ts` | Minting operations | ✅ |
| `burn.spec.ts` | Burn operations | ✅ |
| `tx_window.spec.ts` | Transaction window/deduplication | ✅ |
| `noise.spec.ts` | Stress testing | ✅ |
| `dust.spec.ts` | Small amount handling | ✅ |
| `on_sent.spec.ts` | Send callbacks | ✅ |
| `passback.spec.ts` | Passback scenarios | ✅ |
| `legacy_address.spec.ts` | Legacy address format | ✅ |
| `ledger_down.spec.ts` | Ledger unavailability handling | ✅ |

**Skipped Tests (Not Applicable):**

| Test File | Reason |
|-----------|--------|
| `ntc.spec.ts` | Tests NTC minter canister (not a ledger test) - requires minter-specific methods like `get_queue`, `get_dropped`, `stats` |
| `fastscan.spec.ts` | Tests DFINITY Rust ledger-specific upgrade/reinstall features with fastscan WASM |

**Expected Results:** 205+ tests passing across 11 test files.

### DFINITY Index-ng Integration

See `/test/integration/` for index-ng canister integration tests that verify block sync and transaction indexing.

## ICRC-85 Open Value Sharing (OVS) Roll-Up

This token deploys multiple components that each participate in [ICRC-85 Open Value Sharing](https://github.com/dfinity/ICRC/issues/85) via the [ovs-fixed](https://mops.one/ovs-fixed) library. Each component independently shares a portion of cycles with infrastructure providers based on its usage. Below is the complete roll-up of OVS namespaces active in a deployed token canister and its archives.

### Ledger Canister

| Component | Namespace | Actions Tracked | Cycle Formula | Period Reset |
|-----------|-----------|-----------------|---------------|--------------|
| **timer-tool** | `org.icdevs.icrc85.supertimer` | Timer actions scheduled | 1 XDR base + 1 XDR per 100K actions, max 100 XDR | Yes (delta since last report) |
| **ICRC-1** | `org.icdevs.icrc85.icrc1` | Successful transfers, mints, burns | 1 XDR base + 100M cycles per action, max 100 XDR | Yes |
| **ICRC-3** | `org.icdevs.icrc85.icrc3` | Ledger records added | 1 XDR base + 100M cycles per action, max 100 XDR | Yes |

### Archive Canisters (per archive instance)

| Component | Namespace | Actions Tracked | Cycle Formula | Period Reset |
|-----------|-----------|-----------------|---------------|--------------|
| **timer-tool** | `org.icdevs.icrc85.supertimer` | Timer actions scheduled | 1 XDR base + 1 XDR per 100K actions, max 100 XDR | Yes (delta since last report) |
| **ICRC-3 Archive** | `org.icdevs.icrc85.icrc3archive` | Records stored (cumulative) | 1 XDR base + 1M cycles per record, max 100 XDR | **No** — storage-based, accumulates |

### Notes

- **1 XDR ≈ 1 trillion cycles** (1,000,000,000,000).
- All OVS payments are capped at 50% of the canister's current cycle balance for safety.
- Each component has a **7-day grace period** before the first share, then shares every **30 days**.
- The ICRC-3 Archive uses `resetAtEndOfPeriod = false` because its value is proportional to total records stored, not throughput.

## Repository
- [Project Repository](https://github.com/icdevsorg/ICRC_fungible)

## License
- MIT License

## Contact
- **Contributing**: For contributing to this project, please submit a pull request to the repository.
