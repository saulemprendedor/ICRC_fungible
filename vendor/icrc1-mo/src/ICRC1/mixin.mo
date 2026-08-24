/////////
// ICRC1 Mixin - Standard Token Interface
//
// This mixin provides ICRC-1 token functionality with automatic ICRC-85 OVS integration.
// It uses ClassPlus for proper async initialization.
//
// The mixin exposes `org_icdevs_icrc1_interface` which allows customization of all
// ICRC-1 endpoints through before/after hooks or full replacement.
//
// Guards are included to protect against cycle drain attacks from oversized arguments.
// These guards trap early for inter-canister calls. For ingress protection, use the
// inspect helpers in your main actor's `system func inspect()`.
//
// Usage:
// ```motoko
// import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
// import ICRC1 "mo:icrc1-mo/ICRC1";
// import Interface "mo:icrc1-mo/ICRC1/Interface";
// import ClassPlus "mo:class-plus";
// import Principal "mo:core/Principal";
//
// shared ({ caller = _owner }) persistent actor class MyToken() = this {
//   transient let canisterId = Principal.fromActor(this);
//   transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);
//
//   include ICRC1Mixin({
//     ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
//     args = ?icrc1Args;
//     pullEnvironment = ?getEnvironment;
//   });
//
//   // Access class via icrc1()
//   // Customize via org_icdevs_icrc1_interface
// };
// ```
/////////

import ICRC1 ".";
import Interface "./Interface";
import Inspect "./Inspect";
import Runtime "mo:core/Runtime";

