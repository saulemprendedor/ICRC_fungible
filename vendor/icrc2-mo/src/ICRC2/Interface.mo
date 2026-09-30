import ICRC2 ".";
import List "mo:core/List";
import Cycles "mo:core/Cycles";
import Service "service"; 
import Runtime "mo:core/Runtime";

module {
  // ==========================================
  // CONTEXT TYPES
  // ==========================================

  public type ApproveContext = {
    args: ICRC2.ApproveArgs;
    caller: Principal;
    cycles: ?Nat;
    deadline: ?Nat;
  };

  public type TransferFromContext = {
    args: ICRC2.TransferFromArgs;
    caller: Principal;
    cycles: ?Nat;
    deadline: ?Nat;
  };

  public type QueryContext<T> = {
    args: T;
    caller: ?Principal;
  };

  // ==========================================
  // HOOK TYPES
  // ==========================================

  public type BeforeApproveHook = (ApproveContext) -> async* ?ICRC2.ApproveResponse;
  public type AfterApproveHook = (ApproveContext, ICRC2.ApproveResponse) -> async* ICRC2.ApproveResponse;

  public type BeforeTransferFromHook = (TransferFromContext) -> async* ?ICRC2.TransferFromResponse;
  public type AfterTransferFromHook = (TransferFromContext, ICRC2.TransferFromResponse) -> async* ICRC2.TransferFromResponse;

  public type QueryBeforeHook<T, R> = (QueryContext<T>) -> ?R;
  public type QueryAfterHook<T, R> = (QueryContext<T>, R) -> R;

  // ==========================================
  // INTERFACE DEFINITION
  // ==========================================

  public type ICRC2Interface = {
    // Approve
    var approve : (ApproveContext) -> async* ICRC2.ApproveResponse;
    var beforeApprove : List.List<(Text, BeforeApproveHook)>;
    var afterApprove : List.List<(Text, AfterApproveHook)>;

    // TransferFrom
    var transfer_from : (TransferFromContext) -> async* ICRC2.TransferFromResponse;
    var beforeTransferFrom : List.List<(Text, BeforeTransferFromHook)>;
    var afterTransferFrom : List.List<(Text, AfterTransferFromHook)>;

    // Queries
    var icrc2_allowance : (QueryContext<ICRC2.AllowanceArgs>) -> ICRC2.Allowance;
    var beforeAllowance : List.List<(Text, QueryBeforeHook<ICRC2.AllowanceArgs, ICRC2.Allowance>)>;
    var afterAllowance : List.List<(Text, QueryAfterHook<ICRC2.AllowanceArgs, ICRC2.Allowance>)>;

    var icrc103_get_allowances : (QueryContext<ICRC2.GetAllowancesArgs>) -> Service.AllowanceResult;
    var beforeGetAllowances103 : List.List<(Text, QueryBeforeHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>)>;
    var afterGetAllowances103 : List.List<(Text, QueryAfterHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>)>;

    var icrc130_get_allowances : (QueryContext<Service.GetAllowancesArgs>) -> Service.AllowanceResult;
    var beforeGetAllowances130 : List.List<(Text, QueryBeforeHook<Service.GetAllowancesArgs, Service.AllowanceResult>)>;
    var afterGetAllowances130 : List.List<(Text, QueryAfterHook<Service.GetAllowancesArgs, Service.AllowanceResult>)>;
  };

  // ==========================================
  // CONSTRUCTORS
  // ==========================================

  public func defaultInterface(icrc2 : () -> ICRC2.ICRC2) : ICRC2Interface {
    {
      var approve = func(ctx: ApproveContext) : async* ICRC2.ApproveResponse {
        await* icrc2().approve(ctx.caller, ctx.args);
      };
      
      var transfer_from = func(ctx: TransferFromContext) : async* ICRC2.TransferFromResponse {
        await* icrc2().transfer_from(ctx.caller, ctx.args);
      };

      var icrc2_allowance = func(ctx: QueryContext<ICRC2.AllowanceArgs>) : ICRC2.Allowance {
        icrc2().allowance(ctx.args.spender, ctx.args.account, false) 
      };

      var icrc103_get_allowances = func(ctx: QueryContext<ICRC2.GetAllowancesArgs>) : Service.AllowanceResult {
        switch(ctx.caller) {
            case(?p) icrc2().getAllowances(p, ctx.args);
            case(null) args_error("Caller required for get_allowances");
        }
      };
      
      var icrc130_get_allowances = func(ctx: QueryContext<Service.GetAllowancesArgs>) : Service.AllowanceResult {
          switch(ctx.caller) {
            case(?p) icrc2().getAllowances(p, ctx.args);
            case(null) args_error("Caller required for get_allowances"); 
        }
      };

      var beforeApprove = List.empty<(Text, BeforeApproveHook)>();
      var afterApprove = List.empty<(Text, AfterApproveHook)>();
      
      var beforeTransferFrom = List.empty<(Text, BeforeTransferFromHook)>();
      var afterTransferFrom = List.empty<(Text, AfterTransferFromHook)>();

      var beforeAllowance = List.empty<(Text, QueryBeforeHook<ICRC2.AllowanceArgs, ICRC2.Allowance>)>();
      var afterAllowance = List.empty<(Text, QueryAfterHook<ICRC2.AllowanceArgs, ICRC2.Allowance>)>();

      var beforeGetAllowances103 = List.empty<(Text, QueryBeforeHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>)>();
      var afterGetAllowances103 = List.empty<(Text, QueryAfterHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>)>();

      var beforeGetAllowances130 = List.empty<(Text, QueryBeforeHook<Service.GetAllowancesArgs, Service.AllowanceResult>)>();
      var afterGetAllowances130 = List.empty<(Text, QueryAfterHook<Service.GetAllowancesArgs, Service.AllowanceResult>)>();
    }
  };
  
  func args_error<T>(msg: Text) : T {
      Runtime.trap(msg)
  };

  // ==========================================
  // EXECUTION ENGINES
  // ==========================================

  public func executeQuery<T, R>(
    ctx: QueryContext<T>,
    beforeHooks: List.List<(Text, QueryBeforeHook<T, R>)>,
    impl: (QueryContext<T>) -> R,
    afterHooks: List.List<(Text, QueryAfterHook<T, R>)>
  ) : R {
    for ((_, hook) in List.values(beforeHooks)) {
      switch(hook(ctx)) {
        case(?result) return result;
        case(null) {};
      };
    };

    var result = impl(ctx);

    for ((_, hook) in List.values(afterHooks)) {
      result := hook(ctx, result);
    };

    result
  };

  public func executeApprove(
    ctx: ApproveContext,
    beforeHooks: List.List<(Text, BeforeApproveHook)>,
    impl: (ApproveContext) -> async* ICRC2.ApproveResponse,
    afterHooks: List.List<(Text, AfterApproveHook)>
  ) : async* ICRC2.ApproveResponse {
    
    for ((_, hook) in List.values(beforeHooks)) {
      switch(await* hook(ctx)) {
        case(?result) return result;
        case(null) {};
      };
    };

    var result = await* impl(ctx);

    for ((_, hook) in List.values(afterHooks)) {
      result := await* hook(ctx, result);
    };

    result
  };

  public func executeTransferFrom(
    ctx: TransferFromContext,
    beforeHooks: List.List<(Text, BeforeTransferFromHook)>,
    impl: (TransferFromContext) -> async* ICRC2.TransferFromResponse,
    afterHooks: List.List<(Text, AfterTransferFromHook)>
  ) : async* ICRC2.TransferFromResponse {
    for ((_, hook) in List.values(beforeHooks)) {
      switch(await* hook(ctx)) {
        case(?result) return result;
        case(null) {};
      };
    };

    var result = await* impl(ctx);

    for ((_, hook) in List.values(afterHooks)) {
      result := await* hook(ctx, result);
    };
    result
  };

  // ==========================================
  // FACTORIES & HELPERS
  // ==========================================
  
  public func queryContext<T>(args: T, caller: ?Principal) : QueryContext<T> { { args; caller } };
  public func approveContext(args: ICRC2.ApproveArgs, caller: Principal) : ApproveContext {
    {
      args = args;
      caller = caller;
      cycles = ?Cycles.available();
      deadline = null;
    }
  };
  public func transferFromContext(args: ICRC2.TransferFromArgs, caller: Principal) : TransferFromContext {
    {
      args = args;
      caller = caller;
      cycles = ?Cycles.available();
      deadline = null;
    }
  };

  func removeHelper<T>(list: List.List<(Text, T)>, name: Text) : List.List<(Text, T)> {
    let new = List.empty<(Text, T)>();
    for ((n, h) in List.values(list)) {
      if (n != name) {
        List.add(new, (n, h));
      };
    };
    new
  };

  public func addBeforeApprove(iface: ICRC2Interface, name: Text, hook: BeforeApproveHook) {
    List.add(iface.beforeApprove, (name, hook));
  };
  public func removeBeforeApprove(iface: ICRC2Interface, name: Text) {
    iface.beforeApprove := removeHelper(iface.beforeApprove, name);
  };
  
  public func addAfterApprove(iface: ICRC2Interface, name: Text, hook: AfterApproveHook) {
    List.add(iface.afterApprove, (name, hook));
  };
  public func removeAfterApprove(iface: ICRC2Interface, name: Text) {
    iface.afterApprove := removeHelper(iface.afterApprove, name);
  };

  public func addBeforeTransferFrom(iface: ICRC2Interface, name: Text, hook: BeforeTransferFromHook) {
    List.add(iface.beforeTransferFrom, (name, hook));
  };
  public func removeBeforeTransferFrom(iface: ICRC2Interface, name: Text) {
    iface.beforeTransferFrom := removeHelper(iface.beforeTransferFrom, name);
  };
  
  public func addAfterTransferFrom(iface: ICRC2Interface, name: Text, hook: AfterTransferFromHook) {
    List.add(iface.afterTransferFrom, (name, hook));
  };
  public func removeAfterTransferFrom(iface: ICRC2Interface, name: Text) {
    iface.afterTransferFrom := removeHelper(iface.afterTransferFrom, name);
  };

  // ==========================================
  // HOOK HELPERS - Allowance Query
  // ==========================================

  public func addBeforeAllowance(iface: ICRC2Interface, name: Text, hook: QueryBeforeHook<ICRC2.AllowanceArgs, ICRC2.Allowance>) {
    List.add(iface.beforeAllowance, (name, hook));
  };
  public func removeBeforeAllowance(iface: ICRC2Interface, name: Text) {
    iface.beforeAllowance := removeHelper(iface.beforeAllowance, name);
  };
  public func addAfterAllowance(iface: ICRC2Interface, name: Text, hook: QueryAfterHook<ICRC2.AllowanceArgs, ICRC2.Allowance>) {
    List.add(iface.afterAllowance, (name, hook));
  };
  public func removeAfterAllowance(iface: ICRC2Interface, name: Text) {
    iface.afterAllowance := removeHelper(iface.afterAllowance, name);
  };

  // ==========================================
  // HOOK HELPERS - GetAllowances103 Query
  // ==========================================

  public func addBeforeGetAllowances103(iface: ICRC2Interface, name: Text, hook: QueryBeforeHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>) {
    List.add(iface.beforeGetAllowances103, (name, hook));
  };
  public func removeBeforeGetAllowances103(iface: ICRC2Interface, name: Text) {
    iface.beforeGetAllowances103 := removeHelper(iface.beforeGetAllowances103, name);
  };
  public func addAfterGetAllowances103(iface: ICRC2Interface, name: Text, hook: QueryAfterHook<ICRC2.GetAllowancesArgs, Service.AllowanceResult>) {
    List.add(iface.afterGetAllowances103, (name, hook));
  };
  public func removeAfterGetAllowances103(iface: ICRC2Interface, name: Text) {
    iface.afterGetAllowances103 := removeHelper(iface.afterGetAllowances103, name);
  };

  // ==========================================
  // HOOK HELPERS - GetAllowances130 Query
  // ==========================================

  public func addBeforeGetAllowances130(iface: ICRC2Interface, name: Text, hook: QueryBeforeHook<Service.GetAllowancesArgs, Service.AllowanceResult>) {
    List.add(iface.beforeGetAllowances130, (name, hook));
  };
  public func removeBeforeGetAllowances130(iface: ICRC2Interface, name: Text) {
    iface.beforeGetAllowances130 := removeHelper(iface.beforeGetAllowances130, name);
  };
  public func addAfterGetAllowances130(iface: ICRC2Interface, name: Text, hook: QueryAfterHook<Service.GetAllowancesArgs, Service.AllowanceResult>) {
    List.add(iface.afterGetAllowances130, (name, hook));
  };
  public func removeAfterGetAllowances130(iface: ICRC2Interface, name: Text) {
    iface.afterGetAllowances130 := removeHelper(iface.afterGetAllowances130, name);
  };
};
