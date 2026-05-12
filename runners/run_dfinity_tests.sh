#!/bin/bash
#
# Run Official DFINITY ICRC-1/2 Tests
#
# Deploys token canister and runs the official DFINITY test suite
# to verify ICRC-1 and ICRC-2 compliance.
#
# Prerequisites:
#   - Rust/Cargo installed (https://rustup.rs)
#   - icp-cli installed
#   - Internet connection to clone DFINITY repo (first run)
#
# Usage:
#   ./runners/run_dfinity_tests.sh [--canister token|token-mixin]
#

set -e

# Parse arguments
CANISTER_NAME="token"
while [[ $# -gt 0 ]]; do
    case $1 in
        --canister)
            CANISTER_NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--canister token|token-mixin]"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_DIR="$PROJECT_DIR/.dfinity-tests"

echo "==================================="
echo "DFINITY ICRC-1/2 Official Test Suite"
echo "Testing: $CANISTER_NAME"
echo "==================================="
echo ""

# Check prerequisites
if ! command -v cargo &> /dev/null; then
    echo "ERROR: Rust/Cargo not found. Install from https://rustup.rs"
    exit 1
fi

if ! command -v icp &> /dev/null; then
    echo "ERROR: icp-cli not found. Install from https://cli.internetcomputer.org"
    exit 1
fi

# Clone or update DFINITY test repo
if [ ! -d "$TEST_DIR" ]; then
    echo "Cloning DFINITY ICRC-1 test suite..."
    git clone --depth 1 https://github.com/dfinity/ICRC-1.git "$TEST_DIR"
else
    echo "Updating DFINITY ICRC-1 test suite..."
    cd "$TEST_DIR" && git pull --ff-only || true
fi

cd "$PROJECT_DIR"

# Create Ed25519 identity for the test runner (ic-agent only supports Ed25519)
echo ""
echo "Setting up Ed25519 test identity..."
IDENTITY_PEM="$TEST_DIR/test_identity_ed25519.pem"
cat > "$IDENTITY_PEM" << 'PEMEOF'
-----BEGIN PRIVATE KEY-----
MFMCAQEwBQYDK2VwBCIEIJKDIfd1Ybt48Z23cVEbjL2DGj1P5iDYmthcrptvBO3z
oSMDIQCJuBJPWt2WWxv0zQmXcXMjY+fP0CJSsB80ztXpOFd2ZQ==
-----END PRIVATE KEY-----
PEMEOF

# Principal corresponding to this Ed25519 key
ED25519_PRINCIPAL="k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae"

echo "Test Principal: $ED25519_PRINCIPAL"

# Use icrc_deployer identity for deployment (as minter)
icp identity new icrc_deployer --storage plaintext || true
icp identity default icrc_deployer
MINTER_PRINCIPAL=$(icp identity principal)
echo "Minter Principal: $MINTER_PRINCIPAL"

# Check if replica is running
if ! icp network status &> /dev/null; then
    echo ""
    echo "Starting local icp replica..."
    icp network start -d
    sleep 5
fi

# Build and deploy the canister
echo ""
echo "Building $CANISTER_NAME canister..."
icp build "$CANISTER_NAME"

echo "Deploying $CANISTER_NAME canister..."
WASM_PATH="$PROJECT_DIR/.icp/cache/artifacts/$CANISTER_NAME"

icp canister install "$CANISTER_NAME" --wasm "$WASM_PATH" -m reinstall \
  --args "(opt record {
  icrc1 = opt record {
    name = opt \"DFINITY Test Token\";
    symbol = opt \"DTT\";
    logo = null;
    decimals = 8;
    fee = opt variant { Fixed = 10000 };
    minting_account = opt record {
      owner = principal \"$MINTER_PRINCIPAL\";
      subaccount = null;
    };
    max_supply = null;
    min_burn_amount = opt 10000;
    max_memo = opt 64;
    advanced_settings = null;
    metadata = null;
    fee_collector = null;
    transaction_window = null;
    permitted_drift = null;
    max_accounts = opt 100000000;
    settle_to_accounts = opt 99999000;
  };
  icrc2 = opt record {
    max_approvals_per_account = opt 10000;
    max_allowance = opt variant { TotalSupply = null };
    fee = opt variant { ICRC1 = null };
    advanced_settings = null;
    max_approvals = opt 10000000;
    settle_to_approvals = opt 9990000;
  };
  icrc3 = record {
    maxActiveRecords = 3000;
    settleToRecords = 2000;
    maxRecordsInArchiveInstance = 100000000;
    maxArchivePages = 62500;
    archiveIndexType = variant { Stable = null };
    maxRecordsToArchive = 8000;
    archiveCycles = 20_000_000_000_000;
    supportedBlocks = vec {};
    archiveControllers = null;
  };
  icrc4 = opt record {
    max_balances = opt 200;
    max_transfers = opt 200;
    fee = opt variant { ICRC1 = null };
  };
})" --args-format candid -y

CANISTER_ID=$(icp canister status "$CANISTER_NAME" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "$CANISTER_NAME Canister ID: $CANISTER_ID"

# Initialize the token
echo ""
echo "Initializing $CANISTER_NAME..."
icp canister call "$CANISTER_NAME" admin_init "()"

# Mint tokens to the Ed25519 test identity
echo ""
echo "Minting tokens to Ed25519 test identity..."
icp canister call "$CANISTER_NAME" icrc1_transfer "(record {
  to = record {
    owner = principal \"$ED25519_PRINCIPAL\";
    subaccount = null;
  };
  amount = 100_000_000_000;
  fee = null;
  memo = null;
  from_subaccount = null;
  created_at_time = null;
})"

# Verify balance
echo ""
echo "Verifying balance..."
icp canister call "$CANISTER_NAME" icrc1_balance_of "(record {
  owner = principal \"$ED25519_PRINCIPAL\";
  subaccount = null;
})" --query

# Replica URL — ICRC_fungible network runs on port 8887 (set in icp.yaml gateway.port)
REPLICA_URL="http://localhost:${ICP_PORT:-8887}"

echo ""
echo "==================================="
echo "Running Official DFINITY Tests"
echo "==================================="
echo ""
echo "Canister ID: $CANISTER_ID"
echo "Replica URL: $REPLICA_URL"
echo "Identity:    $IDENTITY_PEM"
echo ""

# Run the test suite
cd "$TEST_DIR"

echo "Building and running test suite..."
echo "(This may take a few minutes on first run to compile)"
echo ""

cargo run --bin runner -- \
    -u "$REPLICA_URL" \
    -c "$CANISTER_ID" \
    -s "$IDENTITY_PEM"

TEST_RESULT=$?

echo ""
echo "==================================="
if [ $TEST_RESULT -eq 0 ]; then
    echo "✅ ALL DFINITY TESTS PASSED"
else
    echo "❌ SOME TESTS FAILED (exit code: $TEST_RESULT)"
fi
echo "==================================="

exit $TEST_RESULT
