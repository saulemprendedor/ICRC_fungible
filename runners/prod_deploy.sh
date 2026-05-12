# Deploy and configure ICRC token canister on Internet Computer mainnet.
# Requires icp-cli installed and configured before running.

set -ex

# --- Identity Setup ---

icp identity new production_main_branch --storage plaintext || true
icp identity default production_main_branch
MAIN_BRANCH_PRINCIPAL=$(icp identity principal)

icp identity new production_liquidity_provider --storage plaintext || true
icp identity default production_liquidity_provider
LIQUIDITY_PROVIDER=$(icp identity principal)

icp identity new production_marketing_team --storage plaintext || true
icp identity default production_marketing_team
MARKETING_TEAM_PRINCIPAL=$(icp identity principal)

icp identity new production_dev_team --storage plaintext || true
icp identity default production_dev_team
DEV_TEAM_PRINCIPAL=$(icp identity principal)

icp identity new production_presale --storage plaintext || true
icp identity default production_presale
PRESALE_PRINCIPAL=$(icp identity principal)

icp identity new production_dexScreener --storage plaintext || true
icp identity default production_dexScreener
DEXSCREENER_PRINCIPAL=$(icp identity principal)

icp identity new production_charity --storage plaintext || true
icp identity default production_charity
CHARITY_PRINCIPAL=$(icp identity principal)

icp identity new production_fee_collector --storage plaintext || true
icp identity default production_fee_collector
FEE_COLLECTOR_PRINCIPAL=$(icp identity principal)

# --- Configuration ---

# Replace with your production identity name — must be a controller of the canister
PRODUCTION_IDENTITY="production_icrc_deployer"
icp identity default $PRODUCTION_IDENTITY
ADMIN_PRINCIPAL=$(icp identity principal)

# Canister ID on mainnet — create via icp canister create or NNS console
PRODUCTION_CANISTER="kctgo-cyaaa-aaaad-aanzq-cai"

# Token config
TOKEN_NAME="Test Token"
TOKEN_SYMBOL="TTT"
TOKEN_LOGO="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InJlZCIvPjwvc3ZnPg=="
TOKEN_DECIMALS=8
TOKEN_FEE=10000
MAX_SUPPLY=null
MIN_BURN_AMOUNT=10000
MAX_MEMO=64
MAX_ACCOUNTS=100000000
SETTLE_TO_ACCOUNTS=99999000

# --- Build & Deploy ---

icp build prodtoken -e ic

# Install on mainnet canister
icp canister install $PRODUCTION_CANISTER -e ic -m install \
  --wasm ".icp/cache/artifacts/prodtoken" \
  --args "(opt record {icrc1 = opt record {
  name = opt \"$TOKEN_NAME\";
  symbol = opt \"$TOKEN_SYMBOL\";
  logo = opt \"$TOKEN_LOGO\";
  decimals = $TOKEN_DECIMALS;
  fee = opt variant { Fixed = $TOKEN_FEE};
  minting_account = opt record{
    owner = principal \"$ADMIN_PRINCIPAL\";
    subaccount = null;
  };
  max_supply = $MAX_SUPPLY;
  min_burn_amount = opt $MIN_BURN_AMOUNT;
  max_memo = opt $MAX_MEMO;
  advanced_settings = null;
  metadata = null;
  fee_collector = null;
  transaction_window = null;
  permitted_drift = null;
  max_accounts = opt $MAX_ACCOUNTS;
  settle_to_accounts = opt $SETTLE_TO_ACCOUNTS;
};
icrc2 = opt record{
  max_approvals_per_account = opt 10000;
  max_allowance = opt variant { TotalSupply = null};
  fee = opt variant { ICRC1 = null};
  advanced_settings = null;
  max_approvals = opt 10000000;
  settle_to_approvals = opt 9990000;
};
icrc3 = opt record {
  maxActiveRecords = 3000;
  settleToRecords = 2000;
  maxRecordsInArchiveInstance = 100000000;
  maxArchivePages = 62500;
  archiveIndexType = variant {Stable = null};
  maxRecordsToArchive = 8000;
  archiveCycles = 20_000_000_000_000;
  supportedBlocks = vec {};
  archiveControllers = null;
};
icrc4 = opt record {
  max_balances = opt 200;
  max_transfers = opt 200;
  fee = opt variant { ICRC1 = null};
};})" \
  --args-format candid -y

ICRC_CANISTER=$(icp canister id token -e ic)
echo $ICRC_CANISTER

# --- Init & Verify ---

icp canister call token admin_init -e ic

icp canister call token icrc1_name -e ic --query
icp canister call token icrc1_symbol -e ic --query
icp canister call token icrc1_decimals -e ic --query
icp canister call token icrc1_fee -e ic --query
icp canister call token icrc1_metadata -e ic --query

# --- Mint Tokens ---

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 500_000_000_000_000_000;
  to = record {
    owner = principal \"$MAIN_BRANCH_PRINCIPAL\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 170_000_000_000_000_000;
  to = record {
    owner = principal \"$LIQUIDITY_PROVIDER\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 56_000_000_000_000_000;
  to = record {
    owner = principal \"$PRESALE_PRINCIPAL\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 24_000_000_000_000_000;
  to = record {
    owner = principal \"$DEXSCREENER_PRINCIPAL\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 100_000_000_000_000_000;
  to = record {
    owner = principal \"$MARKETING_TEAM_PRINCIPAL\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 100_000_000_000_000_000;
  to = record {
    owner = principal \"$DEV_TEAM_PRINCIPAL\";
    subaccount = null;
  }
})"

icp canister call token icrc1_transfer -e ic "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 50_000_000_000_000_000;
  to = record {
    owner = principal \"$CHARITY_PRINCIPAL\";
    subaccount = null;
  }
})"
