#!/usr/bin/env bash
#
# Comprehensive Test Suite for ICRC_fungible Token
#
# This script runs ALL available tests:
#   1. ICRC1, ICRC2, ICRC3, ICRC4 mops tests (unit tests)
#   2. ICRC1, ICRC2, ICRC3 PocketIC tests
#   3. ICRC-fungible mops tests
#   4. ICRC-fungible PocketIC tests
#   5. DFINITY official ICRC-1/2 test suite (against token and token-mixin)
#   6. Devefi test suite (against token and token-mixin)
#   7. Rosetta integration test (against token and token-mixin)
#   8. DFINITY Index-NG integration test (against token and token-mixin)
#   9. index.mo integration test (against token and token-mixin)
#
# Usage:
#   ./runners/run_all_tests.sh [options]
#
# Options:
#   --skip-mops         Skip mops unit tests
#   --skip-pic          Skip PocketIC tests
#   --skip-dfinity      Skip DFINITY official test suite
#   --skip-devefi       Skip Devefi test suite
#   --skip-rosetta      Skip Rosetta tests
#   --skip-index        Skip Index-NG and index.mo tests
#   --skip-index-mo     Skip index.mo tests only
#   --skip-token-mixin  Skip tests against token-mixin (only run token)
#   --only-token        Same as --skip-token-mixin
#   --only-token-mixin  Only run tests against token-mixin
#   --port PORT         Set DFX replica port (default: $DFX_PORT or 8887)
#   --verbose           Show full test output
#   --help              Show this help
#

set -e

# ICP replica port - configured in icp.yaml (gateway.port: 8887)
# Pass --port to override in test scripts that need it
ICP_PORT="${ICP_PORT:-8887}"
export ICP_PORT
# Keep DFX_PORT for pocket-ic test compatibility
DFX_PORT="${ICP_PORT}"
export DFX_PORT

# Check bash version for associative array support
if ((BASH_VERSINFO[0] < 4)); then
    echo "Warning: Bash 4+ recommended. Using fallback for test tracking."
    USE_SIMPLE_TRACKING=true
else
    USE_SIMPLE_TRACKING=false
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="$(dirname "$PROJECT_DIR")"

# Component library paths
ICRC1_DIR="$WORKSPACE_DIR/ICRC1.mo"
ICRC2_DIR="$WORKSPACE_DIR/ICRC2.mo"
ICRC3_DIR="$WORKSPACE_DIR/icrc3.mo"
ICRC4_DIR="$WORKSPACE_DIR/ICRC4.mo"
DEVEFI_TEST_DIR="/tmp/devefi_ledger_tests"

# Test results tracking - use simple arrays for bash 3 compatibility
TEST_NAMES=()
TEST_STATUSES=()
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0

# Options
SKIP_MOPS=false
SKIP_PIC=false
SKIP_DFINITY=false
SKIP_DEVEFI=false
SKIP_ROSETTA=false
SKIP_INDEX=false
SKIP_INDEX_MO=false
SKIP_TOKEN_MIXIN=false
ONLY_TOKEN_MIXIN=false
CLEAN_DEVEFI=false
VERBOSE=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-mops)
            SKIP_MOPS=true
            shift
            ;;
        --skip-pic)
            SKIP_PIC=true
            shift
            ;;
        --skip-dfinity)
            SKIP_DFINITY=true
            shift
            ;;
        --skip-devefi)
            SKIP_DEVEFI=true
            shift
            ;;
        --skip-rosetta)
            SKIP_ROSETTA=true
            shift
            ;;
        --skip-index)
            SKIP_INDEX=true
            shift
            ;;
        --skip-index-mo)
            SKIP_INDEX_MO=true
            shift
            ;;
        --skip-token-mixin|--only-token)
            SKIP_TOKEN_MIXIN=true
            shift
            ;;
        --only-token-mixin)
            ONLY_TOKEN_MIXIN=true
            shift
            ;;
        --clean-devefi)
            CLEAN_DEVEFI=true
            shift
            ;;
        --port)
            ICP_PORT="$2"
            DFX_PORT="$2"
            export ICP_PORT DFX_PORT
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Comprehensive Test Suite for ICRC_fungible Token"
            echo ""
            echo "Usage: ./runners/run_all_tests.sh [options]"
            echo ""
            echo "Options:"
            echo "  --skip-mops         Skip mops unit tests"
            echo "  --skip-pic          Skip PocketIC tests"
            echo "  --skip-dfinity      Skip DFINITY official test suite"
            echo "  --skip-devefi       Skip Devefi test suite"
            echo "  --skip-rosetta      Skip Rosetta tests"
            echo "  --skip-index        Skip Index-NG and index.mo tests"
            echo "  --skip-index-mo     Skip index.mo tests only"
            echo "  --skip-token-mixin  Skip tests against token-mixin"
            echo "  --only-token        Same as --skip-token-mixin"
            echo "  --only-token-mixin  Only run tests against token-mixin"
            echo "  --clean-devefi      Fresh clone of devefi_ledger_tests"
            echo "  --port PORT         Set DFX replica port (default: \$DFX_PORT or 8887)"
            echo "  --verbose           Show full test output"
            echo "  --help              Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Logging functions
