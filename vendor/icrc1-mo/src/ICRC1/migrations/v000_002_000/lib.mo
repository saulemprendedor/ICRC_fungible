import Runtime "mo:core/Runtime";

import MigrationTypes "../types";
import v0_2_0 "types";

module {

  type Account = v0_2_0.Account;
  type Balance = v0_2_0.Balance;
  type Transaction = v0_2_0.Transaction;

  public func upgrade(prevmigration_state: MigrationTypes.State, args: MigrationTypes.Args, caller: Principal): MigrationTypes.State {

    let state = switch(prevmigration_state) {
      case (#v0_1_0(#data(prev))) {
        // Upgrade from v1 to v2
        let next_state : v0_2_0.State = {
            var _burned_tokens = prev._burned_tokens;
            var _minted_tokens = prev._minted_tokens;
            var permitted_drift = prev.permitted_drift;
            var transaction_window = prev.transaction_window;
            var accounts = prev.accounts;
            var name = prev.name;
            var symbol = prev.symbol;
            var logo = prev.logo;
            var decimals = prev.decimals;
            var _fee = prev._fee;
            var max_supply = prev.max_supply;
            var max_accounts = prev.max_accounts;
            var settle_to_accounts = prev.settle_to_accounts;
            var cleaning_timer = prev.cleaning_timer;
            var min_burn_amount = prev.min_burn_amount;
            var minting_account = prev.minting_account;
            var max_memo = prev.max_memo;
            var metadata = prev.metadata;
            var fee_collector = prev.fee_collector;
            var supported_standards = prev.supported_standards;
            var local_transactions = prev.local_transactions;
            var recent_transactions = prev.recent_transactions;
            var fee_collector_block = prev.fee_collector_block;
            var fee_collector_emitted = prev.fee_collector_emitted;
            // Rename icrc85 to org_icdevs_ovs_fixed_state
            var org_icdevs_ovs_fixed_state = {
                var activeActions = prev.icrc85.activeActions;
                var lastActionReported = prev.icrc85.lastActionReported;
                var nextCycleActionId = prev.icrc85.nextCycleActionId;
                var resetAtEndOfPeriod = false; // Default for migration
            };
            var org_icdevs_timer_tool = prev.org_icdevs_timer_tool;
        };
        next_state
      };
      case (#v0_2_0(#data(state))) state;
      case (#v0_0_0(_)) {
          // Fallback for fresh install, though unlikely to reach here if install path is separate
          Runtime.trap("Fresh install not supported in v2 upgrade path yet, use v1 upgrade path first or init");
      };
      case (_) Runtime.trap("Invalid previous state for v2 upgrade");
    };

    #v0_2_0(#data(state));
  };


  public func downgrade(_prev_migration_state: MigrationTypes.State, _args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {
      // Downgrade logic if needed, or trap
      Runtime.trap("Downgrade not supported");
  };

};
