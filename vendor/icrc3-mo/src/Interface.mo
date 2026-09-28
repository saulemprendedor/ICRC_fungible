import ICRC3 ".";
import List "mo:core/List";
import Legacy "legacy";

module {

  // ==========================================
  // CONTEXT TYPES
  // ==========================================

  public type QueryContext<T> = {
    args: T;
    caller: ?Principal;
  };

  // ==========================================
  // HOOK TYPES
  // ==========================================

  public type QueryBeforeHook<T, R> = (QueryContext<T>) -> ?R;
  public type QueryAfterHook<T, R> = (QueryContext<T>, R) -> R;

  // ==========================================
  // INTERFACE DEFINITION
  // ==========================================

  public type ICRC3Interface = {
    // Standard ICRC-3
    var icrc3_get_blocks : (QueryContext<ICRC3.GetBlocksArgs>) -> ICRC3.GetBlocksResult;
    var beforeGetBlocks : List.List<(Text, QueryBeforeHook<ICRC3.GetBlocksArgs, ICRC3.GetBlocksResult>)>;
    var afterGetBlocks : List.List<(Text, QueryAfterHook<ICRC3.GetBlocksArgs, ICRC3.GetBlocksResult>)>;

    var icrc3_get_archives : (QueryContext<ICRC3.GetArchivesArgs>) -> ICRC3.GetArchivesResult;
    var beforeGetArchives : List.List<(Text, QueryBeforeHook<ICRC3.GetArchivesArgs, ICRC3.GetArchivesResult>)>;
    var afterGetArchives : List.List<(Text, QueryAfterHook<ICRC3.GetArchivesArgs, ICRC3.GetArchivesResult>)>;

    var icrc3_get_tip_certificate : (QueryContext<()>) -> ?ICRC3.DataCertificate;
    var beforeGetTipCertificate : List.List<(Text, QueryBeforeHook<(), ?ICRC3.DataCertificate>)>;
    var afterGetTipCertificate : List.List<(Text, QueryAfterHook<(), ?ICRC3.DataCertificate>)>;

    var icrc3_supported_block_types : (QueryContext<()>) -> [ICRC3.BlockType];
    var beforeSupportedBlockTypes : List.List<(Text, QueryBeforeHook<(), [ICRC3.BlockType]>)>;
    var afterSupportedBlockTypes : List.List<(Text, QueryAfterHook<(), [ICRC3.BlockType]>)>;

    var get_tip : (QueryContext<()>) -> ICRC3.Tip;
    var beforeGetTip : List.List<(Text, QueryBeforeHook<(), ICRC3.Tip>)>;
    var afterGetTip : List.List<(Text, QueryAfterHook<(), ICRC3.Tip>)>;

    // Legacy / Rosetta
    var get_blocks : (QueryContext<{ start : Nat; length : Nat }>) -> Legacy.RosettaGetBlocksResponse;
    var beforeLegacyGetBlocks : List.List<(Text, QueryBeforeHook<{ start : Nat; length : Nat }, Legacy.RosettaGetBlocksResponse>)>;
    var afterLegacyGetBlocks : List.List<(Text, QueryAfterHook<{ start : Nat; length : Nat }, Legacy.RosettaGetBlocksResponse>)>;

    var get_transactions : (QueryContext<{ start : Nat; length : Nat }>) -> Legacy.GetTransactionsResponse;
    var beforeLegacyGetTransactions : List.List<(Text, QueryBeforeHook<{ start : Nat; length : Nat }, Legacy.GetTransactionsResponse>)>;
    var afterLegacyGetTransactions : List.List<(Text, QueryAfterHook<{ start : Nat; length : Nat }, Legacy.GetTransactionsResponse>)>;
  };

  // ==========================================
  // CONSTRUCTORS & HELPERS
  // ==========================================

  class DefaultImplementation(icrc3 : () -> ICRC3.ICRC3) {

    public func icrc3_get_blocks(ctx : QueryContext<ICRC3.GetBlocksArgs>) : ICRC3.GetBlocksResult {
      icrc3().get_blocks(ctx.args)
    };

    public func icrc3_get_archives(ctx : QueryContext<ICRC3.GetArchivesArgs>) : ICRC3.GetArchivesResult {
      icrc3().get_archives(ctx.args)
    };

    public func icrc3_get_tip_certificate(_ : QueryContext<()>) : ?ICRC3.DataCertificate {
      icrc3().get_tip_certificate()
    };

    public func icrc3_supported_block_types(_ : QueryContext<()>) : [ICRC3.BlockType] {
      icrc3().supported_block_types()
    };

    public func get_tip(_ : QueryContext<()>) : ICRC3.Tip {
      icrc3().get_tip()
    };

    public func get_blocks(ctx : QueryContext<{ start : Nat; length : Nat }>) : Legacy.RosettaGetBlocksResponse {
      icrc3().get_blocks_rosetta(ctx.args)
    };

    public func get_transactions(ctx : QueryContext<{ start : Nat; length : Nat }>) : Legacy.GetTransactionsResponse {
       let results = icrc3().get_blocks_legacy(ctx.args);
       {
          first_index = results.first_index;
          log_length = results.log_length;
          transactions = results.transactions;
          archived_transactions = results.archived_transactions;
       }
    };
  };

  public func defaultInterface(icrc3 : () -> ICRC3.ICRC3) : ICRC3Interface {
    let impl = DefaultImplementation(icrc3);
    {
      var icrc3_get_blocks = impl.icrc3_get_blocks;
      var icrc3_get_archives = impl.icrc3_get_archives;
      var icrc3_get_tip_certificate = impl.icrc3_get_tip_certificate;
      var icrc3_supported_block_types = impl.icrc3_supported_block_types;
      var get_tip = impl.get_tip;
      var get_blocks = impl.get_blocks;
      var get_transactions = impl.get_transactions;

      var beforeGetBlocks = List.empty();
      var afterGetBlocks = List.empty();

      var beforeGetArchives = List.empty();
      var afterGetArchives = List.empty();

      var beforeGetTipCertificate = List.empty();
      var afterGetTipCertificate = List.empty();

      var beforeSupportedBlockTypes = List.empty();
      var afterSupportedBlockTypes = List.empty();

      var beforeGetTip = List.empty();
      var afterGetTip = List.empty();

      var beforeLegacyGetBlocks = List.empty();
      var afterLegacyGetBlocks = List.empty();

      var beforeLegacyGetTransactions = List.empty();
      var afterLegacyGetTransactions = List.empty();
    }
  };

  public func executeQuery<T, R>(
    ctx: QueryContext<T>,
    beforeHooks: List.List<(Text, QueryBeforeHook<T, R>)>,
    impl: (QueryContext<T>) -> R,
    afterHooks: List.List<(Text, QueryAfterHook<T, R>)>
  ) : R {
    // Run before hooks
    for ((_, hook) in List.values(beforeHooks)) {
      switch(hook(ctx)) {
        case(?result) return result;
        case(null) {};
      };
    };

    // Run implementation
    var result = impl(ctx);

    // Run after hooks
    for ((_, hook) in List.values(afterHooks)) {
      result := hook(ctx, result);
    };

    result
  };

  public func queryContext<T>(args: T, caller: ?Principal) : QueryContext<T> {
    { args = args; caller = caller };
  };

  // Helper
  func removeHelper<T>(list: List.List<(Text, T)>, name: Text) : List.List<(Text, T)> {
    let new = List.empty<(Text, T)>();
    for ((n, h) in List.values(list)) {
      if (n != name) {
        List.add(new, (n, h));
      };
    };
    new
  };

  // Helper factories - GetBlocks
  public func addBeforeGetBlocks(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<ICRC3.GetBlocksArgs, ICRC3.GetBlocksResult>) {
    List.add(iface.beforeGetBlocks, (name, hook));
  };
  public func removeBeforeGetBlocks(iface: ICRC3Interface, name: Text) {
    iface.beforeGetBlocks := removeHelper(iface.beforeGetBlocks, name);
  };
  public func addAfterGetBlocks(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<ICRC3.GetBlocksArgs, ICRC3.GetBlocksResult>) {
    List.add(iface.afterGetBlocks, (name, hook));
  };
  public func removeAfterGetBlocks(iface: ICRC3Interface, name: Text) {
    iface.afterGetBlocks := removeHelper(iface.afterGetBlocks, name);
  };

  // Helper factories - GetArchives
  public func addBeforeGetArchives(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<ICRC3.GetArchivesArgs, ICRC3.GetArchivesResult>) {
    List.add(iface.beforeGetArchives, (name, hook));
  };
  public func removeBeforeGetArchives(iface: ICRC3Interface, name: Text) {
    iface.beforeGetArchives := removeHelper(iface.beforeGetArchives, name);
  };
  public func addAfterGetArchives(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<ICRC3.GetArchivesArgs, ICRC3.GetArchivesResult>) {
    List.add(iface.afterGetArchives, (name, hook));
  };
  public func removeAfterGetArchives(iface: ICRC3Interface, name: Text) {
    iface.afterGetArchives := removeHelper(iface.afterGetArchives, name);
  };

  // Helper factories - GetTipCertificate
  public func addBeforeGetTipCertificate(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<(), ?ICRC3.DataCertificate>) {
    List.add(iface.beforeGetTipCertificate, (name, hook));
  };
  public func removeBeforeGetTipCertificate(iface: ICRC3Interface, name: Text) {
    iface.beforeGetTipCertificate := removeHelper(iface.beforeGetTipCertificate, name);
  };
  public func addAfterGetTipCertificate(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<(), ?ICRC3.DataCertificate>) {
    List.add(iface.afterGetTipCertificate, (name, hook));
  };
  public func removeAfterGetTipCertificate(iface: ICRC3Interface, name: Text) {
    iface.afterGetTipCertificate := removeHelper(iface.afterGetTipCertificate, name);
  };

  // Helper factories - SupportedBlockTypes
  public func addBeforeSupportedBlockTypes(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<(), [ICRC3.BlockType]>) {
    List.add(iface.beforeSupportedBlockTypes, (name, hook));
  };
  public func removeBeforeSupportedBlockTypes(iface: ICRC3Interface, name: Text) {
    iface.beforeSupportedBlockTypes := removeHelper(iface.beforeSupportedBlockTypes, name);
  };
  public func addAfterSupportedBlockTypes(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<(), [ICRC3.BlockType]>) {
    List.add(iface.afterSupportedBlockTypes, (name, hook));
  };
  public func removeAfterSupportedBlockTypes(iface: ICRC3Interface, name: Text) {
    iface.afterSupportedBlockTypes := removeHelper(iface.afterSupportedBlockTypes, name);
  };

  // Helper factories - GetTip
  public func addBeforeGetTip(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<(), ICRC3.Tip>) {
    List.add(iface.beforeGetTip, (name, hook));
  };
  public func removeBeforeGetTip(iface: ICRC3Interface, name: Text) {
    iface.beforeGetTip := removeHelper(iface.beforeGetTip, name);
  };
  public func addAfterGetTip(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<(), ICRC3.Tip>) {
    List.add(iface.afterGetTip, (name, hook));
  };
  public func removeAfterGetTip(iface: ICRC3Interface, name: Text) {
    iface.afterGetTip := removeHelper(iface.afterGetTip, name);
  };

  // Helper factories - LegacyGetBlocks
  public func addBeforeLegacyGetBlocks(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<{ start : Nat; length : Nat }, Legacy.RosettaGetBlocksResponse>) {
    List.add(iface.beforeLegacyGetBlocks, (name, hook));
  };
  public func removeBeforeLegacyGetBlocks(iface: ICRC3Interface, name: Text) {
    iface.beforeLegacyGetBlocks := removeHelper(iface.beforeLegacyGetBlocks, name);
  };
  public func addAfterLegacyGetBlocks(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<{ start : Nat; length : Nat }, Legacy.RosettaGetBlocksResponse>) {
    List.add(iface.afterLegacyGetBlocks, (name, hook));
  };
  public func removeAfterLegacyGetBlocks(iface: ICRC3Interface, name: Text) {
    iface.afterLegacyGetBlocks := removeHelper(iface.afterLegacyGetBlocks, name);
  };

  // Helper factories - LegacyGetTransactions
  public func addBeforeLegacyGetTransactions(iface: ICRC3Interface, name: Text, hook: QueryBeforeHook<{ start : Nat; length : Nat }, Legacy.GetTransactionsResponse>) {
    List.add(iface.beforeLegacyGetTransactions, (name, hook));
  };
  public func removeBeforeLegacyGetTransactions(iface: ICRC3Interface, name: Text) {
    iface.beforeLegacyGetTransactions := removeHelper(iface.beforeLegacyGetTransactions, name);
  };
  public func addAfterLegacyGetTransactions(iface: ICRC3Interface, name: Text, hook: QueryAfterHook<{ start : Nat; length : Nat }, Legacy.GetTransactionsResponse>) {
    List.add(iface.afterLegacyGetTransactions, (name, hook));
  };
  public func removeAfterLegacyGetTransactions(iface: ICRC3Interface, name: Text) {
    iface.afterLegacyGetTransactions := removeHelper(iface.afterLegacyGetTransactions, name);
  };
};