log_section() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} $1"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
}

log_subsection() {
    echo ""
    echo -e "${YELLOW}▶ $1${NC}"
}

log_pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    TEST_NAMES+=("$1")
    TEST_STATUSES+=("PASS")
    ((TOTAL_PASSED++)) || true
}

log_fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    TEST_NAMES+=("$1")
    TEST_STATUSES+=("FAIL")
    ((TOTAL_FAILED++)) || true
}

log_skip() {
    echo -e "${YELLOW}○ SKIP:${NC} $1"
    TEST_NAMES+=("$1")
    TEST_STATUSES+=("SKIP")
    ((TOTAL_SKIPPED++)) || true
}

# Run a test command and capture result
run_test() {
    local name="$1"
    local dir="$2"
    shift 2
    local cmd="$@"
    
    log_subsection "$name"
    
    cd "$dir"
    
    if $VERBOSE; then
        if eval "$cmd"; then
            log_pass "$name"
            return 0
        else
            log_fail "$name"
            return 1
        fi
    else
        local output
        if output=$(eval "$cmd" 2>&1); then
            log_pass "$name"
            return 0
        else
            log_fail "$name"
            echo "$output" | tail -50
            return 1
        fi
    fi
}

# Check prerequisites
check_prerequisites() {
    log_section "Checking Prerequisites"
    
    local missing=false
    
    if ! command -v mops &> /dev/null; then
        echo "❌ mops not found"
        missing=true
    else
        echo "✓ mops found"
    fi
    
    if ! command -v icp &> /dev/null; then
        echo "❌ icp-cli not found"
        missing=true
    else
        echo "✓ icp-cli found"
    fi
    
    if ! command -v cargo &> /dev/null; then
        echo "⚠ cargo not found (needed for DFINITY tests)"
    else
        echo "✓ cargo found"
    fi
    
    if ! command -v docker &> /dev/null; then
        echo "⚠ docker not found (needed for Rosetta tests)"
    else
        echo "✓ docker found"
    fi
    
    if ! command -v npx &> /dev/null; then
        echo "❌ npx not found"
        missing=true
    else
        echo "✓ npx found"
    fi
    
    if $missing; then
        echo ""
        echo "Please install missing prerequisites before running tests."
        exit 1
    fi
}

# Run mops tests for component libraries
run_mops_tests() {
    log_section "Running Mops Unit Tests"
    
    if $SKIP_MOPS; then
        log_skip "Mops tests (skipped via --skip-mops)"
        return
    fi
    
    # ICRC1.mo mops tests
    if [ -d "$ICRC1_DIR" ]; then
        run_test "ICRC1.mo mops test" "$ICRC1_DIR" "mops test" || true
    else
        log_skip "ICRC1.mo (directory not found)"
    fi
    
    # ICRC2.mo mops tests
    if [ -d "$ICRC2_DIR" ]; then
        run_test "ICRC2.mo mops test" "$ICRC2_DIR" "mops test" || true
    else
        log_skip "ICRC2.mo (directory not found)"
    fi
    
    # icrc3.mo mops tests
    if [ -d "$ICRC3_DIR" ]; then
        run_test "icrc3.mo mops test" "$ICRC3_DIR" "mops test" || true
    else
        log_skip "icrc3.mo (directory not found)"
    fi
    
    # ICRC4.mo mops tests
    if [ -d "$ICRC4_DIR" ]; then
        if find "$ICRC4_DIR/test" -name "*.test.mo" 2>/dev/null | grep -q .; then
            run_test "ICRC4.mo mops test" "$ICRC4_DIR" "mops test" || true
        else
            log_skip "ICRC4.mo mops test (no *.test.mo files found)"
        fi
    else
        log_skip "ICRC4.mo (directory not found)"
    fi
    
    # ICRC_fungible mops tests - uses PocketIC tests instead
    # Check if there are actual *.test.mo files in test/
    if find "$PROJECT_DIR/test" -name "*.test.mo" 2>/dev/null | grep -q .; then
        run_test "ICRC_fungible mops test" "$PROJECT_DIR" "mops test" || true
    else
        log_skip "ICRC_fungible mops test (uses PocketIC tests instead)"
    fi
}

