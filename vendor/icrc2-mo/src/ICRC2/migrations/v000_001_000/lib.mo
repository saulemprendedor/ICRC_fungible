import Option "mo:core/Option";

import MigrationTypes "../types";
import v0_1_0 "types";

module {

  type Account = v0_1_0.Account;
  type Balance = v0_1_0.Balance;
  type ApprovalInfo = v0_1_0.ApprovalInfo;
  type InitArgs = v0_1_0.InitArgs;

  let Map = v0_1_0.MapModule;
  let Set = v0_1_0.SetModule;

  public func upgrade(_prevmigration_state: MigrationTypes.State, args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {

    let config : InitArgs = switch(args){
      case(?val) val;
      case(null) {{
        max_approvals_per_account = null;
        max_approvals = null;
        settle_to_approvals = null;
        fee = null;
        advanced_settings = null;
        max_allowance = null;
        cleanup_interval = null;
        cleanup_on_zero_balance = null;
        icrc103_max_take_value = null;
        icrc103_public_allowances = null;
      }};
    };

    let p_max_approvals_per_account = Option.get<Nat>(config.max_approvals_per_account, 10_000);
    let p_max_approvals = Option.get<Nat>(config.max_approvals, 10_000_000);
    let p_settle_to_approvals = Option.get<Nat>(config.settle_to_approvals, 4_990_000);
    let p_fee = switch(config.fee){
      case(null) #ICRC1;
      case(?val) val;
    };
    let p_cleanup_interval = config.cleanup_interval;
    let p_cleanup_on_zero_balance = config.cleanup_on_zero_balance;
    let p_icrc103_max_take_value = Option.get<Nat>(config.icrc103_max_take_value, 1000);
    let p_icrc103_public_allowances = Option.get<Bool>(config.icrc103_public_allowances, true);

    let token_approvals = switch(config.advanced_settings){
      case(?settings) {
        let approvals_iter = settings.existing_approvals.vals();
        Map.fromIter<(Account, Account), ApprovalInfo>(approvals_iter, v0_1_0.approval_compare);
      };
      case(null) Map.empty<(Account, Account), ApprovalInfo>();
    };

    let indexes = {
      spender_to_approval_account = Map.empty<Account, Set.Set<Account>>();
      owner_to_approval_account = Map.empty<Account, Set.Set<Account>>();
    };

    // Rebuild indexes from existing approvals if any
    for(((owner, spender), _info) in Map.entries(token_approvals)){
      switch(Map.get(indexes.spender_to_approval_account, v0_1_0.account_compare, spender)){
        case(?existing_set) Set.add(existing_set, v0_1_0.account_compare, owner);
        case(null) {
          let new_set = Set.empty<Account>();
          Set.add(new_set, v0_1_0.account_compare, owner);
          Map.add(indexes.spender_to_approval_account, v0_1_0.account_compare, spender, new_set);
        };
      };
      switch(Map.get(indexes.owner_to_approval_account, v0_1_0.account_compare, owner)){
        case(?existing_set) Set.add(existing_set, v0_1_0.account_compare, spender);
        case(null) {
          let new_set = Set.empty<Account>();
          Set.add(new_set, v0_1_0.account_compare, spender);
          Map.add(indexes.owner_to_approval_account, v0_1_0.account_compare, owner, new_set);
        };
      };
    };

    let state : v0_1_0.State = {
      ledger_info = {
        var max_approvals_per_account = p_max_approvals_per_account;
        var max_approvals = p_max_approvals;
        var max_allowance = config.max_allowance;
        var settle_to_approvals = p_settle_to_approvals;
        var fee = p_fee;
        var metadata = null;
        var cleanup_interval = p_cleanup_interval;
        var cleanup_on_zero_balance = p_cleanup_on_zero_balance;
        var icrc103_max_take_value = p_icrc103_max_take_value;
        var icrc103_public_allowances = p_icrc103_public_allowances;
      };
      token_approvals = token_approvals;
      indexes = indexes;
    };

    #v0_1_0(#data(state));
  };

  public func downgrade(_prev_migration_state: MigrationTypes.State, _args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {
    #v0_0_0(#data);
  };

};
