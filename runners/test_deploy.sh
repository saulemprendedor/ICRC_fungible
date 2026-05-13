set -ex

icp identity new alice --storage plaintext || true
icp identity default alice
ALICE_PRINCIPAL=$(icp identity principal)

icp identity new bob --storage plaintext || true
icp identity default bob
BOB_PRINCIPAL=$(icp identity principal)

icp identity new charlie --storage plaintext || true
icp identity default charlie
CHARLIE_PRINCIPAL=$(icp identity principal)

icp identity new icrc_deployer --storage plaintext || true
icp identity default icrc_deployer
ADMIN_PRINCIPAL=$(icp identity principal)

icp deploy token -m reinstall --args "(opt record {icrc1 = opt record {
  name = opt \"Test Token\";
  symbol = opt \"TTT\";
  logo = opt \"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InJlZCIvPjwvc3ZnPg==\";
  decimals = 8;
  fee = opt variant { Fixed = 10000};
  minting_account = opt record{
    owner = principal \"$ADMIN_PRINCIPAL\";
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
};})" --args-format candid -y

ICRC_CANISTER=$(icp canister status token --json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo $ICRC_CANISTER

# Init
icp canister call token admin_init "()"
icp identity default icrc_deployer

# Queries
icp canister call token icrc1_name "()" --query
icp canister call token icrc1_symbol "()" --query
icp canister call token icrc1_decimals "()" --query
icp canister call token icrc1_fee "()" --query
icp canister call token icrc1_metadata "()" --query

# Mint to Alice
icp canister call token icrc1_transfer "(record {
  memo = null;
  created_at_time=null;
  from_subaccoint = null;
  amount = 100000000000;
  to = record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  };
  fee = null
})"

icp canister call token icrc1_total_supply "()" --query
icp canister call token icrc1_minting_account "()" --query
icp canister call token icrc1_supported_standards "()" --query

icp canister call token icrc1_balance_of "(record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  })" --query

icp identity default alice

# Alice transfers to Bob
icp canister call token icrc1_transfer "(record {
  memo = null;
  created_at_time=null;
  amount = 50000000000;
  from_subaccoint = null;
  to = record {
    owner = principal \"$BOB_PRINCIPAL\";
    subaccount = null;
  };
  fee = opt 10000;
})"

icp canister call token icrc1_balance_of "(record {
  owner = principal \"$ALICE_PRINCIPAL\";
  subaccount = null;
})" --query

icp canister call token icrc1_balance_of "(record {
  owner = principal \"$BOB_PRINCIPAL\";
  subaccount = null;
})" --query

# Bob approves Alice
icp identity default bob

icp canister call token icrc2_approve "(record {
  memo = null;
  created_at_time=null;
  amount = 25000000000;
  from_subaccount = null;
  expected_allowance = null;
  expires_at = null;
  spender = record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  };
  fee = opt 10000;
})"

icp canister call token icrc2_allowance "(record {
  spender = record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  };
  account = record {
    owner = principal \"$BOB_PRINCIPAL\";
    subaccount = null;
  };
  })" --query

# Alice spends Bob's tokens to Charlie
icp identity default alice

icp canister call token icrc2_transfer_from "(record {
  memo = null;
  created_at_time=null;
  amount = 12500000000;
  spender_subaccoint = null;
  to = record {
    owner = principal \"$CHARLIE_PRINCIPAL\";
    subaccount = null;
  };
  from = record {
    owner = principal \"$BOB_PRINCIPAL\";
    subaccount = null;
  };
  fee = opt 10000;
})"

icp canister call token icrc1_balance_of "(record {
  owner = principal \"$ALICE_PRINCIPAL\";
  subaccount = null;
})" --query

icp canister call token icrc1_balance_of "(record {
  owner = principal \"$BOB_PRINCIPAL\";
  subaccount = null;
})" --query

icp canister call token icrc1_balance_of "(record {
  owner = principal \"$CHARLIE_PRINCIPAL\";
  subaccount = null;
})" --query

# Bob burns tokens
icp identity default bob

icp canister call token icrc1_transfer "(record {
  memo = null;
  created_at_time=null;
  amount = 100000000;
  from_subaccount = null;
  to = record {
    owner = principal \"$ADMIN_PRINCIPAL\";
    subaccount = null;
  };
  fee = opt 10000;
})"

# Revoke approval
icp canister call token icrc2_approve "(record {
  memo = null;
  created_at_time=null;
  amount = 0;
  from_subaccoint = null;
  expected_allowance = null;
  expires_at = null;
  spender = record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  };
  fee = opt 10000;
})"

icp canister call token icrc2_allowance "(record {
  spender = record {
    owner = principal \"$ALICE_PRINCIPAL\";
    subaccount = null;
  };
  account = record {
    owner = principal \"$BOB_PRINCIPAL\";
    subaccount = null;
  };
  })" --query

icp canister call token icrc3_get_blocks "(vec {record { start = 0; length = 1000}})" --query
icp canister call token icrc3_get_archives "(record {from = null})" --query
icp canister call token icrc3_get_tip_certificate "()" --query