# Run PocketIC tests for component libraries
run_pic_tests() {
    log_section "Running PocketIC Tests"
    
    if $SKIP_PIC; then
        log_skip "PocketIC tests (skipped via --skip-pic)"
        return
    fi
    
    # ICRC1.mo PocketIC tests
    if [ -d "$ICRC1_DIR/pic" ] && [ -f "$ICRC1_DIR/pic/package.json" ]; then
        log_subsection "ICRC1.mo PocketIC tests"
        cd "$ICRC1_DIR/pic"
        npm install --silent 2>/dev/null || true
        run_test "ICRC1.mo PocketIC" "$ICRC1_DIR/pic" "npx vitest run --reporter=basic" || true
    else
        log_skip "ICRC1.mo PocketIC (not configured)"
    fi
    
    # ICRC2.mo PocketIC tests
    if [ -d "$ICRC2_DIR/pic" ] && [ -f "$ICRC2_DIR/pic/package.json" ]; then
        log_subsection "ICRC2.mo PocketIC tests"
        cd "$ICRC2_DIR/pic"
        npm install --silent 2>/dev/null || true
        run_test "ICRC2.mo PocketIC" "$ICRC2_DIR/pic" "npx vitest run --reporter=basic" || true
    else
        log_skip "ICRC2.mo PocketIC (not configured)"
    fi
    
    # icrc3.mo PocketIC tests
    if [ -d "$ICRC3_DIR/pic" ] && [ -f "$ICRC3_DIR/pic/package.json" ]; then
        log_subsection "icrc3.mo PocketIC tests"
        cd "$ICRC3_DIR/pic"
        npm install --silent 2>/dev/null || true
        run_test "icrc3.mo PocketIC" "$ICRC3_DIR/pic" "npx vitest run --reporter=basic" || true
    else
        log_skip "icrc3.mo PocketIC (not configured)"
    fi
    
    # ICRC4.mo PocketIC tests
    if [ -d "$ICRC4_DIR/pic" ] && [ -f "$ICRC4_DIR/pic/package.json" ]; then
        log_subsection "ICRC4.mo PocketIC tests"
        cd "$ICRC4_DIR/pic"
        npm install --silent 2>/dev/null || true
        run_test "ICRC4.mo PocketIC" "$ICRC4_DIR/pic" "npx vitest run --reporter=basic" || true
    else
        log_skip "ICRC4.mo PocketIC (not configured)"
    fi
    
    # ICRC_fungible PocketIC tests
    if [ -d "$PROJECT_DIR/pic" ] && [ -f "$PROJECT_DIR/pic/package.json" ]; then
        log_subsection "ICRC_fungible PocketIC tests"
        cd "$PROJECT_DIR/pic"
        npm install --silent 2>/dev/null || true
        run_test "ICRC_fungible PocketIC" "$PROJECT_DIR/pic" "npx vitest run --reporter=basic" || true
    else
        log_skip "ICRC_fungible PocketIC (not configured)"
    fi
}

