import Cycles "mo:core/Cycles";
import D "mo:core/Debug";
import Error "mo:core/Error";
import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
//import Time "mo:core/Time";
import Timer "mo:core/Timer";

//import CertifiedData "mo:core/CertifiedData";
import CertTree "mo:ic-certification/CertTree";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ICRC2Service "mo:icrc2-mo/ICRC2/service";
import ICRC3Legacy "mo:icrc3-mo/legacy";
import ICRC3 "mo:icrc3-mo/";
import ICRC4 "mo:icrc4-mo/ICRC4";

import UpgradeArchive = "mo:icrc3-mo/upgradeArchive";

import ClassPlus "mo:class-plus";

import SNSTypes "sns_types";


shared ({ caller = _owner }) persistent actor class Token  (args: SNSTypes.SNSLedgerArgument
) = this{

    /* type NTNArgs = {
      Init: {
        minting_account: ICRC1.Account;
        fee_collector_account: ?ICRC1.Account;
        transfer_fee: Nat;
        decimals: Nat;
        token_symbol: Text;
        token_name: Text;
        metadata: ?[ICRC1.MetaDatum];
        initial_balances: ?[(ICRC1.Account, ICRC1.Balance)];
        archive_options: {
          num_blocks_to_archive: Nat;
          trigger_threshold: Nat;
          controller_id: Principal;
          max_transactions_per_response: ?Nat;
          max_message_size_bytes: ?Nat;
          cycles_for_archive_creation: ?Nat;
          node_max_memory_size_bytes: ?Nat;
        },
        maximum_number_of_accounts: ?Nat;
        accounts_overflow_trim_quantity: ?Nat;
        max_memo_length: ?Nat;
        feature_flags: ?{
          icrc2: Bool;
        }
      }
    };


    let tempArgs : NTNArgs = {
          Init = {
              minting_account: {
                  owner: _owner;
                  subaccount: null;
              };
              fee_collector_account= ?{ owner: _owner; subaccount: null },\;
              transfer_fee= 10000;
              decimals = 8;
              token_symbol = "tCOIN",
              token_name = "Test Coin",
              metadata = null;
              initial_balances = null, //[{ owner: me, subaccount:[] }, 100000000000n]
              archive_options ={
                  num_blocks_to_archive = 1000;
                  trigger_threshold = 3000;
                  controller_id = _owner;
                  max_transactions_per_response = null;
                  max_message_size_bytes = null;
                  cycles_for_archive_creation = ?1000_000_000_000;
                  node_max_memory_size_bytes = null;
              },
              maximum_number_of_accounts = null,
              accounts_overflow_trim_quantity = null,
              max_memo_length = null,
              feature_flags = [{ icrc2: true }],
          },
      }; */


    transient let Map = ICRC2.CoreMap;

    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, Principal.fromActor(this), true);

    transient let defaultArgs : {
      icrc1 : ?ICRC1.InitArgs;
      icrc2 : ?ICRC2.InitArgs;
      icrc3 : ?ICRC3.InitArgs;
      icrc4 : ?ICRC4.InitArgs;
    } =  switch(args) {
      case(#Init(x)) { 
          {
            icrc1 = ?{
              name = ?x.token_name;
              symbol = ?x.token_symbol;
              logo = ?"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InJlZCIvPjwvc3ZnPg==";
              decimals = switch(x.decimals){
                case(?val) val;
                case(null) 8 : Nat8;
              };
              fee = ?#Fixed(x.transfer_fee);
              minting_account = ?x.minting_account;
              max_supply = null;
              min_burn_amount = null;
              max_memo = null;
              advanced_settings = null;
              metadata = ?#Map(x.metadata);
              fee_collector = x.fee_collector_account;
              transaction_window = null;
              permitted_drift = null;
              max_accounts = null;
              settle_to_accounts = null;
            };
            icrc2 = ?{
              max_approvals_per_account = null;
              max_allowance = ?#TotalSupply;
              fee = ?#ICRC1;
              advanced_settings = null;
              max_approvals = null;
              settle_to_approvals = null;
              cleanup_interval = null;
              cleanup_on_zero_balance = null;
              icrc103_max_take_value = ?1000;
              icrc103_public_allowances = ?true;
            };
            icrc3 = ?{
              maxActiveRecords = Nat64.toNat(x.archive_options.trigger_threshold);
              settleToRecords = Nat64.toNat(x.archive_options.trigger_threshold - x.archive_options.num_blocks_to_archive);
              maxRecordsInArchiveInstance = 500_000;
              maxArchivePages = 62500;
              archiveIndexType = #Stable;
              maxRecordsToArchive = 8000;
              archiveCycles = switch(x.archive_options.cycles_for_archive_creation) {
                case(?val) Nat64.toNat(val);
                case(null) 1_0000_000_000_000;
              };
              archiveControllers = ??[_owner]; //??[put cycle ops prinicpal here];
              supportedBlocks = [
                {
                  block_type = "1xfer"; 
                  url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
                },
                {
                  block_type = "2xfer"; 
                  url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
                },
                {
                  block_type = "2approve"; 
                  url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
                },
                {
                  block_type = "1mint"; 
                  url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
                },
                {
                  block_type = "1burn"; 
                  url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
                }
              ];
            };
            icrc4 = ?{
              max_balances = ?200;
              max_transfers = ?200;
              fee = ?#ICRC1;
            };
          };
        };
        case(#Upgrade(_x)) {
          {
            icrc1 = null;
            icrc2 = null;
            icrc3 = null;
            icrc4 = null;
          };
        };
      };

    transient let default_icrc1_args : ICRC1.InitArgs = {
      name = ?"Test Token";
      symbol = ?"TTT";
      logo = ?"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InJlZCIvPjwvc3ZnPg==";
      decimals = 8;
      fee = ?#Fixed(10000);
      minting_account = ?{
        owner = _owner;
        subaccount = null;
      };
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
      archiveControllers = null; //??[put cycle ops prinicpal here];
      supportedBlocks = [
        {
          block_type = "1xfer"; 
          url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
        },
        {
          block_type = "2xfer"; 
          url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
        },
        {
          block_type = "2approve"; 
          url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
        },
        {
          block_type = "1mint"; 
          url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
        },
        {
          block_type = "1burn"; 
          url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
        },
        {
          block_type = "107feecol"; 
          url="https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-107";
        }
      ];
    };

    transient let default_icrc4_args : ICRC4.InitArgs = {
      max_balances = ?200;
      max_transfers = ?200;
      fee = ?#ICRC1;
    };

    transient let icrc1_args : ICRC1.InitArgs = switch(defaultArgs.icrc1){
      case(null) default_icrc1_args;
      case(?val){
        {
          val with minting_account = switch(
            val.minting_account){
              case(?val) ?val;
              case(null) {?{
                owner = _owner;
                subaccount = null;
              }};
            };
        }
        

        
      };
    };

    transient let icrc2_args : ICRC2.InitArgs = switch(defaultArgs.icrc2){
      case(null) default_icrc2_args;
      case(?args){
        args
      };
    };


    transient let icrc3_args : ICRC3.InitArgs = switch(defaultArgs.icrc3){
      case(null) default_icrc3_args;
      case(?args){
        args
      };
    };

    transient let icrc4_args : ICRC4.InitArgs = switch(defaultArgs.icrc4){
      case(null) default_icrc4_args;
      case(?args){
        args
      };
    };

    var icrc1_migration_state = ICRC1.init(ICRC1.initialState(), #v0_1_0(#id),?icrc1_args, _owner);
    var icrc2_migration_state = ICRC2.init(ICRC2.initialState(), #v0_1_0(#id),?icrc2_args, _owner);
    var icrc4_migration_state = ICRC4.init(ICRC4.initialState(), #v0_1_0(#id),?icrc4_args, _owner);
    let icrc3_migration_state = ICRC3.initialState();
    let cert_store : CertTree.Store = CertTree.newStore();
    transient let ct = CertTree.Ops(cert_store);


    var owner = _owner;

    var icrc3_migration_state_new = icrc3_migration_state;

    // ======== ICRC-3 Definition (must come before ICRC-1 since ICRC-1 depends on icrc3().add_record) ========

  private func updated_certification(_cert: Blob, _lastIndex: Nat) : Bool{

    ct.setCertifiedData();
    return true;
  };

  private func get_certificate_store() : CertTree.Store {
    return cert_store;
  };

  private func get_icrc3_environment() : ICRC3.Environment{
      {
        advanced = ?{
          updated_certification = ?updated_certification;
          icrc85 = null;
        };
        get_certificate_store = ?get_certificate_store;
        var org_icdevs_timer_tool = null;
      };
  };

  func ensure_block_types(icrc3Class: ICRC3.ICRC3) : () {
    let supportedBlocks = List.fromIter<ICRC3.BlockType>(icrc3Class.supported_block_types().vals());

    let has = func(blockType: Text) : Bool {
      List.any(supportedBlocks, func(bt: ICRC3.BlockType) : Bool { bt.block_type == blockType });
    };

    if(not has("1xfer")){
      List.add(supportedBlocks, {
            block_type = "1xfer"; 
            url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
          });
    };

    if(not has("2xfer")){
      List.add(supportedBlocks, {
            block_type = "2xfer"; 
            url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
          });
    };

    if(not has("2approve")){
      List.add(supportedBlocks, {
            block_type = "2approve"; 
            url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
          });
    };

    if(not has("1mint")){
      List.add(supportedBlocks, {
            block_type = "1mint"; 
            url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
          });
    };

    if(not has("1burn")){
      List.add(supportedBlocks, {
            block_type = "1burn"; 
            url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3";
          });
    };

    if(not has("107feecol")){
      List.add(supportedBlocks, {
            block_type = "107feecol"; 
            url="https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-107";
          });
    };

    icrc3Class.update_supported_blocks(List.toArray(supportedBlocks));
  };

  transient let icrc3 = ICRC3.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc3_migration_state_new;
    args = ?icrc3_args;
    pullEnvironment = ?get_icrc3_environment;
    onInitialize = ?(func(_newClass: ICRC3.ICRC3) : async*(){
       
    });
    onStorageChange = func(state: ICRC3.State){
      icrc3_migration_state_new := state;
    };
  });

    // ======== ICRC-1 Definition ========

    private func get_icrc1_environment() : ICRC1.Environment {
    {
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
      var org_icdevs_timer_tool = null;
      var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
    };
  };

  transient let getIcrc1 = ICRC1.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc1_migration_state;
    args = ?icrc1_args;
    pullEnvironment = ?get_icrc1_environment;
    onInitialize = null;
    onStorageChange = func(state: ICRC1.State) {
      icrc1_migration_state := state;
    };
  });

  func icrc1() : ICRC1.ICRC1 {
    getIcrc1();
  };

  private func get_icrc2_environment() : ICRC2.Environment {
    {
      icrc1 = icrc1();
      get_fee = null;
    };
  };

  transient let getIcrc2 = ICRC2.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc2_migration_state;
    args = ?icrc2_args;
    pullEnvironment = ?get_icrc2_environment;
    onInitialize = null;
    onStorageChange = func(state: ICRC2.State) {
      icrc2_migration_state := state;
    };
  });

  func icrc2() : ICRC2.ICRC2 {
    getIcrc2();
  };

  private func get_icrc4_environment() : ICRC4.Environment {
    {
      icrc1 = icrc1();
      get_fee = null;
    };
  };

  transient let getIcrc4 = ICRC4.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc4_migration_state;
    args = ?icrc4_args;
    pullEnvironment = ?get_icrc4_environment;
    onInitialize = null;
    onStorageChange = func(state: ICRC4.State) {
      icrc4_migration_state := state;
    };
  });

  func icrc4() : ICRC4.ICRC4 {
    getIcrc4();
  };

 

  /// Functions for the ICRC1 token standard
  public shared query func icrc1_name() : async Text {
      icrc1().name();
  };

  public shared query func icrc1_symbol() : async Text {
      icrc1().symbol();
  };

  public shared query func icrc1_decimals() : async Nat8 {
      icrc1().decimals();
  };

  public shared query func icrc1_fee() : async ICRC1.Balance {
      icrc1().fee();
  };

  public shared query func icrc1_metadata() : async [ICRC1.MetaDatum] {
      icrc1().metadata()
  };

  public shared query func icrc1_total_supply() : async ICRC1.Balance {
      icrc1().total_supply();
  };

  public shared query func icrc1_minting_account() : async ?ICRC1.Account {
      ?icrc1().minting_account();
  };

  public shared query func icrc1_balance_of(args : ICRC1.Account) : async ICRC1.Balance {
      icrc1().balance_of(args);
  };

  public shared query func icrc1_supported_standards() : async [ICRC1.SupportedStandard] {
      icrc1().supported_standards();
  };

  public shared query func icrc10_supported_standards() : async [ICRC1.SupportedStandard] {
      icrc1().supported_standards();
  };

  public shared ({ caller }) func icrc1_transfer(args : ICRC1.TransferArgs) : async ICRC1.TransferResult {
      switch(await* icrc1().transfer_tokens(caller, args, false, null)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };




  var upgradeError = "";
  var upgradeComplete = false;

  public query ({caller}) func getUpgradeError() : async Text {
    if(caller != _owner){ Runtime.trap("Unauthorized")};
    return upgradeError;
  };

  public shared ({ caller }) func upgradeArchive(bOverride : Bool) : async () {
    if(caller != _owner){ Runtime.trap("Unauthorized")};
    if(bOverride == true or upgradeComplete == false){} else {
      Runtime.trap("Upgrade already complete");
    };
    try{ 
      let _result = await UpgradeArchive.upgradeArchive(Iter.toArray<Principal>(Map.keys(icrc3().get_state().archives)));
      upgradeComplete := true;
    } catch(e){
      upgradeError := Error.message(e);
    };

    
  };

  // ======== ICRC-106: Index Principal ========

  public query func icrc106_get_index_principal() : async ICRC1.Icrc106GetResult {
    icrc1().get_icrc106_index_principal();
  };

  public shared({caller}) func set_icrc106_index_principal(principal : ?Principal) : async () {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    icrc1().set_icrc106_index_principal(principal);
  };

  // ======== ICRC-107: Fee Collector Management ========

  public shared ({ caller }) func icrc107_set_fee_collector(args : ICRC1.SetFeeCollectorArgs) : async ICRC1.SetFeeCollectorResult {
    if(caller != owner){ return #Err(#AccessDenied("Only the owner can set the fee collector")) };
    icrc1().set_fee_collector<system>(caller, args);
  };

  public query func icrc107_get_fee_collector() : async ICRC1.GetFeeCollectorResult {
    icrc1().get_fee_collector();
  };

  // ======== ICRC-21: Consent Messages ========

  public shared func icrc21_canister_call_consent_message(request : ICRC1.ConsentMessageRequest) : async ICRC1.ConsentMessageResponse {
    icrc1().build_consent_message(request);
  };

  public shared ({ caller }) func mint(args : ICRC1.Mint) : async ICRC1.TransferResult {
      if(caller != owner){ Runtime.trap("Unauthorized")};

      switch( await* icrc1().mint_tokens(caller, args)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

  public shared ({ caller }) func burn(args : ICRC1.BurnArgs) : async ICRC1.TransferResult {
      switch( await*  icrc1().burn_tokens(caller, args, false)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

   public query ({ caller = _ }) func icrc2_allowance(args: ICRC2.AllowanceArgs) : async ICRC2.Allowance {
      return icrc2().allowance(args.spender, args.account, false);
    };

  public shared ({ caller }) func icrc2_approve(args : ICRC2.ApproveArgs) : async ICRC2.ApproveResponse {
      switch(await*  icrc2().approve_transfers(caller, args, false, null)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

  public shared ({ caller }) func icrc2_transfer_from(args : ICRC2.TransferFromArgs) : async ICRC2.TransferFromResponse {
      switch(await* icrc2().transfer_tokens_from(caller, args, null)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

  public query({caller}) func icrc103_get_allowances(args: ICRC2.GetAllowancesArgs) : async ICRC2Service.AllowanceResult {
    return icrc2().getAllowances(caller, args);
  };

  public query func icrc3_get_blocks(args: ICRC3.GetBlocksArgs) : async ICRC3.GetBlocksResult{
    return icrc3().get_blocks(args);
  };

  public query func get_transactions(args: { start : Nat; length : Nat }) : async ICRC3Legacy.GetTransactionsResponse {

    let results = icrc3().get_blocks_legacy(args);
    return {
      first_index = results.first_index;
      log_length = results.log_length;
      transactions = results.transactions;
      archived_transactions = results.archived_transactions;
    };
  };

  public query func icrc3_get_archives(args: ICRC3.GetArchivesArgs) : async ICRC3.GetArchivesResult{
    return icrc3().get_archives(args);
  };

  public query func icrc3_get_tip_certificate() : async ?ICRC3.DataCertificate {
    return icrc3().get_tip_certificate();
  };

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

  public query func icrc3_supported_block_types() : async [ICRC3.BlockType] {
    return icrc3().supported_block_types();
  };

  public query func get_tip() : async ICRC3.Tip {
    return icrc3().get_tip();
  };

  public shared ({ caller }) func icrc4_transfer_batch(args: ICRC4.TransferBatchArgs) : async ICRC4.TransferBatchResults {
      switch(await* icrc4().transfer_batch_tokens(caller, args, null, null)){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) err;
        case(#err(#awaited(err))) err;
      };
  };

  public shared query func icrc4_balance_of_batch(request : ICRC4.BalanceQueryArgs) : async ICRC4.BalanceQueryResult {
      icrc4().balance_of_batch(request);
  };

  public shared query func icrc4_maximum_update_batch_size() : async ?Nat {
      ?icrc4().get_state().ledger_info.max_transfers;
  };

  public shared query func icrc4_maximum_query_batch_size() : async ?Nat {
      ?icrc4().get_state().ledger_info.max_balances;
  };

  public shared ({ caller }) func admin_update_owner(new_owner : Principal) : async Bool {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    owner := new_owner;
    return true;
  };

  public shared ({ caller }) func admin_update_icrc1(requests : [ICRC1.UpdateLedgerInfoRequest]) : async [Bool] {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    return icrc1().update_ledger_info(requests);
  };

  public shared ({ caller }) func admin_update_icrc2(requests : [ICRC2.UpdateLedgerInfoRequest]) : async [Bool] {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    return icrc2().update_ledger_info(requests);
  };

  public shared ({ caller }) func admin_update_icrc4(requests : [ICRC4.UpdateLedgerInfoRequest]) : async [Bool] {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    return icrc4().update_ledger_info(requests);
  };

  /* /// Uncomment this code to establish have icrc1 notify you when a transaction has occurred.
  private func transfer_listener(trx: ICRC1.Transaction, trxid: Nat) : () {

  };

  /// Uncomment this code to establish have icrc1 notify you when a transaction has occurred.
  private func approval_listener(trx: ICRC2.TokenApprovalNotification, trxid: Nat) : () {

  };

  /// Uncomment this code to establish have icrc1 notify you when a transaction has occurred.
  private func transfer_from_listener(trx: ICRC2.TransferFromNotification, trxid: Nat) : () {

  }; */

  private var _init = false;
  public shared(_msg) func admin_init() : async () {
    //can only be called once

    if(_init == false){
      //ensure metadata has been registered
      let _test1 = icrc1().metadata();
      let _test2 = icrc2().metadata();
      let _test4 = icrc4().metadata();
      let _test3 = icrc3().stats();

       ignore icrc1().register_supported_standards({
          name = "ICRC-3";
          url = "https://github.com/dfinity/ICRC/ICRCs/icrc-3/"
        });
        ignore icrc1().register_supported_standards({
          name = "ICRC-10";
          url = "https://github.com/dfinity/ICRC/ICRCs/icrc-10/"
        });
        ignore icrc1().register_supported_standards({
          name = "ICRC-106";
          url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-106"
        });
        ignore icrc1().register_supported_standards({
          name = "ICRC-107";
          url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-107"
        });
        ignore icrc1().register_supported_standards({
          name = "ICRC-21";
          url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-21"
        });

      ignore icrc1().register_supported_standards({
          name = "ICRC-103";
          url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-103"
        });

      ignore icrc1().register_supported_standards({
          name = "ICRC-4";
          url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-4"
        });

        // Register ICRC-21 consent handlers
        icrc1().register_consent_handler("icrc1_transfer", ICRC1.buildTransferConsent);
        icrc1().register_consent_handler("icrc107_set_fee_collector", ICRC1.buildSetFeeCollectorConsent);
        icrc1().register_consent_handler("icrc2_approve", ICRC2.buildApproveConsent);
        icrc1().register_consent_handler("icrc2_transfer_from", ICRC2.buildTransferFromConsent);
        icrc1().register_consent_handler("icrc4_transfer_batch", ICRC4.buildBatchTransferConsent);

        ensure_block_types(icrc3());

      //uncomment the following line to register the transfer_listener
      //icrc1().register_token_transferred_listener<system>("my_namespace", transfer_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_token_approved_listener<system>("my_namespace", approval_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_transfer_from_listener<system>("my_namespace", transfer_from_listener);
    };
    _init := true;
  };

  private func init_local() : async () {
    let thisActor : actor{
      admin_init: () -> async();
    } = actor(Principal.toText(Principal.fromActor(this)));

    await thisActor.admin_init();
  };

  ignore Timer.setTimer<system>(#seconds(0), init_local);


  // Deposit cycles into this canister.
  public shared func deposit_cycles() : async () {
      let amount = Cycles.available();
      let accepted = Cycles.accept<system>(amount);
      assert (accepted == amount);
  };

  system func postupgrade() {
    //re wire up the listener after upgrade
    //uncomment the following line to register the transfer_listener
      //icrc1().register_token_transferred_listener("my_namespace", transfer_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_token_approved_listener("my_namespace", approval_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_transfer_from_listener("my_namespace", transfer_from_listener);
  };

};
