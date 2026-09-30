///Test canister for ICRC2 Interface hooks
///Tests before/after hooks for approve and transfer_from

import Cycles "mo:core/Cycles";
import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Text "mo:core/Text";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";

import ICRC2Mixin "../mixin";
import ICRC2 "..";
import Interface "../Interface";

shared ({ caller = _owner }) persistent actor class InterfaceTestToken (
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
    // TEST STATE - Tracks hook invocations
    //////////////////////////////////////////

    // Approve hook tracking
    stable var beforeApproveCallCount : Nat = 0;
    stable var afterApproveCallCount : Nat = 0;
    stable var lastApproveCaller : ?Principal = null;
    stable var lastApproveAmount : ?Nat = null;
    stable var lastApproveSpender : ?Principal = null;

    // TransferFrom hook tracking
    stable var beforeTransferFromCallCount : Nat = 0;
    stable var afterTransferFromCallCount : Nat = 0;
    stable var blockedSpenders : List.List<Principal> = List.empty<Principal>();

    //////////////////////////////////////////
    // HOOK SETUP FUNCTIONS
    //////////////////////////////////////////

    /// Enable before-approve hook
    public shared func enableApproveTrackingHook() : async () {
      Interface.addBeforeApprove(org_icdevs_icrc2_interface, "tracker", func(ctx: Interface.ApproveContext) : async* ?ICRC2.ApproveResponse {
        beforeApproveCallCount += 1;
        lastApproveCaller := ?ctx.caller;
        // ICRC2.ApproveArgs : { from_subaccount : ?Subaccount; spender : Account; amount : Nat; ... }
        lastApproveAmount := ?ctx.args.amount;
        lastApproveSpender := ?ctx.args.spender.owner;
        null 
      });
    };

    /// Enable after-approve hook
    public shared func enableApproveMultiplierHook() : async () {
       // Just tracking calls here, can't really multiply the result (Ok/Err)
       Interface.addAfterApprove(org_icdevs_icrc2_interface, "tracker", func(ctx: Interface.ApproveContext, result: ICRC2.ApproveResponse) : async* ICRC2.ApproveResponse {
         afterApproveCallCount += 1;
         result 
       });
    };

    /// Enable before-transfer-from hook that blocks certain spenders
    public shared func enableTransferFromBlockingHook() : async () {
       Interface.addBeforeTransferFrom(org_icdevs_icrc2_interface, "blocker", func(ctx: Interface.TransferFromContext) : async* ?ICRC2.TransferFromResponse {
         beforeTransferFromCallCount += 1;
         
         // Check if caller is blocked (spender)
         for (blocked in List.values(blockedSpenders)) {
           if (Principal.equal(blocked, ctx.caller)) {
              return ?#Err(#GenericError({ error_code = 403; message = "Spender is blocked" }));
           };
         };
         null
       });
    };

    /// Enable after-transfer-from hook
    public shared func enableTransferFromTrackingHook() : async () {
      Interface.addAfterTransferFrom(org_icdevs_icrc2_interface, "tracker", func(ctx: Interface.TransferFromContext, result: ICRC2.TransferFromResponse) : async* ICRC2.TransferFromResponse {
        afterTransferFromCallCount += 1;
        result
      });
    };

    /// Remove all hooks
    public shared func removeAllHooks() : async () {
      Interface.removeBeforeApprove(org_icdevs_icrc2_interface, "tracker");
      Interface.removeAfterApprove(org_icdevs_icrc2_interface, "tracker");
      Interface.removeBeforeTransferFrom(org_icdevs_icrc2_interface, "blocker");
      Interface.removeAfterTransferFrom(org_icdevs_icrc2_interface, "tracker");
    };

    //////////////////////////////////////////
    // TEST CONFIGURATION FUNCTIONS
    //////////////////////////////////////////

    public shared func blockSpender(p : Principal) : async () {
      List.add(blockedSpenders, p);
    };

    public shared func unblockSpender(p : Principal) : async () {
      blockedSpenders := List.filter<Principal>(blockedSpenders, func(item) { not Principal.equal(item, p) });
    };

    public shared func resetCounters() : async () {
      beforeApproveCallCount := 0;
      afterApproveCallCount := 0;
      lastApproveCaller := null;
      lastApproveAmount := null;
      lastApproveSpender := null;
      beforeTransferFromCallCount := 0;
      afterTransferFromCallCount := 0;
    };

    //////////////////////////////////////////
    // TEST QUERY FUNCTIONS
    //////////////////////////////////////////

    public shared query func getHookStats() : async {
      beforeApproveCallCount : Nat;
      afterApproveCallCount : Nat;
      lastApproveCaller : ?Principal;
      lastApproveAmount : ?Nat;
      lastApproveSpender : ?Principal;
      beforeTransferFromCallCount : Nat;
      afterTransferFromCallCount : Nat;
    } {
      {
        beforeApproveCallCount = beforeApproveCallCount;
        afterApproveCallCount = afterApproveCallCount;
        lastApproveCaller = lastApproveCaller;
        lastApproveAmount = lastApproveAmount;
        lastApproveSpender = lastApproveSpender;
        beforeTransferFromCallCount = beforeTransferFromCallCount;
        afterTransferFromCallCount = afterTransferFromCallCount;
      }
    };

};
