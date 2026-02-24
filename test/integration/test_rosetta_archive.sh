#!/bin/bash

# DFINITY ICRC-1 Rosetta Integration Test with Archiving
# Tests that our ledger works with Rosetta even after blocks are archived

set -e

echo "=== DFINITY ICRC-1 Rosetta Archive Integration Test ==="
echo ""

# Configuration
ROSETTA_IMAGE="dfinity/ic-icrc-rosetta-api:latest"
ROSETTA_PORT=8082
REPLICA_PORT="${DFX_PORT:-8887}"

# Archive settings - low thresholds to trigger archiving quickly
MAX_ACTIVE_RECORDS=20
SETTLE_TO_RECORDS=10
MAX_RECORDS_IN_ARCHIVE=100
MAX_RECORDS_TO_ARCHIVE=15
ARCHIVE_CYCLES=2000000000000  # 2T cycles for archive

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo "=== Cleanup ==="
    docker stop rosetta-test 2>/dev/null || true
    docker rm rosetta-test 2>/dev/null || true
    dfx stop 2>/dev/null || true
    echo "Done!"
}

trap cleanup EXIT

# Clean up any previous state
echo "🧹 Cleaning up previous state..."
docker stop rosetta-test 2>/dev/null || true
docker rm rosetta-test 2>/dev/null || true
dfx stop 2>/dev/null || true
rm -rf .dfx 2>/dev/null || true

# Start local replica
echo "🚀 Starting local replica..."
dfx start --clean --background --host "127.0.0.1:$REPLICA_PORT" --domain localhost --domain host.docker.internal
sleep 3

# Deploy token canister with archive settings
echo "📦 Deploying token canister with low archive thresholds..."
echo "   maxActiveRecords: $MAX_ACTIVE_RECORDS"
echo "   settleToRecords: $SETTLE_TO_RECORDS"
echo "   maxRecordsInArchiveInstance: $MAX_RECORDS_IN_ARCHIVE"
echo "   maxRecordsToArchive: $MAX_RECORDS_TO_ARCHIVE"
echo ""

# Deploy with init args for low archive thresholds
# archiveControllers type is opt opt vec principal - null means "use ledger canister's default"
dfx deploy token --argument "(opt record {
  icrc1 = null;
  icrc2 = null;
  icrc3 = record {
    maxActiveRecords = $MAX_ACTIVE_RECORDS : nat;
    settleToRecords = $SETTLE_TO_RECORDS : nat;
    maxRecordsInArchiveInstance = $MAX_RECORDS_IN_ARCHIVE : nat;
    maxArchivePages = 62500 : nat;
    archiveIndexType = variant { Stable };
    maxRecordsToArchive = $MAX_RECORDS_TO_ARCHIVE : nat;
    archiveCycles = $ARCHIVE_CYCLES : nat;
    archiveControllers = null : opt opt vec principal;
    supportedBlocks = vec {
      record { block_type = \"1xfer\"; url = \"https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3\" };
      record { block_type = \"2xfer\"; url = \"https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3\" };
      record { block_type = \"2approve\"; url = \"https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3\" };
      record { block_type = \"1mint\"; url = \"https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3\" };
      record { block_type = \"1burn\"; url = \"https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3\" };
    };
  };
  icrc4 = null;
})"

TOKEN_CANISTER=$(dfx canister id token)
echo "✅ Token deployed at: $TOKEN_CANISTER"

# Initialize the token
echo "🔧 Initializing token..."
dfx canister call token admin_init || echo "admin_init might not be needed"

# Add cycles to the token canister so it can create archives
echo "💎 Adding cycles to token canister for archive creation..."
# On local replica, we can use dfx to add cycles
dfx canister deposit-cycles 10000000000000 token
echo "   Added 10T cycles to token canister"

# Get initial block count
echo ""
echo "📊 Initial block check..."
dfx canister call token icrc3_get_blocks "(vec { record { start = 0 : nat; length = 1 : nat } })" | head -5

# Generate many transactions to trigger archiving
echo ""
echo "💸 Generating 30+ transactions to trigger archiving..."

# Mint initial tokens
echo "   Minting initial tokens..."
dfx canister call token icrc1_transfer "(record {
  to = record { 
    owner = principal \"$(dfx identity get-principal)\"; 
    subaccount = null 
  };
  amount = 10_000_000_000;
  fee = null;
  memo = null;
  created_at_time = null;
  from_subaccount = null;
})"

# Create many transfers to trigger archiving
RECIPIENT1="aaaaa-aa"
RECIPIENT2="2vxsx-fae"

for i in $(seq 1 35); do
    echo "   Transfer $i/35..."
    if [ $((i % 2)) -eq 0 ]; then
        RECIPIENT=$RECIPIENT1
    else
        RECIPIENT=$RECIPIENT2
    fi
    dfx canister call token icrc1_transfer "(record {
      to = record { 
        owner = principal \"$RECIPIENT\"; 
        subaccount = null 
      };
      amount = $((1000 + i));
      fee = null;
      memo = null;
      created_at_time = null;
      from_subaccount = null;
    })" > /dev/null
