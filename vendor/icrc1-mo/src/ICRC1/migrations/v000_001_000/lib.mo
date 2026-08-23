import Debug "mo:core/Debug";
import Opt "mo:core/Option";
import Runtime "mo:core/Runtime";
import Map "mo:core/Map";
import List "mo:core/List";

import Account "../../Account";
import MigrationTypes "../types";
import v0_1_0 "types";

module {

  type Transaction = v0_1_0.Transaction;
  type Account = v0_1_0.Account;
  type Balance = v0_1_0.Balance;

  let default_standard : v0_1_0.SupportedStandard = {
      name = "ICRC-1";
      url = "https://github.com/dfinity/ICRC-1";
  };

  // Creates a Vector with the default supported standards and returns it (for v0_1_0)
  func init_standards_v0_1_0() : v0_1_0.List.List<v0_1_0.SupportedStandard> {
      List.fromArray([default_standard])
  };


  public func upgrade(_prevmigration_state: MigrationTypes.State, args: MigrationTypes.Args, caller: Principal): MigrationTypes.State {

    let {
        name;
        symbol;
        logo;
        decimals;
        fee;
        minting_account;
        max_supply;
        min_burn_amount;
        advanced_settings;
        metadata;
        fee_collector;
        max_memo;
        permitted_drift;
        transaction_window;
        max_accounts;
        settle_to_accounts;
    } = switch(args){
      case(?args) {
        {
          args with
          max_memo = Opt.get<Nat>(args.max_memo, 384);
          permitted_drift : Nat64 = Opt.get<Nat64>(args.permitted_drift, 60_000_000_000 : Nat64);
          transaction_window : Nat64 = Opt.get<Nat64>(args.transaction_window, 86_400_000_000_000 : Nat64);
          max_accounts = Opt.get<Nat>(args.max_accounts, 5_000_000);
          settle_to_accounts = Opt.get<Nat>(args.settle_to_accounts, 4_990_000);
        }
      };
      case(null) {{
           name = null;
          symbol = null;
          logo = null;
          decimals = 8 : Nat8;
          fee = null;
          minting_account = null;
          max_supply = null;
          existing_balances = [];
          min_burn_amount = null;
          advanced_settings = null;
          metadata = null;
          max_memo = 384 : Nat;
          fee_collector = null;
          permitted_drift : Nat64 = 60_000_000_000 : Nat64;
          transaction_window : Nat64 = 86_400_000_000_000 : Nat64;
          max_accounts = 5_000_000;
          settle_to_accounts = 4_990_000;
        }
      };
    };

    var existing_balances =switch(advanced_settings){
      case(null) [];
      case(?val) val.existing_balances;
    };
    var local_transactions =switch(advanced_settings){
      case(null) [];
      case(?val) val.local_transactions;
    };
    
     var _burned_tokens = switch(advanced_settings){
        case(null) 0;
        case(?val) val.burned_tokens;
      };
      var _minted_tokens = switch(advanced_settings){
        case(null) 0;
        case(?val) val.minted_tokens;
      };

      let accounts = Map.fromIter<Account, Balance>(existing_balances.vals(),  v0_1_0.account_compare);

      let parsed_minting_account = switch(minting_account){
        case(?minting_account){
          if (not Account.validate(minting_account)) {
            Runtime.trap("minting_account is invalid");
          };
          minting_account;
        };
        case(null) {
          {
            owner = caller;
            subaccount = null;
          };
        };
      };

    let state : v0_1_0.State = {
      var _burned_tokens = _burned_tokens;
      var _minted_tokens = _minted_tokens;
      var permitted_drift = permitted_drift;
      var transaction_window = transaction_window;
      var accounts = accounts;
      var name = name;
      var symbol = symbol;
      var logo = logo;
      var decimals = decimals;
      var _fee = fee;
      var max_supply = max_supply;
      var max_accounts = max_accounts;
      var settle_to_accounts = settle_to_accounts;
      var cleaning_timer = null;
      var min_burn_amount = min_burn_amount;
      var minting_account = parsed_minting_account;
      var max_memo = max_memo;
      var metadata = metadata;
      var fee_collector = fee_collector;
      var supported_standards = ?init_standards_v0_1_0();
      var local_transactions = List.fromArray(local_transactions);
      var recent_transactions = Map.empty<Blob, (Nat64, Nat)>();
      var fee_collector_block = 0;
      var fee_collector_emitted = false;
      // ICRC-85 Open Value Sharing state
      icrc85 = {
        var nextCycleActionId = null;
        var lastActionReported = null;
        var activeActions = 0;
      };
      var org_icdevs_timer_tool = null;
    };

    

    return #v0_1_0(#data(state));
  };

  public func downgrade(_prev_migration_state: MigrationTypes.State, _args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {

    return #v0_0_0(#data);
  };

};