mixin(
  config: ICRC1.MixinFunctionArgs
) {
  
  stable var icrc1_migration_state = ICRC1.initialState();

  transient let icrc1 = ICRC1.Init({
    org_icdevs_class_plus_manager = config.org_icdevs_class_plus_manager;
    initialState = icrc1_migration_state;
    args = config.args;
    pullEnvironment = config.pullEnvironment;
    onInitialize = ?(func(instance : ICRC1.ICRC1) : async* () {
      // Register built-in consent handlers (ICRC-21)
      instance.register_consent_handler("icrc1_transfer", ICRC1.buildTransferConsent);
      instance.register_consent_handler("icrc107_set_fee_collector", ICRC1.buildSetFeeCollectorConsent);

      // Register ICRC-21 supported standard (always available)
      ignore instance.register_supported_standards({
        name = "ICRC-21";
        url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-21";
      });

      // Register ICRC-107 if configured
      switch(config.canSetFeeCollector) {
        case(?_) {
          ignore instance.register_supported_standards({
            name = "ICRC-107";
            url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-107";
          });
        };
        case(null) {};
      };

      // Register ICRC-106 if configured
      switch(config.canSetIndexPrincipal) {
        case(?_) {
          ignore instance.register_supported_standards({
            name = "ICRC-106";
            url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-106";
          });
        };
        case(null) {};
      };

      // Call user's onInitialize
      switch(config.onInitialize) {
        case(?cb) await* cb(instance);
        case(null) {};
      };
    });
    onStorageChange = func(state: ICRC1.State) {
      icrc1_migration_state := state;
    };
  });

  /// The extensible interface for ICRC-1 endpoints
  /// Use this to add before/after hooks or replace implementations
  transient let org_icdevs_icrc1_interface : Interface.ICRC1Interface = Interface.defaultInterface(icrc1);

  /// The canTransfer interceptor from config, used when building TransferContext
  transient let icrc1_canTransfer : ICRC1.CanTransfer = config.canTransfer;

  /// Functions for the ICRC1 token standard
  /// All functions delegate through org_icdevs_icrc1_interface with hook support

  public shared query ({ caller }) func icrc1_name() : async Text {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeName,
      org_icdevs_icrc1_interface.icrc1_name,
      org_icdevs_icrc1_interface.afterName
    );
  };

  public shared query ({ caller }) func icrc1_symbol() : async Text {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeSymbol,
      org_icdevs_icrc1_interface.icrc1_symbol,
      org_icdevs_icrc1_interface.afterSymbol
    );
  };

  public shared query ({ caller }) func icrc1_decimals() : async Nat8 {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeDecimals,
      org_icdevs_icrc1_interface.icrc1_decimals,
      org_icdevs_icrc1_interface.afterDecimals
    );
  };

  public shared query ({ caller }) func icrc1_fee() : async ICRC1.Balance {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeFee,
      org_icdevs_icrc1_interface.icrc1_fee,
      org_icdevs_icrc1_interface.afterFee
    );
  };

  public shared query ({ caller }) func icrc1_metadata() : async [ICRC1.MetaDatum] {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeMetadata,
      org_icdevs_icrc1_interface.icrc1_metadata,
      org_icdevs_icrc1_interface.afterMetadata
    );
  };

  public shared query func get_icrc85_stats() : async { activeActions: Nat; lastActionReported: ?Nat; nextCycleActionId: ?Nat } {
    icrc1().get_icrc85_stats()
  };

  public shared query ({ caller }) func icrc1_total_supply() : async ICRC1.Balance {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeTotalSupply,
      org_icdevs_icrc1_interface.icrc1_total_supply,
      org_icdevs_icrc1_interface.afterTotalSupply
    );
  };

  public shared query ({ caller }) func icrc1_minting_account() : async ?ICRC1.Account {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeMintingAccount,
      org_icdevs_icrc1_interface.icrc1_minting_account,
      org_icdevs_icrc1_interface.afterMintingAccount
    );
  };

  public shared query ({ caller }) func icrc1_balance_of(args : ICRC1.Account) : async ICRC1.Balance {
    // Guard against oversized subaccount (protects inter-canister calls)
    Inspect.guardBalanceOf(args, null);
    
    let ctx = Interface.queryContext<ICRC1.Account>(args, ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeBalanceOf,
      org_icdevs_icrc1_interface.icrc1_balance_of,
      org_icdevs_icrc1_interface.afterBalanceOf
    );
  };

  public shared query ({ caller }) func icrc1_supported_standards() : async [ICRC1.SupportedStandard] {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeSupportedStandards,
      org_icdevs_icrc1_interface.icrc1_supported_standards,
      org_icdevs_icrc1_interface.afterSupportedStandards
    );
  };

  public shared query ({ caller }) func icrc10_supported_standards() : async [ICRC1.SupportedStandard] {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeSupportedStandards,
      org_icdevs_icrc1_interface.icrc1_supported_standards,
      org_icdevs_icrc1_interface.afterSupportedStandards
    );
  };

  public shared ({ caller }) func icrc1_transfer(args : ICRC1.TransferArgs) : async ICRC1.TransferResult {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardTransfer(args, null);
    
    let ctx : Interface.TransferContext = Interface.transferContext(args, caller, icrc1_canTransfer);
    await* Interface.executeTransfer(
      ctx,
      org_icdevs_icrc1_interface.beforeTransfer,
      org_icdevs_icrc1_interface.icrc1_transfer,
      org_icdevs_icrc1_interface.afterTransfer
    );
  };

  // ==========================================================================
  // ICRC-107: Fee Collector Management
  // ==========================================================================

  public shared ({ caller }) func icrc107_set_fee_collector(args : ICRC1.SetFeeCollectorArgs) : async ICRC1.SetFeeCollectorResult {
    Inspect.guardSetFeeCollector(args, null);
    // Check authorization
    switch(config.canSetFeeCollector) {
      case(null) { return #Err(#GenericError({ error_code = 501; message = "ICRC-107 not configured on this ledger" })) };
      case(?check) {
        if (not check(caller)) {
          return #Err(#AccessDenied("Caller is not authorized to set the fee collector"));
        };
      };
    };
    let ctx = Interface.setFeeCollectorContext(args, caller);
    await* Interface.executeSetFeeCollector(
      ctx,
      org_icdevs_icrc1_interface.beforeSetFeeCollector,
      org_icdevs_icrc1_interface.icrc107_set_fee_collector,
      org_icdevs_icrc1_interface.afterSetFeeCollector
    );
  };

  public shared query ({ caller }) func icrc107_get_fee_collector() : async ICRC1.GetFeeCollectorResult {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeGetFeeCollector,
      org_icdevs_icrc1_interface.icrc107_get_fee_collector,
      org_icdevs_icrc1_interface.afterGetFeeCollector
    );
  };

  // ==========================================================================
  // ICRC-106: Index Principal
  // ==========================================================================

  public shared query ({ caller }) func icrc106_get_index_principal() : async ICRC1.Icrc106GetResult {
    let ctx = Interface.queryContext<()>((), ?caller);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeGetIndexPrincipal,
      org_icdevs_icrc1_interface.icrc106_get_index_principal,
      org_icdevs_icrc1_interface.afterGetIndexPrincipal
    );
  };

  public shared ({ caller }) func set_icrc106_index_principal(principal : ?Principal) : async () {
    // Check authorization
    switch(config.canSetIndexPrincipal) {
      case(null) { Runtime.trap("ICRC-106 not configured on this ledger") };
      case(?check) {
        if (not check(caller)) {
          Runtime.trap("Caller is not authorized to set the index principal");
        };
      };
    };
    let ctx = Interface.setIndexPrincipalContext(principal, caller);
    await* Interface.executeSetIndexPrincipal(ctx, org_icdevs_icrc1_interface.set_icrc106_index_principal);
  };

  // ==========================================================================
  // ICRC-21: Consent Messages
  // ==========================================================================

  public shared func icrc21_canister_call_consent_message(request : ICRC1.ConsentMessageRequest) : async ICRC1.ConsentMessageResponse {
    Inspect.guardConsentMessage(request, null);
    let ctx = Interface.queryContext<ICRC1.ConsentMessageRequest>(request, null);
    Interface.executeQuery(
      ctx,
      org_icdevs_icrc1_interface.beforeConsentMessage,
      org_icdevs_icrc1_interface.icrc21_canister_call_consent_message,
      org_icdevs_icrc1_interface.afterConsentMessage
    );
  };
};