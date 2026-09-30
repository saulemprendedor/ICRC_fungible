/////////
// ICRC2 Mixin - Token Approval Interface
//
// This mixin provides ICRC-2 approval functionality for ICRC-1 tokens.
// It uses ClassPlus for proper async initialization.
//
// Guards are included to protect against cycle drain attacks from oversized arguments.
// These guards trap early for inter-canister calls. For ingress protection, use the
// inspect helpers in your main actor's `system func inspect()`.
//
// Usage:
// ```motoko
// import ICRC2Mixin "mo:icrc2-mo/ICRC2/mixin";
// import ICRC2 "mo:icrc2-mo/ICRC2";
// import ClassPlus "mo:class-plus";
// import Principal "mo:core/Principal";
//
// shared ({ caller = _owner }) persistent actor class MyToken() = this {
//   transient let canisterId = Principal.fromActor(this);
//   transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);
//
//   include ICRC2Mixin({
//     ICRC2.defaultMixinArgs(org_icdevs_class_plus_manager) with
//     args = ?icrc2Args;
//     pullEnvironment = ?getEnvironment;
//   });
//
//   // Access via icrc2()
// };
// ```
/////////

import ICRC2 ".";
import Service "service";
import Interface "./Interface";
import Inspect "./Inspect";
import Runtime "mo:core/Runtime";

mixin(
  config: ICRC2.MixinFunctionArgs
) {
  
  stable var icrc2_migration_state = ICRC2.initialState();

  // ==========================================================================
  // ICRC-21 Consent Builders — delegated to public functions in ICRC2/lib.mo
  // ==========================================================================

  // Use ICRC2.Init which handles ClassPlus registration internally
  transient let icrc2 = ICRC2.Init({
    org_icdevs_class_plus_manager = config.org_icdevs_class_plus_manager;
    initialState = icrc2_migration_state;
    args = config.args;
    pullEnvironment = config.pullEnvironment;
    onInitialize = ?(func(instance: ICRC2.ICRC2) : async* () {
      // Register ICRC-21 consent handlers for ICRC-2 methods
      instance.environment.icrc1.register_consent_handler("icrc2_approve", ICRC2.buildApproveConsent);
      instance.environment.icrc1.register_consent_handler("icrc2_transfer_from", ICRC2.buildTransferFromConsent);

      // Call user's onInitialize
      switch(config.onInitialize) {
        case(?cb) await* cb(instance);
        case(null) {};
      };
    });
    onStorageChange = func(state: ICRC2.State) {
      icrc2_migration_state := state;
    };
  });

  /// The extensible interface for ICRC-2 endpoints
  transient let org_icdevs_icrc2_interface : Interface.ICRC2Interface = Interface.defaultInterface(icrc2);

  // Override approve implementation to use canApprove interceptor from config
  org_icdevs_icrc2_interface.approve := func(ctx: Interface.ApproveContext) : async* ICRC2.ApproveResponse {
    switch(await* icrc2().approve_transfers(ctx.caller, ctx.args, false, config.canApprove)){
      case(#trappable(val)) val;
      case(#awaited(val)) val;
      case(#err(#trappable(err))) Runtime.trap(err);
      case(#err(#awaited(err))) Runtime.trap(err);
    };
  };

  // Override transfer_from implementation to use canTransferFrom interceptor from config
  org_icdevs_icrc2_interface.transfer_from := func(ctx: Interface.TransferFromContext) : async* ICRC2.TransferFromResponse {
    switch(await* icrc2().transfer_tokens_from<system>(ctx.caller, ctx.args, config.canTransferFrom)){
      case(#trappable(val)) val;
      case(#awaited(val)) val;
      case(#err(#trappable(err))) Runtime.trap(err);
      case(#err(#awaited(err))) Runtime.trap(err);
    };
  };

  public query func icrc2_allowance(allowanceArgs: ICRC2.AllowanceArgs) : async ICRC2.Allowance {
    // Guard against oversized subaccounts (protects inter-canister calls)
    Inspect.guardAllowance(allowanceArgs, null);
    
    let ctx = Interface.queryContext<ICRC2.AllowanceArgs>(allowanceArgs, null);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc2_interface.beforeAllowance,
      org_icdevs_icrc2_interface.icrc2_allowance,
      org_icdevs_icrc2_interface.afterAllowance
    );
  };

  public shared ({ caller }) func icrc2_approve(approveArgs: ICRC2.ApproveArgs) : async ICRC2.ApproveResponse {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardApprove(approveArgs, null);
    
    let ctx = Interface.approveContext(approveArgs, caller);
    await* Interface.executeApprove(
      ctx,
      org_icdevs_icrc2_interface.beforeApprove,
      org_icdevs_icrc2_interface.approve,
      org_icdevs_icrc2_interface.afterApprove
    );
  };

  public shared ({ caller }) func icrc2_transfer_from(transferArgs: ICRC2.TransferFromArgs) : async ICRC2.TransferFromResponse {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardTransferFrom(transferArgs, null);
    
    let ctx = Interface.transferFromContext(transferArgs, caller);
    await* Interface.executeTransferFrom(
      ctx,
      org_icdevs_icrc2_interface.beforeTransferFrom,
      org_icdevs_icrc2_interface.transfer_from,
      org_icdevs_icrc2_interface.afterTransferFrom
    );
  };

  public query ({ caller }) func icrc103_get_allowances(getAllowArgs: ICRC2.GetAllowancesArgs) : async Service.AllowanceResult {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardGetAllowances(getAllowArgs, null);
    
    let ctx = Interface.queryContext<ICRC2.GetAllowancesArgs>(getAllowArgs, ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc2_interface.beforeGetAllowances103,
      org_icdevs_icrc2_interface.icrc103_get_allowances,
      org_icdevs_icrc2_interface.afterGetAllowances103
    );
  };

  public query ({ caller }) func icrc130_get_allowances(getAllowArgs: Service.GetAllowancesArgs) : async Service.AllowanceResult {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardGetAllowances(getAllowArgs, null);
    
    let ctx = Interface.queryContext<Service.GetAllowancesArgs>(getAllowArgs, ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc2_interface.beforeGetAllowances130,
      org_icdevs_icrc2_interface.icrc130_get_allowances,
      org_icdevs_icrc2_interface.afterGetAllowances130
    );
  };

  /// Get statistics about the ICRC-2 ledger state
  public query func icrc2_get_stats() : async ICRC2.Stats {
    icrc2().get_stats();
  };

};
