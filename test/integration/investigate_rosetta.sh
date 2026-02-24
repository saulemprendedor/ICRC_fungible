#!/bin/bash
# Investigate the Rosetta balance discrepancy

set -e

cd "$(dirname "$0")"

echo "=== Cleaning up ==="
docker stop rosetta-test 2>/dev/null || true
docker rm rosetta-test 2>/dev/null || true
dfx stop 2>/dev/null || true
rm -rf .dfx

echo ""
echo "=== Starting replica ==="
dfx start --clean --background --domain localhost --domain host.docker.internal
sleep 3

echo ""
echo "=== Deploying token ==="
dfx deploy token --argument '(null)' 2>&1 | grep -v "^--"
dfx canister call token admin_init

TOKEN_CANISTER=$(dfx canister id token)
echo "Token: $TOKEN_CANISTER"

# Get identities
dfx identity use default
MINTER=$(dfx identity get-principal)
echo "Minter: $MINTER"

dfx identity use test_user 2>/dev/null || dfx identity new test_user --storage-mode=plaintext
dfx identity use test_user
TEST_USER=$(dfx identity get-principal)
echo "Test User: $TEST_USER"

dfx identity use default

echo ""
echo "=== Creating transactions ==="

echo "TX 0: MINT 1,000,000,000 to test user"
dfx canister call token icrc1_transfer "(record { to = record { owner = principal \"$TEST_USER\"; subaccount = null }; amount = 1_000_000_000; fee = null; memo = null; created_at_time = null; from_subaccount = null; })"

dfx identity use test_user

echo "TX 1: TRANSFER 100,000,000 to aaaaa-aa"
dfx canister call token icrc1_transfer "(record { to = record { owner = principal \"aaaaa-aa\"; subaccount = null }; amount = 100_000_000; fee = null; memo = null; created_at_time = null; from_subaccount = null; })"

echo "TX 2: BURN 50,000,000 (send to minter)"
dfx canister call token icrc1_transfer "(record { to = record { owner = principal \"$MINTER\"; subaccount = null }; amount = 50_000_000; fee = null; memo = null; created_at_time = null; from_subaccount = null; })"

echo "TX 3: APPROVE 200,000,000 for minter"
dfx canister call token icrc2_approve "(record { spender = record { owner = principal \"$MINTER\"; subaccount = null }; amount = 200_000_000; fee = null; memo = null; created_at_time = null; from_subaccount = null; expected_allowance = null; expires_at = null; })"

dfx identity use default

echo "TX 4: TRANSFER_FROM 100,000,000"
dfx canister call token icrc2_transfer_from "(record { from = record { owner = principal \"$TEST_USER\"; subaccount = null }; to = record { owner = principal \"aaaaa-aa\"; subaccount = null }; amount = 100_000_000; fee = null; memo = null; created_at_time = null; spender_subaccount = null; })"

echo "TX 5: MINT 500,000,000 to test user"
dfx canister call token icrc1_transfer "(record { to = record { owner = principal \"$TEST_USER\"; subaccount = null }; amount = 500_000_000; fee = null; memo = null; created_at_time = null; from_subaccount = null; })"

echo ""
echo "=== Ledger final state ==="
LEDGER_BALANCE=$(dfx canister call token icrc1_balance_of "(record { owner = principal \"$TEST_USER\"; subaccount = null })" | grep -o '[0-9_]*' | tr -d '_')
echo "Test User balance from LEDGER: $LEDGER_BALANCE"

echo ""
echo "=== Starting Rosetta ==="
docker run -d \
    --name rosetta-test \
    -p 8082:8080 \
    --add-host=localhost:host-gateway \
    dfinity/ic-icrc-rosetta-api:v1.2.8 \
    --ledger-id "$TOKEN_CANISTER" \
    --network-url "http://host.docker.internal:${DFX_PORT:-8887}" \
    --network-type testnet \
    --store-type in-memory 2>/dev/null

echo "Waiting 45s for Rosetta to sync..."
sleep 45

echo ""
echo "=== Checking Rosetta balance ==="
ROSETTA_RESPONSE=$(curl -s -X POST "http://localhost:8082/account/balance" \
    -H "Content-Type: application/json" \
    -d "{
        \"network_identifier\": {
            \"blockchain\": \"Internet Computer\",
            \"network\": \"$TOKEN_CANISTER\"
        },
        \"account_identifier\": {
            \"address\": \"$TEST_USER\"
        }
    }")

ROSETTA_BALANCE=$(echo "$ROSETTA_RESPONSE" | jq -r '.balances[0].value // "error"')
echo "Test User balance from ROSETTA: $ROSETTA_BALANCE"

echo ""
echo "=== COMPARISON ==="
echo "Ledger:  $LEDGER_BALANCE"
echo "Rosetta: $ROSETTA_BALANCE"

if [ "$LEDGER_BALANCE" == "$ROSETTA_BALANCE" ]; then
    echo "✅ BALANCES MATCH!"
else
    DIFF=$((ROSETTA_BALANCE - LEDGER_BALANCE))
    echo "❌ DIFFERENCE: $DIFF"
    echo ""
    echo "=== Investigating blocks ==="
    
    for i in 0 1 2 3 4 5; do
        echo ""
        echo "--- Block $i ---"
        curl -s -X POST "http://localhost:8082/block" \
            -H "Content-Type: application/json" \
            -d "{
                \"network_identifier\": {
                    \"blockchain\": \"Internet Computer\",
                    \"network\": \"$TOKEN_CANISTER\"
                },
                \"block_identifier\": {
                    \"index\": $i
                }
            }" | jq '.block.transactions[0].operations'
    done
fi

echo ""
echo "=== Cleanup ==="
docker stop rosetta-test
docker rm rosetta-test