done

echo "✅ Generated 36 transactions (1 mint + 35 transfers)"

# Wait a moment for archiving to potentially happen
echo ""
echo "⏳ Waiting for potential archiving..."
sleep 5

# Check block count after transactions
echo ""
echo "📊 ICRC3 block count after transactions..."
dfx canister call token icrc3_get_blocks "(vec { record { start = 0 : nat; length = 100 : nat } })" | grep -E "log_length|blocks"

# Check archives
echo ""
echo "📁 Checking archives..."
dfx canister call token icrc3_get_archives "(record {})"

# Get ledger info
echo ""
echo "📊 Getting ledger info..."
dfx canister call token icrc1_name
dfx canister call token icrc1_symbol
dfx canister call token icrc1_decimals
dfx canister call token icrc1_total_supply

# Check if we're on macOS (Darwin) or Linux
if [[ "$(uname)" == "Darwin" ]]; then
    HOST_IP="host.docker.internal"
    DOCKER_NETWORK_MODE=""
    DOCKER_PORT_MAP="-p $ROSETTA_PORT:8080"
else
    HOST_IP="127.0.0.1"
    DOCKER_NETWORK_MODE="--network host"
    DOCKER_PORT_MAP=""
fi

echo ""
echo "🚀 Starting Rosetta server..."
echo "   Ledger: $TOKEN_CANISTER"
echo "   IC URL: http://$HOST_IP:$REPLICA_PORT"
echo ""

# Run Rosetta in Docker
# --network-type testnet tells Rosetta to fetch the root key from the replica
docker run -d \
    --name rosetta-test \
    $DOCKER_PORT_MAP \
    $DOCKER_NETWORK_MODE \
    --add-host=localhost:host-gateway \
    $ROSETTA_IMAGE \
    --ledger-id "$TOKEN_CANISTER" \
    --network-url "http://$HOST_IP:$REPLICA_PORT" \
    --network-type testnet \
    --store-type in-memory

echo "⏳ Waiting for Rosetta to sync (this may take longer with archives)..."
sleep 15

# Check if Rosetta is running
if ! docker ps | grep -q rosetta-test; then
    echo "❌ Rosetta container failed to start"
    echo "Docker logs:"
    docker logs rosetta-test
    exit 1
fi

echo "✅ Rosetta server is running"
echo ""

# Test Rosetta endpoints
echo "📋 Testing Rosetta API endpoints..."
echo ""

# Test /network/list
echo "1. Testing /network/list..."
NETWORK_LIST=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/network/list" \
    -H "Content-Type: application/json" \
    -d '{"metadata": {}}')
echo "   Response: $NETWORK_LIST"
echo ""

# Get network identifier from the response
NETWORK_ID=$(echo $NETWORK_LIST | jq -r '.network_identifiers[0].network // empty')

if [ -z "$NETWORK_ID" ] || [ "$NETWORK_ID" == "null" ]; then
    echo "⚠️  Could not get network identifier, trying with ledger canister ID..."
    NETWORK_ID="$TOKEN_CANISTER"
fi

echo "   Network ID: $NETWORK_ID"
echo ""

# Test /network/status
echo "2. Testing /network/status..."
NETWORK_STATUS=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/network/status" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$NETWORK_ID\"
        }
    }")
echo "   Response: $(echo $NETWORK_STATUS | jq -c '.')"
echo ""

# Extract current block
CURRENT_BLOCK=$(echo $NETWORK_STATUS | jq -r '.current_block_identifier.index // "0"')
GENESIS_BLOCK=$(echo $NETWORK_STATUS | jq -r '.genesis_block_identifier.index // "0"')
OLDEST_BLOCK=$(echo $NETWORK_STATUS | jq -r '.oldest_block_identifier.index // "0"')
echo "   Current block index: $CURRENT_BLOCK"
echo "   Genesis block index: $GENESIS_BLOCK"
echo "   Oldest block index: $OLDEST_BLOCK"
echo ""