# Build token canisters
build_canisters() {
    log_section "Building Token Canisters"
    
    cd "$PROJECT_DIR"
    
    # Ensure icp replica is running
    if ! icp network status &> /dev/null; then
        echo "Starting local icp replica..."
        icp network stop 2>/dev/null || true
        icp network start -d
        sleep 5
    fi

    # Create canisters first
    echo "Creating canisters..."
    icp identity new icrc_deployer --storage plaintext 2>/dev/null || true
    icp identity default icrc_deployer
    icp canister create token 2>/dev/null || true
    icp canister create token-mixin 2>/dev/null || true
    icp canister create token_icrc85 2>/dev/null || true
    icp canister create dummy_collector 2>/dev/null || true

    echo "Building token canister..."
    icp build token

    echo "Building token_icrc85 canister (for PocketIC tests)..."
    icp build token_icrc85 || echo "Warning: token_icrc85 build failed, continuing..."

    echo "Building dummy_collector canister (for PocketIC tests)..."
    icp build dummy_collector || echo "Warning: dummy_collector build failed, continuing..."

    if ! $SKIP_TOKEN_MIXIN && ! $ONLY_TOKEN_MIXIN; then
        echo "Building token-mixin canister..."
        icp build token-mixin || echo "Warning: token-mixin build failed, continuing..."
    fi

    if $ONLY_TOKEN_MIXIN; then
        echo "Building token-mixin canister..."
        icp build token-mixin
    fi

    echo "✓ ICRC_fungible canister builds complete"

    # Create .dfx-compatible WASM layout for PocketIC tests
    # Tests hardcode .dfx/local/canisters/<name>/<name>.wasm.gz — bridge icp-cli artifacts
    echo "Creating .dfx compatibility layer for PocketIC tests..."
    for canister in token token-mixin token_icrc85 dummy_collector; do
        artifact="$PROJECT_DIR/.icp/cache/artifacts/$canister"
        dfx_dir="$PROJECT_DIR/.dfx/local/canisters/$canister"
        if [ -f "$artifact" ]; then
            mkdir -p "$dfx_dir"
            gzip -c "$artifact" > "$dfx_dir/$canister.wasm.gz"
        fi
    done
    echo "✓ .dfx compatibility layer ready"

    # Build index.mo and create its .dfx compat layer (needed by index_push and icrc85 PocketIC tests)
    INDEX_MO_DIR="$WORKSPACE_DIR/index.mo"
    if [ -d "$INDEX_MO_DIR" ] && [ -f "$INDEX_MO_DIR/icp.yaml" ]; then
        echo "Building index.mo canister..."
        cd "$INDEX_MO_DIR"
        mops install 2>/dev/null || true
        icp build icrc_index 2>&1 || echo "Warning: icrc_index build failed, continuing..."
        artifact="$INDEX_MO_DIR/.icp/cache/artifacts/icrc_index"
        if [ -f "$artifact" ]; then
            mkdir -p "$INDEX_MO_DIR/.dfx/local/canisters/icrc_index"
            gzip -c "$artifact" > "$INDEX_MO_DIR/.dfx/local/canisters/icrc_index/icrc_index.wasm.gz"
            # Copy DID file from integration tests (same interface)
            cp "$PROJECT_DIR/test/integration/icrc_index.did" "$INDEX_MO_DIR/.dfx/local/canisters/icrc_index/icrc_index.did" 2>/dev/null || true
            echo "✓ icrc_index.wasm.gz + icrc_index.did ready"
        fi
        cd "$PROJECT_DIR"
    else
        echo "Warning: index.mo not found at $INDEX_MO_DIR — index_push and icrc85 PocketIC tests will skip"
    fi

    # Build ICRC library canisters needed for PocketIC tests
    if ! $SKIP_PIC; then
        echo ""
        echo "Building ICRC library canisters for PocketIC tests..."

        # ICRC1.mo canisters
        if [ -d "$ICRC1_DIR" ] && [ -f "$ICRC1_DIR/icp.yaml" ]; then
            echo "Building ICRC1.mo canisters..."
            cd "$ICRC1_DIR"
            icp build 2>&1 || echo "Warning: ICRC1.mo build had errors, continuing..."
            cd "$PROJECT_DIR"
        fi

        # ICRC2.mo canisters
        if [ -d "$ICRC2_DIR" ] && [ -f "$ICRC2_DIR/icp.yaml" ]; then
            echo "Building ICRC2.mo canisters..."
            cd "$ICRC2_DIR"
            icp build 2>&1 || echo "Warning: ICRC2.mo build had errors, continuing..."
            cd "$PROJECT_DIR"
        fi

        # icrc3.mo canisters
        if [ -d "$ICRC3_DIR" ] && [ -f "$ICRC3_DIR/icp.yaml" ]; then
            echo "Building icrc3.mo canisters..."
            cd "$ICRC3_DIR"
            icp build 2>&1 || echo "Warning: icrc3.mo build had errors, continuing..."
            cd "$PROJECT_DIR"
        fi

        echo "✓ ICRC library canister builds complete"
    fi
}

