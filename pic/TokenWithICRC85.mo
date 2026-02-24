/// Token with ICRC-85 cycle sharing enabled for testing
/// This variant of the token has ICRC-85 OVS configured to share cycles
/// with a configurable collector canister.
///
/// NOTE: All ICRC-85 scheduling is handled internally by the ICRC-1 and ICRC-3
/// libraries via TimerTool. This canister creates ONE TimerTool instance and
/// passes it to all components.

import Cycles "mo:core/Cycles";
import D "mo:core/Debug";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import CertTree "mo:ic-certification/CertTree";
import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ICRC3 "mo:icrc3-mo/";
import ICRC4 "mo:icrc4-mo/ICRC4";
import ClassPlus "mo:class-plus";
import TT "mo:timer-tool";

shared ({ caller = _owner }) persistent actor class TokenWithICRC85(args: ?{
    icrc1 : ?ICRC1.InitArgs;
    icrc2 : ?ICRC2.InitArgs;
    icrc3 : ICRC3.InitArgs;
    icrc4 : ?ICRC4.InitArgs;
    icrc85_collector : ?Principal; // The collector canister to send cycles to
  }
) = this {

    transient let Map = ICRC2.CoreMap;
    transient let Set = ICRC2.CoreSet;

    D.print("loading the state - ICRC85 enabled token");
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager(_owner, Principal.fromActor(this), true);

    // Extract ICRC85 collector from args
    transient let icrc85_collector_principal : ?Principal = switch(args) {
      case(?a) a.icrc85_collector;
      case(null) null;
    };

    transient let default_icrc1_args : ICRC1.InitArgs = {
      name = ?"Test Token ICRC85";
      symbol = ?"TT85";
      logo = ?"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9ImdyZWVuIi8+PC9zdmc+";
      decimals = 8;
      fee = ?#Fixed(10000);
      minting_account = ?{ owner = _owner; subaccount = null };
      max_supply = null;
      min_burn_amount = ?10000;
      max_memo = ?64;
      advanced_settings = null;
      metadata = null;
      fee_collector = null;
      transaction_window = null;
      permitted_drift = null;
      max_accounts = ?100000000;
      settle_to_accounts = ?99999000;
    };

    transient let default_icrc2_args : ICRC2.InitArgs = {
      max_approvals_per_account = ?10000;
      max_allowance = ?#TotalSupply;
      fee = ?#ICRC1;
      advanced_settings = null;
      max_approvals = ?10000000;
      settle_to_approvals = ?9990000;
      cleanup_interval = null;
      cleanup_on_zero_balance = null;
      icrc103_max_take_value = ?1000;
      icrc103_public_allowances = ?true;
    };

    transient let default_icrc3_args : ICRC3.InitArgs = {
      maxActiveRecords = 3000;
      settleToRecords = 2000;
      maxRecordsInArchiveInstance = 500_000;
      maxArchivePages = 62500;
      archiveIndexType = #Stable;
      maxRecordsToArchive = 8000;
      archiveCycles = 20_000_000_000_000;
      archiveControllers = null;
      supportedBlocks = [
        { block_type = "1xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
        { block_type = "2xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
        { block_type = "2approve"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
        { block_type = "1mint"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
        { block_type = "1burn"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" }
      ];
    };

    transient let default_icrc4_args : ICRC4.InitArgs = {
      max_balances = ?200;
      max_transfers = ?200;
      fee = ?#ICRC1;
    };

    transient let icrc1_args : ICRC1.InitArgs = switch(args){
      case(null) default_icrc1_args;
      case(?a) switch(a.icrc1) { case(null) default_icrc1_args; case(?val) {
        { val with minting_account = switch(val.minting_account) { case(?v) ?v; case(null) ?{ owner = _owner; subaccount = null } } }
      }};
    };

    transient let icrc2_args : ICRC2.InitArgs = switch(args){ case(null) default_icrc2_args; case(?a) switch(a.icrc2) { case(null) default_icrc2_args; case(?val) val }};
    transient let icrc3_args : ICRC3.InitArgs = switch(args){ case(null) default_icrc3_args; case(?a) switch(?a.icrc3) { case(null) default_icrc3_args; case(?val) val }};
    transient let icrc4_args : ICRC4.InitArgs = switch(args){ case(null) default_icrc4_args; case(?a) switch(a.icrc4) { case(null) default_icrc4_args; case(?val) val }};

    var icrc1_migration_state = ICRC1.initialState();
    var icrc2_migration_state = ICRC2.initialState();
    var icrc4_migration_state = ICRC4.initialState();
    var icrc3_migration_state = ICRC3.initialState();
    let cert_store : CertTree.Store = CertTree.newStore();
    transient let ct = CertTree.Ops(cert_store);

    var owner = _owner;
    
    // TimerTool state - stored in stable memory to survive upgrades
    var tt_state : ?TT.State = null;

    // ONE TimerTool instance shared across all components
    // This is created lazily and passed to ICRC-1, ICRC-3, etc.
    transient var _timerTool : ?TT.TimerTool = null;
    
    func getTimerTool() : TT.TimerTool {
      switch(_timerTool) {
        case(?tt) tt;
        case(null) {
          // Create TimerTool with ICRC-85 environment for its own cycle sharing
          let ttEnv : TT.Environment = {
            advanced = switch(icrc85_collector_principal) {
              case(?collector) ?{
                icrc85 = ?{
                  kill_switch = null;
                  handler = null;
                  period = null;
                  asset = null;
                  platform = null;
                  tree = null;
                  collector = ?collector;
                  initialWait = null;
                };
              };
              case(null) null;
            };
            syncUnsafe = null;
            reportExecution = null;
            reportError = null;
            reportBatch = null;
          };
          
          let newTT = TT.TimerTool(
            tt_state,                       // stored state
            Principal.fromActor(this),      // caller
            Principal.fromActor(this),      // canister
            null,                           // args
            ?ttEnv,                         // environment with ICRC-85
            func(newState: TT.State) {
              tt_state := ?newState;
            }
          );
          _timerTool := ?newTT;
          newTT;
        };
      };
    };

    func updated_certification(_cert: Blob, _lastIndex: Nat) : Bool { true };
    func get_certificate_store() : CertTree.Store { cert_store };

    // ICRC3 is defined first since ICRC1 environment references it
    func get_icrc3_environment() : ICRC3.Environment {
      { 
        advanced = ?{
          updated_certification = ?updated_certification;
          icrc85 = ?{
            var org_icdevs_timer_tool = ?getTimerTool();
            var collector = icrc85_collector_principal;
            advanced = null;
          };
        };
        get_certificate_store = ?get_certificate_store;
        var org_icdevs_timer_tool = ?getTimerTool();
      };
    };

    transient let icrc3_getter = ICRC3.Init({
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      initialState = icrc3_migration_state;
      args = ?icrc3_args;
      pullEnvironment = ?get_icrc3_environment;
      onInitialize = ?(func(newClass: ICRC3.ICRC3) : async*() {
        let types = List.fromIter<ICRC3.BlockType>(newClass.supported_block_types().vals());
        let hasBlockType = func(t: Text) : Bool {
          List.any<ICRC3.BlockType>(types, func(bt) = bt.block_type == t)
        };
        for(bt in ["1xfer","2xfer","2approve","1mint","1burn"].vals()) {
          if(not hasBlockType(bt)) List.add(types, {block_type = bt; url = "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"});
        };
        newClass.update_supported_blocks(List.toArray(types));
      });
      onStorageChange = func(state: ICRC3.State) { icrc3_migration_state := state };
    });

    func icrc3() : ICRC3.ICRC3 { icrc3_getter() };

    // Now ICRC1 can reference icrc3
    func get_icrc1_environment() : ICRC1.Environment {
      {
        advanced = ?{
          icrc85 = {
            kill_switch = null;
            handler = null;
            tree = null;
            collector = icrc85_collector_principal;
            advanced = null;
          };
          get_fee = null;
          fee_validation_mode = ?#Strict;
        };
        add_ledger_transaction = ?icrc3().add_record;
        var org_icdevs_timer_tool = ?getTimerTool();
        var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
      }
    };

    transient let icrc1_getter = ICRC1.Init({
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      initialState = icrc1_migration_state;
      args = ?icrc1_args;
      pullEnvironment = ?get_icrc1_environment;
      onInitialize = ?(func(newClass: ICRC1.ICRC1) : async*() {
        ignore newClass.register_supported_standards({ name = "ICRC-3"; url = "https://github.com/dfinity/ICRC/ICRCs/icrc-3/" });
        ignore newClass.register_supported_standards({ name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/ICRCs/icrc-10/" });
        ignore newClass.register_supported_standards({ name = "ICRC-85"; url = "https://github.com/dfinity/ICRC/ICRCs/icrc-85/" });
      });
      onStorageChange = func(state: ICRC1.State) { icrc1_migration_state := state };
    });

    func icrc1() : ICRC1.ICRC1 { icrc1_getter() };

    func get_icrc2_environment() : ICRC2.Environment {
      { icrc1 = icrc1(); get_fee = null }
    };

    transient let icrc2_getter = ICRC2.Init({
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      initialState = icrc2_migration_state;
      args = ?icrc2_args;
      pullEnvironment = ?get_icrc2_environment;
      onInitialize = null;
      onStorageChange = func(state: ICRC2.State) { icrc2_migration_state := state };
    });

    func icrc2() : ICRC2.ICRC2 { icrc2_getter() };

    func get_icrc4_environment() : ICRC4.Environment {
      { icrc1 = icrc1(); get_fee = null }
    };

    transient let icrc4_getter = ICRC4.Init({
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      initialState = icrc4_migration_state;
      args = ?icrc4_args;
      pullEnvironment = ?get_icrc4_environment;
      onInitialize = null;
      onStorageChange = func(state: ICRC4.State) { icrc4_migration_state := state };
    });

    func icrc4() : ICRC4.ICRC4 { icrc4_getter() };

    // ====== ICRC-1 Endpoints ======
    public query func icrc1_name() : async Text { icrc1().name() };
    public query func icrc1_symbol() : async Text { icrc1().symbol() };
    public query func icrc1_decimals() : async Nat8 { icrc1().decimals() };
    public query func icrc1_fee() : async ICRC1.Balance { icrc1().fee() };
    public query func icrc1_metadata() : async [ICRC1.MetaDatum] { icrc1().metadata() };
    public query func icrc1_total_supply() : async ICRC1.Balance { icrc1().total_supply() };
    public query func icrc1_minting_account() : async ?ICRC1.Account { ?icrc1().minting_account() };
    public query func icrc1_balance_of(account: ICRC1.Account) : async ICRC1.Balance { icrc1().balance_of(account) };
    public query func icrc1_supported_standards() : async [ICRC1.SupportedStandard] { icrc1().supported_standards() };
    
    public shared(msg) func icrc1_transfer(args: ICRC1.TransferArgs) : async ICRC1.TransferResult {
      switch(await* icrc1().transfer_tokens(msg.caller, args, false, null)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      }
    };

    // ====== ICRC-2 Endpoints ======
    public query func icrc2_allowance(args: ICRC2.AllowanceArgs) : async ICRC2.Allowance { icrc2().allowance(args.spender, args.account, false) };
    
    public shared(msg) func icrc2_approve(args: ICRC2.ApproveArgs) : async ICRC2.ApproveResponse {
      switch(await* icrc2().approve_transfers(msg.caller, args, false, null)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      }
    };

    public shared(msg) func icrc2_transfer_from(args: ICRC2.TransferFromArgs) : async ICRC2.TransferFromResponse {
      switch(await* icrc2().transfer_tokens_from(msg.caller, args, null)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      }
    };

    // ====== ICRC-3 Endpoints ======
    public query func icrc3_get_blocks(args: ICRC3.GetBlocksArgs) : async ICRC3.GetBlocksResult { icrc3().get_blocks(args) };
    public query func icrc3_get_archives(args: ICRC3.GetArchivesArgs) : async ICRC3.GetArchivesResult { icrc3().get_archives(args) };
    public query func icrc3_get_tip_certificate() : async ?ICRC3.DataCertificate { icrc3().get_tip_certificate() };
    public query func icrc3_supported_block_types() : async [ICRC3.BlockType] { icrc3().supported_block_types() };
    public query func get_tip() : async ICRC3.Tip { icrc3().get_tip() };

    // ====== ICRC-4 Endpoints ======
    public query func icrc4_balance_of_batch(args: ICRC4.BalanceQueryArgs) : async ICRC4.BalanceQueryResult { icrc4().balance_of_batch(args) };
    public query func icrc4_maximum_update_batch_size() : async ?Nat { ?icrc4().get_state().ledger_info.max_transfers };
    public query func icrc4_maximum_query_batch_size() : async ?Nat { ?icrc4().get_state().ledger_info.max_balances };

    public shared(msg) func icrc4_transfer_batch(args: ICRC4.TransferBatchArgs) : async ICRC4.TransferBatchResults {
      switch(await* icrc4().transfer_batch_tokens(msg.caller, args, null, null)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) err;
        case(#err(#awaited(err))) err;
      }
    };

    // ====== ICRC-85 Endpoints ======
    public query func get_icrc85_stats() : async { activeActions: Nat; lastActionReported: ?Nat; nextCycleActionId: ?Nat } {
      icrc1().get_icrc85_stats()
    };

    // Get ICRC-3 ICRC-85 stats
    public query func get_icrc3_icrc85_stats() : async { activeActions: Nat; lastActionReported: ?Nat; nextCycleActionId: ?Nat } {
      icrc3().get_icrc85_stats()
    };

    // Note: ICRC-85 cycle sharing is now handled automatically by OVSFixed through ClassPlus.
    // These manual trigger functions are no longer needed but kept for backwards compatibility.
    // They will no-op since OVS handles the scheduling internally.
    
    public func trigger_icrc85_share<system>() : async () {
      // OVS-fixed now handles ICRC-85 internally - this is a no-op
      D.print("ICRC-85 cycle sharing is now automatic via OVS-fixed ClassPlus");
    };

    // Trigger only ICRC-3 share (no-op - handled by OVS)
    public func trigger_icrc3_share<system>() : async () {
      D.print("ICRC-85 cycle sharing is now automatic via OVS-fixed ClassPlus");
    };

    // ====== ICRC-85 Timer Initialization ======
    // ICRC-85 timers are now auto-initialized via OVSFixed.Init ClassPlus pattern.
    
    public func init_icrc85_timer<system>() : async () {
      D.print("ICRC-85 timers are auto-initialized via OVSFixed.Init ClassPlus pattern - no manual init needed");
    };
    
    // Get current cycle balance
    public query func get_cycles_balance() : async Nat {
      Cycles.balance()
    };

    // ====== Admin Endpoints ======
    public shared(msg) func mint(args: ICRC1.Mint) : async ICRC1.TransferResult {
      if(msg.caller != owner) Runtime.trap("Unauthorized");
      switch(await* icrc1().mint_tokens(msg.caller, args)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      }
    };

    public shared(msg) func burn(args: ICRC1.BurnArgs) : async ICRC1.TransferResult {
      switch(await* icrc1().burn_tokens(msg.caller, args, false)) {
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      }
    };

    public shared(msg) func admin_update_owner(new_owner: Principal) : async Bool {
      if(msg.caller != owner) Runtime.trap("Unauthorized");
      owner := new_owner;
      true
    };

    public query func get_owner() : async Principal { owner };

    public func deposit_cycles<system>() : async () {
      let amount = Cycles.available();
      let _accepted = Cycles.accept<system>(amount);
    };
};
