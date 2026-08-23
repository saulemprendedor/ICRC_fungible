///Test canister for ICRC1 Interface hooks
///Tests before/after hooks and implementation overrides

import Cycles "mo:core/Cycles";
import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Text "mo:core/Text";

import ICRC1Mixin "../mixin";
import ICRC1 "..";
import Interface "../Interface";

shared ({ caller = _owner }) persistent actor class InterfaceTestToken (
    init_args : ICRC1.InitArgs,
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

    include ICRC1Mixin({ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?init_args;
      pullEnvironment = ?get_icrc1_environment;
      onInitialize = null;
    });

    //////////////////////////////////////////
    // TEST STATE - Tracks hook invocations
    //////////////////////////////////////////

    // Transfer hook tracking
    stable var beforeTransferCallCount : Nat = 0;
    stable var afterTransferCallCount : Nat = 0;
    stable var lastTransferCaller : ?Principal = null;
    stable var lastTransferAmount : ?Nat = null;
    stable var blockedPrincipals : List.List<Principal> = List.empty<Principal>();
    stable var transferFeeOverride : ?Nat = null;

    // Query hook tracking  
    stable var beforeBalanceOfCallCount : Nat = 0;
    stable var afterBalanceOfCallCount : Nat = 0;
    stable var balanceMultiplier : Nat = 1;
    stable var beforeNameCallCount : Nat = 0;
    stable var nameOverride : ?Text = null;

    //////////////////////////////////////////
    // HOOK SETUP FUNCTIONS
    //////////////////////////////////////////

    /// Enable before-transfer hook that blocks certain principals
    public shared func enableTransferBlockingHook() : async () {
      Interface.addBeforeTransfer(org_icdevs_icrc1_interface, "blocker", func(ctx: Interface.TransferContext) : async* ?ICRC1.TransferResult {
        beforeTransferCallCount += 1;
        lastTransferCaller := ?ctx.caller;
        lastTransferAmount := ?ctx.args.amount;
        
        // Check if caller is blocked
        for (blocked in List.values(blockedPrincipals)) {
          if (Principal.equal(blocked, ctx.caller)) {
            return ?#Err(#GenericError({ error_code = 403; message = "Principal is blocked" }));
          };
        };
        null  // Continue to original
      });
    };

    /// Enable after-transfer hook that tracks completions
    public shared func enableTransferTrackingHook() : async () {
      Interface.addAfterTransfer(org_icdevs_icrc1_interface, "tracker", func(ctx: Interface.TransferContext, result: ICRC1.TransferResult) : async* ICRC1.TransferResult {
        afterTransferCallCount += 1;
        result  // Pass through unchanged
      });
    };

    /// Enable before-balance hook that tracks calls
    public shared func enableBalanceTrackingHook() : async () {
      Interface.addBeforeBalanceOf(org_icdevs_icrc1_interface, "tracker", func(_ctx) : ?ICRC1.Balance {
        beforeBalanceOfCallCount += 1;
        null  // Continue to original
      });
    };

    /// Enable after-balance hook that multiplies balances
    public shared func enableBalanceMultiplierHook() : async () {
      Interface.addAfterBalanceOf(org_icdevs_icrc1_interface, "multiplier", func(_ctx, balance) : ICRC1.Balance {
        afterBalanceOfCallCount += 1;
        balance * balanceMultiplier
      });
    };

    /// Enable name override hook
    public shared func enableNameOverrideHook() : async () {
      Interface.addBeforeBalanceOf(org_icdevs_icrc1_interface, "name-tracker", func(_ctx) : ?ICRC1.Balance {
        beforeNameCallCount += 1;
        null
      });
      
      // Override the name function entirely
      let originalName = org_icdevs_icrc1_interface.icrc1_name;
      org_icdevs_icrc1_interface.icrc1_name := func(ctx) : Text {
        beforeNameCallCount += 1;
        switch(nameOverride) {
          case(?override) override;
          case(null) originalName(ctx);
        };
      };
    };

    /// Remove all hooks
    public shared func removeAllHooks() : async () {
      Interface.removeBeforeTransfer(org_icdevs_icrc1_interface, "blocker");
      Interface.removeAfterTransfer(org_icdevs_icrc1_interface, "tracker");
      Interface.removeBeforeBalanceOf(org_icdevs_icrc1_interface, "tracker");
      Interface.removeAfterBalanceOf(org_icdevs_icrc1_interface, "multiplier");
      Interface.removeBeforeBalanceOf(org_icdevs_icrc1_interface, "name-tracker");
    };

    //////////////////////////////////////////
    // TEST CONFIGURATION FUNCTIONS
    //////////////////////////////////////////

    /// Add a principal to the block list
    public shared func blockPrincipal(p : Principal) : async () {
      List.add(blockedPrincipals, p);
    };

    /// Remove a principal from the block list
    public shared func unblockPrincipal(p : Principal) : async () {
      blockedPrincipals := List.filter<Principal>(blockedPrincipals, func(item) { not Principal.equal(item, p) });
    };

    /// Set the balance multiplier for the after hook
    public shared func setBalanceMultiplier(mult : Nat) : async () {
      balanceMultiplier := mult;
    };

    /// Set a name override
    public shared func setNameOverride(name : ?Text) : async () {
      nameOverride := name;
    };

    /// Reset all hook counters
    public shared func resetCounters() : async () {
      beforeTransferCallCount := 0;
      afterTransferCallCount := 0;
      lastTransferCaller := null;
      lastTransferAmount := null;
      beforeBalanceOfCallCount := 0;
      afterBalanceOfCallCount := 0;
      beforeNameCallCount := 0;
    };

    //////////////////////////////////////////
    // TEST QUERY FUNCTIONS
    //////////////////////////////////////////

    /// Get all hook statistics
    public shared query func getHookStats() : async {
      beforeTransferCallCount : Nat;
      afterTransferCallCount : Nat;
      lastTransferCaller : ?Principal;
      lastTransferAmount : ?Nat;
      beforeBalanceOfCallCount : Nat;
      afterBalanceOfCallCount : Nat;
      beforeNameCallCount : Nat;
      balanceMultiplier : Nat;
    } {
      {
        beforeTransferCallCount = beforeTransferCallCount;
        afterTransferCallCount = afterTransferCallCount;
        lastTransferCaller = lastTransferCaller;
        lastTransferAmount = lastTransferAmount;
        beforeBalanceOfCallCount = beforeBalanceOfCallCount;
        afterBalanceOfCallCount = afterBalanceOfCallCount;
        beforeNameCallCount = beforeNameCallCount;
        balanceMultiplier = balanceMultiplier;
      }
    };

    /// Check if a principal is blocked
    public shared query func isBlocked(p : Principal) : async Bool {
      for (blocked in List.values(blockedPrincipals)) {
        if (Principal.equal(blocked, p)) return true;
      };
      false
    };

    //////////////////////////////////////////
    // STANDARD FUNCTIONS (for testing)
    //////////////////////////////////////////

    public shared ({ caller }) func mint(args : ICRC1.Mint) : async ICRC1.TransferResult {
        await* icrc1().mint(caller, args);
    };

    public shared ({ caller }) func burn(args : ICRC1.BurnArgs) : async ICRC1.TransferResult {
        await* icrc1().burn(caller, args);
    };

    public shared func deposit_cycles() : async () {
        let amount = Cycles.available();
        let accepted = Cycles.accept<system>(amount);
        assert (accepted == amount);
    };
};