# Run DFINITY official tests
run_dfinity_tests() {
    log_section "Running DFINITY Official ICRC-1/2 Test Suite"
    
    if $SKIP_DFINITY; then
        log_skip "DFINITY tests (skipped via --skip-dfinity)"
        return
    fi
    
    if ! command -v cargo &> /dev/null; then
        log_skip "DFINITY tests (cargo not installed)"
        return
    fi
    
    cd "$PROJECT_DIR"
    
    # Run against token
    if ! $ONLY_TOKEN_MIXIN; then
        run_test "DFINITY ICRC-1/2 vs token" "$PROJECT_DIR" "bash runners/run_dfinity_tests.sh --canister token" || true
    fi
    
    # Run against token-mixin
    if ! $SKIP_TOKEN_MIXIN && [ -f "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" ]; then
        run_test "DFINITY ICRC-1/2 vs token-mixin" "$PROJECT_DIR" "bash runners/run_dfinity_tests.sh --canister token-mixin" || true
    fi
}

# Setup and run Devefi tests
run_devefi_tests() {
    log_section "Running Devefi Test Suite"
    
    if $SKIP_DEVEFI; then
        log_skip "Devefi tests (skipped via --skip-devefi)"
        return
    fi
    
    # Ensure patch directory exists
    if [ ! -d "$PROJECT_DIR/test/devefi_patches" ]; then
        echo "Error: Devefi patches directory not found at $PROJECT_DIR/test/devefi_patches"
        log_fail "Devefi tests (patches not found)"
        return
    fi
    
    # Fresh clone if --clean-devefi flag or directory doesn't exist
    if $CLEAN_DEVEFI && [ -d "$DEVEFI_TEST_DIR" ]; then
        echo "Removing existing devefi_ledger_tests for fresh clone..."
        rm -rf "$DEVEFI_TEST_DIR"
    fi
    
    # Clone devefi tests if needed
    if [ ! -d "$DEVEFI_TEST_DIR" ]; then
        echo "Cloning devefi_ledger_tests..."
        git clone --depth 1 https://github.com/Neutrinomic/devefi_ledger_tests.git "$DEVEFI_TEST_DIR"
    fi
    
    cd "$DEVEFI_TEST_DIR"
    
    # Install dependencies if needed or if --clean-devefi
    if [ ! -d "node_modules" ] || $CLEAN_DEVEFI; then
        echo "Installing npm dependencies..."
        npm install --legacy-peer-deps
        # Downgrade packages for CommonJS compatibility
        echo "Downgrading @dfinity packages for CommonJS compatibility..."
        npm install @dfinity/utils@3.0.0 @dfinity/ledger-icp@3.0.0 --save --legacy-peer-deps
    fi
    
    # Build the test suite if needed (generates IDL files in ./build/)
    # Note: build.sh requires sibling repos (devefi_icp_ledger, devefi_icrc_ledger, NTC)
    if [ ! -d "build" ] || [ ! -f "build/basic.idl.js" ] || $CLEAN_DEVEFI; then
        echo "Building devefi test suite (generating IDL files)..."
        
        # Clone sibling repos if they don't exist
        if [ ! -d "../devefi_icrc_ledger" ]; then
            echo "Cloning devefi_icrc_ledger..."
            git clone --depth 1 https://github.com/Neutrinomic/devefi_icrc_ledger.git ../devefi_icrc_ledger 2>/dev/null || true
        fi
        if [ ! -d "../devefi_icp_ledger" ]; then
            echo "Cloning devefi_icp_ledger..."
            git clone --depth 1 https://github.com/Neutrinomic/devefi_icp_ledger.git ../devefi_icp_ledger 2>/dev/null || true
        fi
        
        chmod +x build.sh 2>/dev/null || true
        ./build.sh 2>&1 || {
            echo "Warning: build.sh had errors"
        }
        
        # Create stub files for NTC module (we skip NTC tests but TypeScript still needs the import)
        echo "Creating NTC stub files..."
        cat > build/NTC.idl.js << 'NTCSTUB'
export const idlFactory = ({ IDL }) => IDL.Service({});
export const init = ({ IDL }) => [];
NTCSTUB
        cat > build/NTC.idl.d.ts << 'NTCSTUBTS'
import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
export interface _SERVICE {}
export declare const idlFactory: any;
export declare const init: any;
NTCSTUBTS

        # Check if essential build files were created
        if [ ! -f "build/basic.idl.js" ]; then
            echo "Error: Essential build files not created. Devefi tests require:"
            echo "  - Sibling repos: devefi_icrc_ledger, devefi_icp_ledger"  
            echo "  - GNU parallel: brew install parallel"
            echo "Skipping devefi tests."
            log_skip "Devefi tests (build incomplete)"
            cd "$PROJECT_DIR"
            return
        fi
    fi
    
    # Always reset common.ts to avoid duplicate patches
    echo "Resetting common.ts to original state..."
    git checkout common.ts 2>/dev/null || true
    
    # Apply Motoko ledger patches
    echo "Applying Motoko ledger patches..."
    if ! python3 "$PROJECT_DIR/test/devefi_patches/apply_motoko_support.py"; then
        echo "Error: Failed to apply Motoko patches"
        log_fail "Devefi tests (patch failed)"
        cd "$PROJECT_DIR"
        return
    fi
    
    # Copy IDL files
    echo "Copying IDL files..."
    mkdir -p "$DEVEFI_TEST_DIR/icrc_ledger"
    cp "$PROJECT_DIR/test/devefi_patches/motoko_ledger.idl.js" "$DEVEFI_TEST_DIR/icrc_ledger/" || true
    cp "$PROJECT_DIR/test/devefi_patches/motoko_ledger.idl.d.ts" "$DEVEFI_TEST_DIR/icrc_ledger/" || true
    
    # Find pocket-ic binary (check multiple locations)
    local POCKET_IC_BIN="${POCKET_IC_BIN:-}"
    if [ -z "$POCKET_IC_BIN" ]; then
        echo "Searching for pocket-ic binary..."
        # Check dfx cache location
        if [ -f "$HOME/.cache/dfinity/pocket-ic/pocket-ic" ]; then
            POCKET_IC_BIN="$HOME/.cache/dfinity/pocket-ic/pocket-ic"
        # Check system path
        elif [ -f "/usr/local/bin/pocket-ic" ]; then
            POCKET_IC_BIN="/usr/local/bin/pocket-ic"
        # Check node_modules in devefi dir
        elif [ -f "$DEVEFI_TEST_DIR/node_modules/@hadronous/pic/dist/pocket-ic" ]; then
            POCKET_IC_BIN="$DEVEFI_TEST_DIR/node_modules/@hadronous/pic/dist/pocket-ic"
        # Check node_modules in project dir
        elif [ -f "$PROJECT_DIR/pic/node_modules/@hadronous/pic/dist/pocket-ic" ]; then
            POCKET_IC_BIN="$PROJECT_DIR/pic/node_modules/@hadronous/pic/dist/pocket-ic"
        # Check node_modules in ICRC1.mo
        elif [ -f "$ICRC1_DIR/pic/node_modules/@hadronous/pic/dist/pocket-ic" ]; then
            POCKET_IC_BIN="$ICRC1_DIR/pic/node_modules/@hadronous/pic/dist/pocket-ic"
        fi
    fi
    
    if [ -z "$POCKET_IC_BIN" ]; then
        echo "Warning: pocket-ic binary not found in common locations"
        echo "  Checked: ~/.cache/dfinity/pocket-ic/, /usr/local/bin/, node_modules/@hadronous/pic/dist/"
        echo "  Tests may still work if PocketIC downloads it automatically"
    else
        echo "Using pocket-ic: $POCKET_IC_BIN"
        export POCKET_IC_BIN
    fi
    
    # Run tests against token canister
    if ! $ONLY_TOKEN_MIXIN; then
        if [ -f "$PROJECT_DIR/.icp/cache/artifacts/token" ]; then
            echo "Copying token wasm to devefi test directory..."
            cp "$PROJECT_DIR/.icp/cache/artifacts/token" "$DEVEFI_TEST_DIR/icrc_ledger/motoko_ledger.wasm.gz"
            
            echo "Running Devefi tests against token canister..."
            echo "Note: noise.spec.ts and tx_window.spec.ts tests can take several minutes..."
            cd "$DEVEFI_TEST_DIR"
            # Run in subshell to isolate SIGPIPE; redirect to file instead of tee to avoid broken pipe
            DEVEFI_TOKEN_EXIT=0
            (
                trap '' PIPE
                env POCKET_IC_BIN="$POCKET_IC_BIN" LEDGER=motoko LEDGER_TYPE=icrc npx jest --runInBand --testPathIgnorePatterns='fastscan|ntc' --verbose > /tmp/devefi_token_test.log 2>&1
            ) || DEVEFI_TOKEN_EXIT=$?
            echo "--- Devefi token test output (last 30 lines) ---"
            tail -30 /tmp/devefi_token_test.log 2>/dev/null || true
            echo "--- End Devefi output (exit: $DEVEFI_TOKEN_EXIT) ---"
            if [ $DEVEFI_TOKEN_EXIT -eq 0 ]; then
                log_pass "Devefi vs token"
            else
                log_fail "Devefi vs token"
            fi
        else
            echo "token.wasm.gz not found at $PROJECT_DIR/.dfx/local/canisters/token/"
            log_skip "Devefi vs token (WASM not found)"
        fi
    fi
    
    # Run tests against token-mixin canister
    if ! $SKIP_TOKEN_MIXIN; then
        if [ -f "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" ]; then
            echo "Copying token-mixin wasm to devefi test directory..."
            cp "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" "$DEVEFI_TEST_DIR/icrc_ledger/motoko_ledger.wasm.gz"
            
            echo "Running Devefi tests against token-mixin canister..."
            echo "Note: noise.spec.ts and tx_window.spec.ts tests can take several minutes..."
            cd "$DEVEFI_TEST_DIR"
            # Run in subshell to isolate SIGPIPE; redirect to file instead of tee to avoid broken pipe
            DEVEFI_MIXIN_EXIT=0
            (
                trap '' PIPE
                env POCKET_IC_BIN="$POCKET_IC_BIN" LEDGER=motoko LEDGER_TYPE=icrc npx jest --runInBand --testPathIgnorePatterns='fastscan|ntc' --verbose > /tmp/devefi_token_mixin_test.log 2>&1
            ) || DEVEFI_MIXIN_EXIT=$?
            echo "--- Devefi token-mixin test output (last 30 lines) ---"
            tail -30 /tmp/devefi_token_mixin_test.log 2>/dev/null || true
            echo "--- End Devefi output (exit: $DEVEFI_MIXIN_EXIT) ---"
            if [ $DEVEFI_MIXIN_EXIT -eq 0 ]; then
                log_pass "Devefi vs token-mixin"
            else
                log_fail "Devefi vs token-mixin"
            fi
        else
            echo "token-mixin.wasm.gz not found at $PROJECT_DIR/.dfx/local/canisters/token-mixin/"
            log_skip "Devefi vs token-mixin (WASM not found)"
        fi
    fi
    
    cd "$PROJECT_DIR"
}