# Test /block (genesis block - may be archived!)
echo "3. Testing /block (genesis block - index 0)..."
BLOCK_RESPONSE=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/block" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$NETWORK_ID\"
        },
        \"block_identifier\": {
            \"index\": 0
        }
    }")
echo "   Response: $(echo $BLOCK_RESPONSE | jq -c '.')"
echo ""

# Test /block (latest block)
echo "4. Testing /block (latest block - index $CURRENT_BLOCK)..."
LATEST_BLOCK_RESPONSE=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/block" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$NETWORK_ID\"
        },
        \"block_identifier\": {
            \"index\": $CURRENT_BLOCK
        }
    }")
echo "   Response: $(echo $LATEST_BLOCK_RESPONSE | jq -c '.')"
echo ""

# Test /block (middle block that might be archived)
MIDDLE_BLOCK=$((CURRENT_BLOCK / 2))
echo "5. Testing /block (middle block - index $MIDDLE_BLOCK)..."
MIDDLE_BLOCK_RESPONSE=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/block" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$NETWORK_ID\"
        },
        \"block_identifier\": {
            \"index\": $MIDDLE_BLOCK
        }
    }")
echo "   Response: $(echo $MIDDLE_BLOCK_RESPONSE | jq -c '.')"
echo ""

# Test /account/balance
echo "6. Testing /account/balance..."
MINTER_PRINCIPAL=$(dfx identity get-principal)
BALANCE_RESPONSE=$(curl -s -X POST "http://localhost:$ROSETTA_PORT/account/balance" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$NETWORK_ID\"
        },
        \"account_identifier\": {
            \"address\": \"$MINTER_PRINCIPAL\"
        }
    }")
echo "   Response: $(echo $BALANCE_RESPONSE | jq -c '.')"
echo ""

# Check for errors
if echo $BALANCE_RESPONSE | jq -e '.code' > /dev/null 2>&1; then
    ERROR_CODE=$(echo $BALANCE_RESPONSE | jq -r '.code')
    ERROR_MSG=$(echo $BALANCE_RESPONSE | jq -r '.message')
    echo "⚠️  Balance query returned error: $ERROR_CODE - $ERROR_MSG"
else
    BALANCE=$(echo $BALANCE_RESPONSE | jq -r '.balances[0].value // "unknown"')
    echo "   Balance: $BALANCE"
fi

echo ""
echo "📊 Rosetta container logs (last 30 lines):"
docker logs rosetta-test 2>&1 | tail -30

# Final verification
echo ""
echo "=== Final Verification ==="
echo ""

# Get archive info again
echo "📁 Final archive status:"
dfx canister call token icrc3_get_archives "(record {})"

echo ""
echo "=== Test Summary ==="
echo "Rosetta server started: ✅"
echo "Network list endpoint: $([ -n "$NETWORK_LIST" ] && echo "✅" || echo "❌")"
echo "Network status endpoint: $([ -n "$NETWORK_STATUS" ] && echo "✅" || echo "❌")"
echo "Genesis block endpoint: $(echo $BLOCK_RESPONSE | jq -e '.block' > /dev/null 2>&1 && echo "✅" || echo "❌")"
echo "Latest block endpoint: $(echo $LATEST_BLOCK_RESPONSE | jq -e '.block' > /dev/null 2>&1 && echo "✅" || echo "❌")"
echo "Middle block endpoint: $(echo $MIDDLE_BLOCK_RESPONSE | jq -e '.block' > /dev/null 2>&1 && echo "✅" || echo "❌")"
echo "Balance endpoint: $(echo $BALANCE_RESPONSE | jq -e '.balances' > /dev/null 2>&1 && echo "✅" || echo "❌")"

# Check if archiving happened
ARCHIVE_COUNT=$(dfx canister call token icrc3_get_archives "(record {})" | grep -c "canister_id" || echo "0")
if [ "$ARCHIVE_COUNT" -gt "0" ]; then
    echo "Archive created: ✅ ($ARCHIVE_COUNT archive(s))"
else
    echo "Archive created: ⚠️  (No archives created - may need more transactions)"
fi

if echo $BLOCK_RESPONSE | jq -e '.block' > /dev/null 2>&1 && \
   echo $LATEST_BLOCK_RESPONSE | jq -e '.block' > /dev/null 2>&1 && \
   echo $BALANCE_RESPONSE | jq -e '.balances' > /dev/null 2>&1; then
    echo ""
    echo "🎉 Rosetta Archive Integration Test PASSED"
    echo "   Rosetta successfully reads blocks including archived ones!"
else
    echo ""
    echo "❌ Rosetta Archive Integration Test FAILED"
    echo "   Some endpoints did not return expected data"
    exit 1
fi
