import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import Principal "mo:core/Principal";
import Option "mo:core/Option";

import Map "mo:core/Map";
import Set "mo:core/Set";

import MigrationTypes "../types";
import v0_1_0 "../v000_001_000/types";
import v0_2_0 "types";

module {
  
  type Account = v0_2_0.Account;
  type ApprovalInfo = v0_2_0.ApprovalInfo;
  type State = v0_2_0.State;

  public func upgrade(prevmigration_state: MigrationTypes.State, args: MigrationTypes.Args, caller: Principal): MigrationTypes.State {

    let prev = switch(prevmigration_state) {
      case (#v0_1_0(#data(state))) state;
      case (#v0_2_0(_)) Runtime.trap("Already at v0_2_0");
      case (_) Runtime.trap("Invalid upgrade state");
    };
    
    // Parse args
    let initArgs : v0_2_0.InitArgs = switch(args) { 
        case(?a) a; 
        case(null) {
            { 
                 max_approvals_per_account = null; 
                 max_allowance = null;
                 fee = null;
                 advanced_settings = null;
                 max_approvals = null;
                 settle_to_approvals = null;
                 cleanup_interval = null;
                 cleanup_on_zero_balance = null;
                 icrc103_max_take_value = null;
                 icrc103_public_allowances = null;
             }
        }
    };

    // Rebuild Token Approvals
    let tokenApprovalEntries = Map.entries(prev.token_approvals);
    let newTokenApprovals = Map.fromIter<(Account, Account), ApprovalInfo>(
      tokenApprovalEntries,
      v0_2_0.approval_compare
    );

    // Rebuild Indexes
    func migrateSet(oldSet: v0_1_0.Set.Set<v0_1_0.Account>) : Set.Set<Account> {
        let keys = Map.keys(oldSet); // v0_1_0.Set is Map
        Set.fromIter<Account>(keys, v0_2_0.account_compare)
    };
    
    // Spender index
    let spenderEntryIter = Map.entries(prev.indexes.spender_to_approval_account);
    let spenderEntries = Iter.map<(Account, v0_1_0.Set.Set<Account>), (Account, Set.Set<Account>)>(
        spenderEntryIter,
        func ((acc, oldSet)) {
             (acc, migrateSet(oldSet))
        }
    );
    let newSpenderToApprovalAccount = Map.fromIter<Account, Set.Set<Account>>(
        spenderEntries,
        v0_2_0.account_compare
    );

    // Owner index
    let ownerEntryIter = Map.entries(prev.indexes.owner_to_approval_account);
    let ownerEntries = Iter.map<(Account, v0_1_0.Set.Set<(Account)>), (Account, Set.Set<Account>)>(
        ownerEntryIter,
        func ((acc, oldSet)) {
             (acc, migrateSet(oldSet))
        }
    );
    let newOwnerToApprovalAccount = Map.fromIter<Account, Set.Set<Account>>(
        ownerEntries,
        v0_2_0.account_compare
    );

    let state : v0_2_0.State = {
      ledger_info = {
        var max_approvals_per_account = prev.ledger_info.max_approvals_per_account;
        var max_approvals = prev.ledger_info.max_approvals;
        var max_allowance = prev.ledger_info.max_allowance;
        var settle_to_approvals = prev.ledger_info.settle_to_approvals;
        var fee = prev.ledger_info.fee;
        var metadata = prev.ledger_info.metadata;
        var cleanup_interval = initArgs.cleanup_interval;
        var cleanup_on_zero_balance = initArgs.cleanup_on_zero_balance;
        var icrc103_max_take_value = Option.get(initArgs.icrc103_max_take_value, 1000);
        var icrc103_public_allowances = Option.get(initArgs.icrc103_public_allowances, true);
      };
      token_approvals = newTokenApprovals;
      indexes = {
        spender_to_approval_account = newSpenderToApprovalAccount;
        owner_to_approval_account = newOwnerToApprovalAccount;
      };
    };

    #v0_2_0(#data(state));
  };
  
  public func downgrade(prev_migration_state: MigrationTypes.State, args: MigrationTypes.Args, caller: Principal): MigrationTypes.State {
      Runtime.trap("Downgrade not supported");
  };

};