# Run Rosetta tests
run_rosetta_tests() {
    log_section "Running Rosetta Integration Tests"
    
    if $SKIP_ROSETTA; then
        log_skip "Rosetta tests (skipped via --skip-rosetta)"
        return
    fi
    
    if ! command -v docker &> /dev/null; then
        log_skip "Rosetta tests (docker not installed)"
        return
    fi
    
    # Stop the replica so integration tests can start their own on the same port
    echo "Stopping replica before integration tests..."
    cd "$PROJECT_DIR"
    icp network stop 2>/dev/null || true
    sleep 2
    
    cd "$PROJECT_DIR/test/integration"
    
    # Run against token
    if ! $ONLY_TOKEN_MIXIN; then
        run_test "Rosetta vs token" "$PROJECT_DIR/test/integration" "bash test_rosetta.sh --canister token" || true
    fi
    
    # Run against token-mixin
    if ! $SKIP_TOKEN_MIXIN && [ -f "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" ]; then
        run_test "Rosetta vs token-mixin" "$PROJECT_DIR/test/integration" "bash test_rosetta.sh --canister token-mixin" || true
    fi

    # Run archive test (verifies Rosetta can sync through ICRC-3 archives)
    run_test "Rosetta archive sync" "$PROJECT_DIR/test/integration" "bash test_rosetta_archive.sh" || true
}

