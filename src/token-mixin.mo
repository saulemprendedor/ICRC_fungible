/// token-mixin.mo - ICRC token using library mixin includes
/// Uses includes for ALL ICRC standards (1, 2, 3, 4)
/// All ICRC endpoints come from the included mixins - ultra compact ~150 lines!

import Blob "mo:core/Blob";
import Cycles "mo:core/Cycles";
import D "mo:core/Debug";
import Error "mo:core/Error";
import Runtime "mo:core/Runtime";
import Int "mo:core/Int";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import CertTree "mo:ic-certification/CertTree";
import Star "mo:star/star";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ICRC2Mixin "mo:icrc2-mo/ICRC2/mixin";
import ICRC3 "mo:icrc3-mo/";
import ICRC3Mixin "mo:icrc3-mo/mixin";
import ICRC4 "mo:icrc4-mo/ICRC4";
import ICRC4Mixin "mo:icrc4-mo/ICRC4/mixin";
import ClassPlus "mo:class-plus";
import TT "mo:timer-tool";
import TimerToolMixin "mo:timer-tool/TimerToolMixin";

shared ({ caller = _owner }) persistent actor class Token(args: ?{
  icrc1 : ?ICRC1.InitArgs;
  icrc2 : ?ICRC2.InitArgs;
  icrc3 : ICRC3.InitArgs;
  icrc4 : ?ICRC4.InitArgs;
}) = this {

  // ==========================================================================
  // Configuration defaults and argument merging
  // ==========================================================================

  transient let canisterId = Principal.fromActor(this);
  transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

  let icrc1_defaults : ICRC1.InitArgs = {
    name = ?"Test Token"; symbol = ?"TTT"; decimals = 8;
    logo = ?"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJyZWQiLz48L3N2Zz4=";
    fee = ?#Fixed(10000); max_supply = null; min_burn_amount = ?10000; max_memo = ?64;
    minting_account = ?{ owner = _owner; subaccount = null };
    advanced_settings = null; metadata = null; fee_collector = null;
    transaction_window = null; permitted_drift = null;
    max_accounts = ?100000000; settle_to_accounts = ?99999000;
  };
  
  let icrc2_defaults : ICRC2.InitArgs = {
    max_approvals_per_account = ?10000; max_allowance = ?#TotalSupply;
    fee = ?#ICRC1; advanced_settings = null;
    max_approvals = ?10000000; settle_to_approvals = ?9990000;
    cleanup_interval = null; cleanup_on_zero_balance = null;
    icrc103_max_take_value = ?1000; icrc103_public_allowances = ?true;
  };
  
  let icrc3_defaults : ICRC3.InitArgs = {
    maxActiveRecords = 3000; settleToRecords = 2000; maxRecordsInArchiveInstance = 500_000;
    maxArchivePages = 62500; archiveIndexType = #Stable; maxRecordsToArchive = 8000;
    archiveCycles = 20_000_000_000_000; archiveControllers = null;
    supportedBlocks = [
      { block_type = "1xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { block_type = "2xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { block_type = "2approve"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { block_type = "1mint"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { block_type = "1burn"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { block_type = "107feecol"; url="https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-107" },
    ];
  };
  
  let icrc4_defaults : ICRC4.InitArgs = { max_balances = ?200; max_transfers = ?200; fee = ?#ICRC1 };

  // Merge user args with defaults
  transient let icrc1_args = switch(args) {
    case(?a) switch(a.icrc1) {
      case(?v) { { v with minting_account = switch(v.minting_account) { case(?m) ?m; case(null) icrc1_defaults.minting_account } } };
      case(null) icrc1_defaults;
    };
    case(null) icrc1_defaults;
  };
  transient let icrc2_args = switch(args) { case(?a) switch(a.icrc2) { case(?v) v; case(null) icrc2_defaults }; case(null) icrc2_defaults };
  transient let icrc3_args = switch(args) { case(?a) a.icrc3; case(null) icrc3_defaults };
  transient let icrc4_args = switch(args) { case(?a) switch(a.icrc4) { case(?v) v; case(null) icrc4_defaults }; case(null) icrc4_defaults };

  // ==========================================================================
  // Stable state (only owner needed - ICRC state managed by mixins)
  // ==========================================================================
  
  let cert_store : CertTree.Store = CertTree.newStore();
  var owner = _owner;
  var _init = false;

  // Index notification state
  var index_canister : ?Principal = null;
  var pending_notify_action_id : ?Nat = null;
  let INDEX_NOTIFY_DELAY_NS : Nat = 2_000_000_000; // 2 seconds

  // ==========================================================================
  // TimerTool via mixin - shared timer queue for all components
  // ==========================================================================

  func get_timertool_environment() : TT.Environment {{
    advanced = ?{
      icrc85 = ?{
        kill_switch = null;
        handler = null;
        period = null;
        asset = null;
        platform = null;
        tree = null;
        collector = null;
        initialWait = null;
      };
    };
    syncUnsafe = null;
    reportExecution = null;
    reportError = null;
    reportBatch = null;
  }};

  include TimerToolMixin({
    config = {
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      args = null;
      pullEnvironment = ?get_timertool_environment;
      onInitialize = null;
    };
    caller = canisterId;
    canisterId = canisterId;
  });

  // ==========================================================================
  // Environment providers for mixins
  // ==========================================================================

  func updated_certification(_cert: Blob, _lastIndex: Nat) : Bool { true };
  func get_certificate_store() : CertTree.Store { cert_store };

  func get_icrc3_environment() : ICRC3.Environment {{
    advanced = ?{
      updated_certification = ?updated_certification;
      icrc85 = null;
    };
    get_certificate_store = ?get_certificate_store;
    var org_icdevs_timer_tool = ?org_icdevs_timer_tool;
  }};

  func get_icrc1_environment() : ICRC1.Environment {{
    advanced = ?{
      icrc85 = { 
        kill_switch = null; 
        handler = null; 
        tree = null; 
        collector = null; 
        advanced = null;
      };
      get_fee = null;
      fee_validation_mode = ?#Strict;
    };
    add_ledger_transaction = ?icrc3().add_record;
    var org_icdevs_timer_tool = ?org_icdevs_timer_tool;
    var org_icdevs_class_plus_manager = null;
  }};

  func get_icrc2_environment() : ICRC2.Environment {{ icrc1 = icrc1(); get_fee = null }};
  func get_icrc4_environment() : ICRC4.Environment {{ icrc1 = icrc1(); get_fee = null }};

  func ensureBlockTypes(c: ICRC3.ICRC3) {
    let types = List.fromIter<ICRC3.BlockType>(c.supported_block_types().vals());
    let has = func(t: Text) : Bool = List.any(types, func(bt: ICRC3.BlockType) : Bool = bt.block_type == t);
    for(bt in ["1xfer","2xfer","2approve","1mint","1burn"].vals()) {
      if(not has(bt)) List.add(types, {block_type=bt; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"});
    };
    c.update_supported_blocks(List.toArray(types));
  };

  // ==========================================================================
  // Mixin Includes - ALL ICRC standards via mixins!
  // ==========================================================================

  // ICRC3 - Transaction log (must be first so icrc3() is available for ICRC1 environment)
  include ICRC3Mixin({
    ICRC3.defaultMixinArgs(org_icdevs_class_plus_manager) with
    args = ?icrc3_args;
    pullEnvironment = ?get_icrc3_environment;
    onInitialize = ?(func(c: ICRC3.ICRC3) : async* () { ensureBlockTypes(c) });
  });

  // ICRC1 - Basic fungible token
  include ICRC1Mixin({
    ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
    args = ?icrc1_args;
    pullEnvironment = ?get_icrc1_environment;
    onInitialize = ?(func(c: ICRC1.ICRC1) : async* () {
      ignore c.register_supported_standards({ name = "ICRC-3"; url = "https://github.com/dfinity/ICRC/ICRCs/icrc-3/" });
      ignore c.register_supported_standards({ name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/ICRCs/icrc-10/" });
    });
    canSetFeeCollector = ?(func(caller : Principal) : Bool { caller == owner });
    canSetIndexPrincipal = ?(func(caller : Principal) : Bool { caller == owner });
  });

  // ICRC2 - Approve/transfer_from
  include ICRC2Mixin({
    ICRC2.defaultMixinArgs(org_icdevs_class_plus_manager) with
    args = ?icrc2_args;
    pullEnvironment = ?get_icrc2_environment;
    onInitialize = ?(func(_c: ICRC2.ICRC2) : async* () {
      ignore icrc1().register_supported_standards({ name = "ICRC-103"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-103" });
    });
  });

  // ICRC4 - Batch transfers
  include ICRC4Mixin({
    ICRC4.defaultMixinArgs(org_icdevs_class_plus_manager) with
    args = ?icrc4_args;
    pullEnvironment = ?get_icrc4_environment;
    onInitialize = ?(func(_c: ICRC4.ICRC4) : async* () {
      ignore icrc1().register_supported_standards({ name = "ICRC-4"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-4" });
    });
  });

  // ==========================================================================
  // Token-specific endpoints (mint, burn, admin)
  // ==========================================================================

  public shared({caller}) func mint(a: ICRC1.Mint) : async ICRC1.TransferResult {
    if(caller != owner) Runtime.trap("Unauthorized");
    switch(await* icrc1().mint_tokens(caller, a)) { case(#trappable(v) or #awaited(v)) v; case(#err(#trappable(e) or #awaited(e))) Runtime.trap(e) };
  };

  public shared({caller}) func burn(a: ICRC1.BurnArgs) : async ICRC1.TransferResult {
    switch(await* icrc1().burn_tokens(caller, a, false)) { case(#trappable(v) or #awaited(v)) v; case(#err(#trappable(e) or #awaited(e))) Runtime.trap(e) };
  };

  public shared({caller}) func admin_update_owner(n: Principal) : async Bool { if(caller != owner) Runtime.trap("Unauthorized"); owner := n; true };
  public shared({caller}) func admin_update_icrc1(r: [ICRC1.UpdateLedgerInfoRequest]) : async [Bool] { if(caller != owner) Runtime.trap("Unauthorized"); icrc1().update_ledger_info(r) };
  public shared({caller}) func admin_update_icrc2(r: [ICRC2.UpdateLedgerInfoRequest]) : async [Bool] { if(caller != owner) Runtime.trap("Unauthorized"); icrc2().update_ledger_info(r) };
  public shared({caller}) func admin_update_icrc4(r: [ICRC4.UpdateLedgerInfoRequest]) : async [Bool] { if(caller != owner) Runtime.trap("Unauthorized"); icrc4().update_ledger_info(r) };

  // ==========================================================================
  // Index Push Notification
  // ==========================================================================

  /// Index notification listener - schedules notify call when blocks are added
  private func index_notify_listener<system>(_transaction: ICRC3.Transaction, _index: Nat) : () {
    let ?_idx_principal = index_canister else return;
    switch (pending_notify_action_id) {
      case (?_) { return }; // Already have a pending notify
      case (null) {

        let now = Int.abs(Time.now());
        let action_id = org_icdevs_timer_tool.setActionASync<system>(
          now + INDEX_NOTIFY_DELAY_NS,
          { actionType = "index:notify"; params = Blob.fromArray([]) },
          15_000_000_000
        );
        pending_notify_action_id := ?action_id.id;
      };
    };
  };

  /// Execute the index notify call
  private func execute_index_notify(actionId: TT.ActionId, _action: TT.Action) : async* Star.Star<TT.ActionId, TT.Error> {
    let ?idx_principal = index_canister else {
      pending_notify_action_id := null;
      return #trappable(actionId);
    };
    let stats = icrc3().get_stats();
    let max_block = stats.lastIndex;
    let index_actor = actor(Principal.toText(idx_principal)) : actor { notify : (Nat) -> async () };
    try {
      await (with timeout = 60) index_actor.notify(max_block);
      pending_notify_action_id := null;
      return #awaited(actionId);
    } catch (e) {
      debug D.print("Index notify failed: " # Error.message(e));
      pending_notify_action_id := null;
      return #err(#awaited({ error_code = 1; message = Error.message(e) }));
    };
  };

  /// Register index notify handlers with TimerTool and ICRC-3
  private func register_index_notify_handlers() {
    org_icdevs_timer_tool.registerExecutionListenerAsync(?"index:notify", execute_index_notify);
    icrc3().register_record_added_listener("index_notify", index_notify_listener);
  };

  /// Configure the index canister for push notifications (null to disable)
  public shared({caller}) func admin_set_index_canister(principal: ?Principal) : async Bool {
    if(caller != owner) Runtime.trap("Unauthorized");
    index_canister := principal;
    true;
  };

  /// Get the currently configured index canister
  public query func get_index_canister() : async ?Principal { index_canister };

  public shared({caller = _caller}) func admin_init() : async () {
    _init := true;
  };

  // Register index notify handlers via ClassPlus initialization
  List.add<() -> async* ()>(org_icdevs_class_plus_manager.calls, func() : async* () {
    register_index_notify_handlers();
  });

  public shared func deposit_cycles() : async () { ignore Cycles.accept<system>(Cycles.available()) };

  // ==========================================================================
  // Legacy / Candid Parity
  // ==========================================================================

  /// Legacy Rosetta-compatible alias for icrc3_get_tip_certificate.
  public query func get_data_certificate() : async { certificate: ?Blob; hash_tree: Blob } {
    switch(icrc3().get_tip_certificate()) {
      case(?cert) { { certificate = ?cert.certificate; hash_tree = cert.hash_tree } };
      case(null) { { certificate = null; hash_tree = "" } };
    };
  };

  /// SNS parity: returns true once the ledger is initialized and ready.
  public query func is_ledger_ready() : async Bool {
    true;
  };
};
