///Test canister for ICRC2 Index verification
///Exposes internal indexes for testing spender_to_approval_account correctness

import Cycles "mo:core/Cycles";
import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";
import Map "mo:core/Map";
import Set "mo:core/Set";
import Iter "mo:core/Iter";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";

import ICRC2Mixin "../mixin";
import ICRC2 "..";

shared ({ caller = _owner }) persistent actor class IndexTestToken (
    init_args : ICRC1.InitArgs,
    icrc2_args : ICRC2.InitArgs,
) = this {

    transient let canisterId = Principal.fromActor(this);
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

    private func get_icrc1_environment() : ICRC1.Environment {
      {
        advanced = null;
        add_ledger_transaction = null;
        var org_icdevs_timer_tool = null;
        var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
      };
    };

    include ICRC1Mixin({
      ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?init_args;
      pullEnvironment = ?get_icrc1_environment;
    });

    private func get_icrc2_environment() : ICRC2.Environment {
      {
        icrc1 = icrc1();
        get_fee = null; 
      };
    };

    include ICRC2Mixin({
      ICRC2.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc2_args;
      pullEnvironment = ?get_icrc2_environment;
    });

    //////////////////////////////////////////
    // INDEX TEST FUNCTIONS
    //////////////////////////////////////////

    /// Type for returning index entry information
    public type IndexEntry = {
        key: ICRC2.Account;
        values: [ICRC2.Account];
    };

    /// Type for returning full index state
    public type IndexState = {
        owner_to_approval_account: [IndexEntry];
        spender_to_approval_account: [IndexEntry];
    };

    /// Get the full index state for testing
    public query func getIndexState() : async IndexState {
        let indexes = icrc2().get_indexes();
        
        let ownerEntries = Iter.toArray(
            Iter.map<(ICRC2.Account, Set.Set<ICRC2.Account>), IndexEntry>(
                Map.entries(indexes.owner_to_approval_account),
                func((key, valueSet)) : IndexEntry {
                    {
                        key = key;
                        values = Set.toArray(valueSet);
                    };
                }
            )
        );
        
        let spenderEntries = Iter.toArray(
            Iter.map<(ICRC2.Account, Set.Set<ICRC2.Account>), IndexEntry>(
                Map.entries(indexes.spender_to_approval_account),
                func((key, valueSet)) : IndexEntry {
                    {
                        key = key;
                        values = Set.toArray(valueSet);
                    };
                }
            )
        );
        
        {
            owner_to_approval_account = ownerEntries;
            spender_to_approval_account = spenderEntries;
        };
    };

    /// Check if a specific spender has an entry in spender_to_approval_account index
    /// Returns the accounts that have approved this spender (if any)
    public query func getApproversForSpender(spender: ICRC2.Account) : async [ICRC2.Account] {
        let indexes = icrc2().get_indexes();
        switch(Map.get(indexes.spender_to_approval_account, ICRC2.account_compare, spender)) {
            case(?approverSet) Set.toArray(approverSet);
            case(null) [];
        };
    };

    /// Check if a specific owner has an entry in owner_to_approval_account index  
    /// Returns the spenders this owner has approved (if any)
    public query func getSpendersForOwner(owner: ICRC2.Account) : async [ICRC2.Account] {
        let indexes = icrc2().get_indexes();
        switch(Map.get(indexes.owner_to_approval_account, ICRC2.account_compare, owner)) {
            case(?spenderSet) Set.toArray(spenderSet);
            case(null) [];
        };
    };

    /// Get index sizes for quick verification
    public query func getIndexSizes() : async {
        owner_to_approval_account_size: Nat;
        spender_to_approval_account_size: Nat;
        token_approvals_count: Nat;
    } {
        let stats = icrc2().get_stats();
        {
            owner_to_approval_account_size = stats.indexes.owner_to_approval_account_count;
            spender_to_approval_account_size = stats.indexes.spender_to_approval_account_count;
            token_approvals_count = stats.token_approvals_count;
        };
    };

    /// Mint new tokens (only minting account can call)
    public shared ({ caller }) func mint(args : ICRC1.Mint) : async ICRC1.TransferResult {
        await* icrc1().mint(caller, args);
    };

    // Deposit cycles into this canister.
    public shared func deposit_cycles() : async () {
        let amount = Cycles.available();
        let accepted = Cycles.accept<system>(amount);
        assert (accepted == amount);
    };
};