# Run Index-NG tests
run_index_tests() {
    log_section "Running DFINITY Index-NG Integration Tests"
    
    if $SKIP_INDEX; then
        log_skip "Index-NG tests (skipped via --skip-index)"
        return
    fi
    
    # Ensure any leftover replica is stopped so integration tests can bind the port
    echo "Ensuring replica is stopped before Index-NG tests..."
    cd "$PROJECT_DIR"
    icp network stop 2>/dev/null || true
    sleep 2

    cd "$PROJECT_DIR/test/integration"
    
    # Run against token
    if ! $ONLY_TOKEN_MIXIN; then
        run_test "Index-NG vs token" "$PROJECT_DIR/test/integration" "bash test_index_ng.sh --canister token" || true
    fi
    
    # Run against token-mixin
    if ! $SKIP_TOKEN_MIXIN && [ -f "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" ]; then
        run_test "Index-NG vs token-mixin" "$PROJECT_DIR/test/integration" "bash test_index_ng.sh --canister token-mixin" || true
    fi
}

# Run index.mo tests
run_index_mo_tests() {
    log_section "Running index.mo Integration Tests"
    
    if $SKIP_INDEX || $SKIP_INDEX_MO; then
        log_skip "index.mo tests (skipped via --skip-index or --skip-index-mo)"
        return
    fi
    
    # Ensure any leftover replica is stopped so integration tests can bind the port
    echo "Ensuring replica is stopped before index.mo tests..."
    cd "$PROJECT_DIR"
    icp network stop 2>/dev/null || true
    sleep 2
    
    cd "$PROJECT_DIR/test/integration"
    
    # Run against token
    if ! $ONLY_TOKEN_MIXIN; then
        run_test "index.mo vs token" "$PROJECT_DIR/test/integration" "bash test_index_mo.sh --canister token" || true
    fi
    
    # Run against token-mixin
    if ! $SKIP_TOKEN_MIXIN && [ -f "$PROJECT_DIR/.icp/cache/artifacts/token-mixin" ]; then
        run_test "index.mo vs token-mixin" "$PROJECT_DIR/test/integration" "bash test_index_mo.sh --canister token-mixin" || true
    fi
}

