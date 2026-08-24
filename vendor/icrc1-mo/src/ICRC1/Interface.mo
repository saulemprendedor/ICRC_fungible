/////////
// ICRC1 Interface - Extensible Hook Pattern
//
// This module provides a standardized interface for ICRC-1 endpoints that supports
// before/after hooks for customization without modifying the core library.
//
// The `org_icdevs_icrc1_interface` allows users to:
// - Override any endpoint implementation
// - Add before hooks that can short-circuit execution
// - Add after hooks that can transform results
//
// Usage in mixin:
// ```motoko
// transient let org_icdevs_icrc1_interface = Interface.defaultInterface(icrc1);
// ```
//
// Usage for customization:
// ```motoko
// // Add validation before transfer
// Interface.addBeforeTransfer(org_icdevs_icrc1_interface, "my-validator", func(ctx) : async* ?ICRC1.TransferResult {
//   if (isBlocked(ctx.caller)) { ?#Err(#GenericError({ error_code = 403; message = "Blocked" })) }
//   else { null }
// });
// ```
/////////

import List "mo:core/List";
import Principal "mo:core/Principal";
import Cycles "mo:core/Cycles";
import Runtime "mo:core/Runtime";

import ICRC1 ".";

module {

  //////////////////////////////////////////
  // TYPES
  //////////////////////////////////////////

  /// Middleware Context for Transfer
  public type TransferContext = {
    args: ICRC1.TransferArgs;
    caller: Principal;
    cycles: ?Nat;
    deadline: ?Nat;
    /// Optional interceptor for validating/modifying transfers before execution
    canTransfer: ICRC1.CanTransfer;
  };

  /// Before hook for Transfer
  public type BeforeTransferHook = (TransferContext) -> async* ?ICRC1.TransferResult;

  /// After hook for Transfer
  public type AfterTransferHook = (TransferContext, ICRC1.TransferResult) -> async* ICRC1.TransferResult;

  /// Middleware Context for SetFeeCollector (ICRC-107)
  public type SetFeeCollectorContext = {
    args: ICRC1.SetFeeCollectorArgs;
    caller: Principal;
  };

  /// Before hook for SetFeeCollector
  public type BeforeSetFeeCollectorHook = (SetFeeCollectorContext) -> async* ?ICRC1.SetFeeCollectorResult;

  /// After hook for SetFeeCollector
  public type AfterSetFeeCollectorHook = (SetFeeCollectorContext, ICRC1.SetFeeCollectorResult) -> async* ICRC1.SetFeeCollectorResult;

  /// Middleware Context for SetIndexPrincipal (ICRC-106)
  public type SetIndexPrincipalContext = {
    args: ?Principal;
    caller: Principal;
  };






  /// Query context - for query functions (no cycles)
  public type QueryContext<T> = {
    args: T;
    caller: ?Principal;  // Optional - queries may not have caller
  };

  /// Before hook for queries (sync, no async*)
  public type QueryBeforeHook<T, R> = (QueryContext<T>) -> ?R;

  /// After hook for queries (sync)
  public type QueryAfterHook<T, R> = (QueryContext<T>, R) -> R;

  //////////////////////////////////////////
  // INTERFACE TYPE
  //////////////////////////////////////////

  /// The extensible ICRC1 interface
  /// All endpoints can be overridden, and hooks can be registered
  public type ICRC1Interface = {
    // Query function implementations
    var icrc1_name : (QueryContext<()>) -> Text;
    var icrc1_symbol : (QueryContext<()>) -> Text;
    var icrc1_decimals : (QueryContext<()>) -> Nat8;
    var icrc1_fee : (QueryContext<()>) -> ICRC1.Balance;
    var icrc1_metadata : (QueryContext<()>) -> [ICRC1.MetaDatum];
    var icrc1_total_supply : (QueryContext<()>) -> ICRC1.Balance;
    var icrc1_minting_account : (QueryContext<()>) -> ?ICRC1.Account;
    var icrc1_balance_of : (QueryContext<ICRC1.Account>) -> ICRC1.Balance;
    var icrc1_supported_standards : (QueryContext<()>) -> [ICRC1.SupportedStandard];

    // Update function implementations
    var icrc1_transfer : (TransferContext) -> async* ICRC1.TransferResult;

    // ICRC-107: Fee Collector
    var icrc107_get_fee_collector : (QueryContext<()>) -> ICRC1.GetFeeCollectorResult;
    var icrc107_set_fee_collector : (SetFeeCollectorContext) -> async* ICRC1.SetFeeCollectorResult;

    // ICRC-106: Index Principal
    var icrc106_get_index_principal : (QueryContext<()>) -> ICRC1.Icrc106GetResult;
    var set_icrc106_index_principal : (SetIndexPrincipalContext) -> async* ();

    // ICRC-21: Consent Messages
    var icrc21_canister_call_consent_message : (QueryContext<ICRC1.ConsentMessageRequest>) -> ICRC1.ConsentMessageResponse;

    // Query hooks (sync)
    var beforeName : List.List<(Text, QueryBeforeHook<(), Text>)>;
    var afterName : List.List<(Text, QueryAfterHook<(), Text>)>;
    var beforeSymbol : List.List<(Text, QueryBeforeHook<(), Text>)>;
    var afterSymbol : List.List<(Text, QueryAfterHook<(), Text>)>;
    var beforeDecimals : List.List<(Text, QueryBeforeHook<(), Nat8>)>;
    var afterDecimals : List.List<(Text, QueryAfterHook<(), Nat8>)>;
    var beforeFee : List.List<(Text, QueryBeforeHook<(), ICRC1.Balance>)>;
    var afterFee : List.List<(Text, QueryAfterHook<(), ICRC1.Balance>)>;
    var beforeMetadata : List.List<(Text, QueryBeforeHook<(), [ICRC1.MetaDatum]>)>;
    var afterMetadata : List.List<(Text, QueryAfterHook<(), [ICRC1.MetaDatum]>)>;
    var beforeTotalSupply : List.List<(Text, QueryBeforeHook<(), ICRC1.Balance>)>;
    var afterTotalSupply : List.List<(Text, QueryAfterHook<(), ICRC1.Balance>)>;
    var beforeMintingAccount : List.List<(Text, QueryBeforeHook<(), ?ICRC1.Account>)>;
    var afterMintingAccount : List.List<(Text, QueryAfterHook<(), ?ICRC1.Account>)>;
    var beforeBalanceOf : List.List<(Text, QueryBeforeHook<ICRC1.Account, ICRC1.Balance>)>;
    var afterBalanceOf : List.List<(Text, QueryAfterHook<ICRC1.Account, ICRC1.Balance>)>;
    var beforeSupportedStandards : List.List<(Text, QueryBeforeHook<(), [ICRC1.SupportedStandard]>)>;
    var afterSupportedStandards : List.List<(Text, QueryAfterHook<(), [ICRC1.SupportedStandard]>)>;

    // Update hooks (async*)
    var beforeTransfer : List.List<(Text, BeforeTransferHook)>;
    var afterTransfer : List.List<(Text, AfterTransferHook)>;

    // ICRC-107 hooks
    var beforeGetFeeCollector : List.List<(Text, QueryBeforeHook<(), ICRC1.GetFeeCollectorResult>)>;
    var afterGetFeeCollector : List.List<(Text, QueryAfterHook<(), ICRC1.GetFeeCollectorResult>)>;
    var beforeSetFeeCollector : List.List<(Text, BeforeSetFeeCollectorHook)>;
    var afterSetFeeCollector : List.List<(Text, AfterSetFeeCollectorHook)>;

    // ICRC-106 hooks
    var beforeGetIndexPrincipal : List.List<(Text, QueryBeforeHook<(), ICRC1.Icrc106GetResult>)>;
    var afterGetIndexPrincipal : List.List<(Text, QueryAfterHook<(), ICRC1.Icrc106GetResult>)>;

    // ICRC-21 hooks
    var beforeConsentMessage : List.List<(Text, QueryBeforeHook<ICRC1.ConsentMessageRequest, ICRC1.ConsentMessageResponse>)>;
    var afterConsentMessage : List.List<(Text, QueryAfterHook<ICRC1.ConsentMessageRequest, ICRC1.ConsentMessageResponse>)>;
  };

  //////////////////////////////////////////
  // FACTORY
  //////////////////////////////////////////

  /// Create a default interface that delegates to the ICRC1 class instance
  public func defaultInterface(getInstance: () -> ICRC1.ICRC1) : ICRC1Interface {
    {
      // Query implementations - delegate to class
      var icrc1_name = func(_ctx: QueryContext<()>) : Text { getInstance().name() };
      var icrc1_symbol = func(_ctx: QueryContext<()>) : Text { getInstance().symbol() };
      var icrc1_decimals = func(_ctx: QueryContext<()>) : Nat8 { getInstance().decimals() };
      var icrc1_fee = func(_ctx: QueryContext<()>) : ICRC1.Balance { getInstance().fee() };
      var icrc1_metadata = func(_ctx: QueryContext<()>) : [ICRC1.MetaDatum] { getInstance().metadata() };
      var icrc1_total_supply = func(_ctx: QueryContext<()>) : ICRC1.Balance { getInstance().total_supply() };
      var icrc1_minting_account = func(_ctx: QueryContext<()>) : ?ICRC1.Account { ?getInstance().minting_account() };
      var icrc1_balance_of = func(ctx: QueryContext<ICRC1.Account>) : ICRC1.Balance { getInstance().balance_of(ctx.args) };
      var icrc1_supported_standards = func(_ctx: QueryContext<()>) : [ICRC1.SupportedStandard] { getInstance().supported_standards() };

      // Update implementations - delegate to class with canTransfer from context
      var icrc1_transfer = func(ctx: TransferContext) : async* ICRC1.TransferResult {
        switch(await* getInstance().transfer_tokens<system>(ctx.caller, ctx.args, false, ctx.canTransfer)) {
          case (#trappable(val)) val;
          case (#awaited(val)) val;
          case (#err(#trappable(err))) Runtime.trap(err);
          case (#err(#awaited(err))) Runtime.trap(err);
        };
      };

      // ICRC-107 implementations
      var icrc107_get_fee_collector = func(_ctx: QueryContext<()>) : ICRC1.GetFeeCollectorResult { getInstance().get_fee_collector() };
      var icrc107_set_fee_collector = func(ctx: SetFeeCollectorContext) : async* ICRC1.SetFeeCollectorResult {
        getInstance().set_fee_collector<system>(ctx.caller, ctx.args);
      };

      // ICRC-106 implementations
      var icrc106_get_index_principal = func(_ctx: QueryContext<()>) : ICRC1.Icrc106GetResult { getInstance().get_icrc106_index_principal() };
      var set_icrc106_index_principal = func(ctx: SetIndexPrincipalContext) : async* () {
        getInstance().set_icrc106_index_principal(ctx.args);
      };

      // ICRC-21 implementation
      var icrc21_canister_call_consent_message = func(ctx: QueryContext<ICRC1.ConsentMessageRequest>) : ICRC1.ConsentMessageResponse {
        getInstance().build_consent_message(ctx.args);
      };

      // Initialize empty hook lists
      var beforeName = List.empty<(Text, QueryBeforeHook<(), Text>)>();
      var afterName = List.empty<(Text, QueryAfterHook<(), Text>)>();
      var beforeSymbol = List.empty<(Text, QueryBeforeHook<(), Text>)>();
      var afterSymbol = List.empty<(Text, QueryAfterHook<(), Text>)>();
      var beforeDecimals = List.empty<(Text, QueryBeforeHook<(), Nat8>)>();
      var afterDecimals = List.empty<(Text, QueryAfterHook<(), Nat8>)>();
      var beforeFee = List.empty<(Text, QueryBeforeHook<(), ICRC1.Balance>)>();
      var afterFee = List.empty<(Text, QueryAfterHook<(), ICRC1.Balance>)>();
      var beforeMetadata = List.empty<(Text, QueryBeforeHook<(), [ICRC1.MetaDatum]>)>();
      var afterMetadata = List.empty<(Text, QueryAfterHook<(), [ICRC1.MetaDatum]>)>();
      var beforeTotalSupply = List.empty<(Text, QueryBeforeHook<(), ICRC1.Balance>)>();
      var afterTotalSupply = List.empty<(Text, QueryAfterHook<(), ICRC1.Balance>)>();
      var beforeMintingAccount = List.empty<(Text, QueryBeforeHook<(), ?ICRC1.Account>)>();
      var afterMintingAccount = List.empty<(Text, QueryAfterHook<(), ?ICRC1.Account>)>();
      var beforeBalanceOf = List.empty<(Text, QueryBeforeHook<ICRC1.Account, ICRC1.Balance>)>();
      var afterBalanceOf = List.empty<(Text, QueryAfterHook<ICRC1.Account, ICRC1.Balance>)>();
      var beforeSupportedStandards = List.empty<(Text, QueryBeforeHook<(), [ICRC1.SupportedStandard]>)>();
      var afterSupportedStandards = List.empty<(Text, QueryAfterHook<(), [ICRC1.SupportedStandard]>)>();
      var beforeTransfer = List.empty<(Text, BeforeTransferHook)>();
      var afterTransfer = List.empty<(Text, AfterTransferHook)>();

      // ICRC-107 hooks
      var beforeGetFeeCollector = List.empty<(Text, QueryBeforeHook<(), ICRC1.GetFeeCollectorResult>)>();
      var afterGetFeeCollector = List.empty<(Text, QueryAfterHook<(), ICRC1.GetFeeCollectorResult>)>();
      var beforeSetFeeCollector = List.empty<(Text, BeforeSetFeeCollectorHook)>();
      var afterSetFeeCollector = List.empty<(Text, AfterSetFeeCollectorHook)>();

      // ICRC-106 hooks
      var beforeGetIndexPrincipal = List.empty<(Text, QueryBeforeHook<(), ICRC1.Icrc106GetResult>)>();
      var afterGetIndexPrincipal = List.empty<(Text, QueryAfterHook<(), ICRC1.Icrc106GetResult>)>();

      // ICRC-21 hooks
      var beforeConsentMessage = List.empty<(Text, QueryBeforeHook<ICRC1.ConsentMessageRequest, ICRC1.ConsentMessageResponse>)>();
      var afterConsentMessage = List.empty<(Text, QueryAfterHook<ICRC1.ConsentMessageRequest, ICRC1.ConsentMessageResponse>)>();
    };
  };

  //////////////////////////////////////////
  // HOOK HELPERS - TRANSFER (async*)
  //////////////////////////////////////////

  /// Add a before-transfer hook
  public func addBeforeTransfer(
    iface: ICRC1Interface,
    id: Text,
    hook: BeforeTransferHook
  ) {
    List.add(iface.beforeTransfer, (id, hook));
  };

  /// Remove a before-transfer hook by id
  public func removeBeforeTransfer(iface: ICRC1Interface, id: Text) {
    let filtered = List.filter<(Text, BeforeTransferHook)>(
      iface.beforeTransfer,
      func(item) { item.0 != id }
    );
    iface.beforeTransfer := filtered;
  };

  /// Add an after-transfer hook
  public func addAfterTransfer(
    iface: ICRC1Interface,
    id: Text,
    hook: AfterTransferHook
  ) {
    List.add(iface.afterTransfer, (id, hook));
  };

  /// Remove an after-transfer hook by id
  public func removeAfterTransfer(iface: ICRC1Interface, id: Text) {
    let filtered = List.filter<(Text, AfterTransferHook)>(
      iface.afterTransfer,
      func(item) { item.0 != id }
    );
    iface.afterTransfer := filtered;
  };

  //////////////////////////////////////////
  // HOOK HELPERS - BALANCE_OF (query)
  //////////////////////////////////////////

  /// Add a before-balance_of hook
  public func addBeforeBalanceOf(
    iface: ICRC1Interface,
    id: Text,
    hook: QueryBeforeHook<ICRC1.Account, ICRC1.Balance>
  ) {
    List.add(iface.beforeBalanceOf, (id, hook));
  };

  /// Remove a before-balance_of hook by id
  public func removeBeforeBalanceOf(iface: ICRC1Interface, id: Text) {
    let filtered = List.filter<(Text, QueryBeforeHook<ICRC1.Account, ICRC1.Balance>)>(
      iface.beforeBalanceOf,
      func(item) { item.0 != id }
    );
    iface.beforeBalanceOf := filtered;
  };

  /// Add an after-balance_of hook
  public func addAfterBalanceOf(
    iface: ICRC1Interface,
    id: Text,
    hook: QueryAfterHook<ICRC1.Account, ICRC1.Balance>
  ) {
    List.add(iface.afterBalanceOf, (id, hook));
  };

  /// Remove an after-balance_of hook by id
  public func removeAfterBalanceOf(iface: ICRC1Interface, id: Text) {
    let filtered = List.filter<(Text, QueryAfterHook<ICRC1.Account, ICRC1.Balance>)>(
      iface.afterBalanceOf,
      func(item) { item.0 != id }
    );
    iface.afterBalanceOf := filtered;
  };

  //////////////////////////////////////////
  // EXECUTION HELPERS
  //////////////////////////////////////////

  /// Execute a query function with before/after hooks
  public func executeQuery<T, R>(
    ctx: QueryContext<T>,
    beforeHooks: List.List<(Text, QueryBeforeHook<T, R>)>,
    impl: (QueryContext<T>) -> R,
    afterHooks: List.List<(Text, QueryAfterHook<T, R>)>
  ) : R {
    // Run before hooks
    for ((_, hook) in List.values(beforeHooks)) {
      switch(hook(ctx)) {
        case(?result) return result;  // Short-circuit
        case(null) {};  // Continue
      };
    };

    // Run main implementation
    var result = impl(ctx);

    // Run after hooks
    for ((_, hook) in List.values(afterHooks)) {
      result := hook(ctx, result);
    };

    result
  };

  /// Execute an update function with before/after hooks
  public func executeTransfer(
    ctx: TransferContext,
    beforeHooks: List.List<(Text, BeforeTransferHook)>,
    impl: (TransferContext) -> async* ICRC1.TransferResult,
    afterHooks: List.List<(Text, AfterTransferHook)>
  ) : async* ICRC1.TransferResult {
    // Run before hooks
    for ((_, hook) in List.values(beforeHooks)) {
      switch(await* hook(ctx)) {
        case(?result) return result;  // Short-circuit
        case(null) {};  // Continue
      };
    };

    // Run main implementation
    var result = await* impl(ctx);

    // Run after hooks
    for ((_, hook) in List.values(afterHooks)) {
      result := await* hook(ctx, result);
    };

    result
  };

  /// Execute set_fee_collector with before/after hooks
  public func executeSetFeeCollector(
    ctx: SetFeeCollectorContext,
    beforeHooks: List.List<(Text, BeforeSetFeeCollectorHook)>,
    impl: (SetFeeCollectorContext) -> async* ICRC1.SetFeeCollectorResult,
    afterHooks: List.List<(Text, AfterSetFeeCollectorHook)>
  ) : async* ICRC1.SetFeeCollectorResult {
    // Run before hooks
    for ((_, hook) in List.values(beforeHooks)) {
      switch(await* hook(ctx)) {
        case(?result) return result;
        case(null) {};
      };
    };

    // Run main implementation
    var result = await* impl(ctx);

    // Run after hooks
    for ((_, hook) in List.values(afterHooks)) {
      result := await* hook(ctx, result);
    };

    result;
  };

  /// Execute set_icrc106_index_principal (async* for consistency, no return value)
  public func executeSetIndexPrincipal(
    ctx: SetIndexPrincipalContext,
    impl: (SetIndexPrincipalContext) -> async* ()
  ) : async* () {
    await* impl(ctx);
  };

  /// Build a SetFeeCollector context
  public func setFeeCollectorContext(args: ICRC1.SetFeeCollectorArgs, caller: Principal) : SetFeeCollectorContext {
    { args = args; caller = caller };
  };

  /// Build a SetIndexPrincipal context
  public func setIndexPrincipalContext(args: ?Principal, caller: Principal) : SetIndexPrincipalContext {
    { args = args; caller = caller };
  };


  //////////////////////////////////////////
  // CONVENIENCE: Build context helpers
  //////////////////////////////////////////

  /// Build a query context (no cycles)
  public func queryContext<T>(args: T, caller: ?Principal) : QueryContext<T> {
    { args = args; caller = caller };
  };

  /// Build a transfer context with cycles and canTransfer
  public func transferContext(args: ICRC1.TransferArgs, caller: Principal, canTransfer: ICRC1.CanTransfer) : TransferContext {
    {
      args = args;
      caller = caller;
      cycles = ?Cycles.available();
      deadline = null;  // Future Motoko feature
      canTransfer = canTransfer;
    };
  };

};