# Print summary
print_summary() {
    log_section "Test Summary"
    
    echo ""
    echo "Results:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    local i=0
    while [ $i -lt ${#TEST_NAMES[@]} ]; do
        local test="${TEST_NAMES[$i]}"
        local result="${TEST_STATUSES[$i]}"
        case $result in
            PASS)
                echo -e "${GREEN}✓${NC} $test"
                ;;
            FAIL)
                echo -e "${RED}✗${NC} $test"
                ;;
            SKIP)
                echo -e "${YELLOW}○${NC} $test"
                ;;
        esac
        ((i++)) || true
    done
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}Passed:${NC}  $TOTAL_PASSED"
    echo -e "${RED}Failed:${NC}  $TOTAL_FAILED"
    echo -e "${YELLOW}Skipped:${NC} $TOTAL_SKIPPED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    if [ $TOTAL_FAILED -gt 0 ]; then
        echo ""
        echo -e "${RED}❌ SOME TESTS FAILED${NC}"
        return 1
    else
        echo ""
        echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
        return 0
    fi
}

# Cleanup
cleanup() {
    echo ""
    echo "Cleaning up..."
    icp network stop 2>/dev/null || true
    docker stop rosetta-test 2>/dev/null || true
    docker rm rosetta-test 2>/dev/null || true
}

trap cleanup EXIT

# Main execution
main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     ICRC_fungible Comprehensive Test Suite                    ║"
    echo "║     Testing: token, token-mixin, ICRC 1/2/3/4 components     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Started at: $(date)"
    echo "ICP Port:    $ICP_PORT"
    echo ""
    
    check_prerequisites
    build_canisters
    run_mops_tests
    run_pic_tests
    run_dfinity_tests
    run_devefi_tests
    run_rosetta_tests
    run_index_tests
    run_index_mo_tests
    print_summary
}

main "$@"
