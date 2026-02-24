/////////////////////
///
/// Sample token with allowlist
///
/// This token uses the base sample token but adds functions to handle the final authorization
/// of transfers, approves, and transfers_from. The same effect could be accomplished by blocking 
/// in the public functions, but we wanted to demonstrate the ability to intercept these calls
/// as well as to update the values of the transaction.  In this instance, since everyone must be on an
/// allow list we choose to override the fee to 0 if the user is on the allowlist.  Again we could do this
/// via configuration by setting the fee to #Fixed(0) in the ICRC1 config, but we wanted to demonstrate the
/// update pattern.
///
/// New valid principals can be added by calling the admin_update_allowlist(Principal, Bool) function.  The
/// token owner is added durning initialization.
///
/// The only changes to the base code are the configuration of the can_transfer that is passed to transfer,
/// and can_approve and can_transfer_from passed to the respective functions. Those functions and supporting infrastructure
/// can be found at the end of the actor file. 
///
/////////////////////

import Cycles "mo:core/Cycles";
import D "mo:core/Debug";
import List "mo:core/List";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Set "mo:core/Set";

import CertTree "mo:ic-certification/CertTree";
import ClassPlus "mo:class-plus";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ICRC3 "mo:icrc3-mo/";
import ICRC4 "mo:icrc4-mo/ICRC4";

shared ({ caller = _owner }) persistent actor class Token  (args: ?{
    icrc1 : ?ICRC1.InitArgs;
    icrc2 : ?ICRC2.InitArgs;
    icrc3 : ICRC3.InitArgs;//already typed nullable

    icrc4 : ?ICRC4.InitArgs;
  }
) = this{

    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager(_owner, Principal.fromActor(this), true);


    transient let default_icrc1_args : ICRC1.InitArgs = {
      name = ?"Private Token";
      symbol = ?"PT";
      logo = ?"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAABi0lEQVR4nO3YsaqCUBjA8c9rKAQRIb2CRDRE7uFQ1CtED9ADRLQEIY1tDW0Nzj2Cm4FLQ0NTS4NjzYEkcu7gheLeUr/Ogevw/acDnqM/DiqixBiD/PX134DXEQsTsTARCxOxMBELE7EwEQsTsVCxN02n03dLFEWpVqvtdns+n/u+/7xqu91iAcPh8O/VP9mt+/1+vV5d17UsS9f19Xr9wUlSSt0tx3F+HbrdbsfjcbFYlEqleI5t2+/Owxjb7XbxtPF4nDCNd7eKxWKj0ZjNZq7rqqoKAJPJJAxDEbv0E9ct32w2B4MBAFwuF8/zBJEA+J/EVqsVD87nMzfmES8riqJ4IMsyN+YRL2u/38eDer3OjXnExTocDvGLStd1wzAEkQA+YwVBcDqdlsulaZphGMqyvFqtJEkSyCqkzuh2uwlHy+XyZrPp9XriSABZWC/WFAqVSqVWq/X7/dFopGmaWFMmluM4nU5H+IWTy+kXBLEwEQsTsTDllCUx+gGePWJhIhYmYmEiFqacsr4BPA3+UVUM+ccAAAAASUVORK5CYII=";
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
      icrc103_max_take_value = null;
      icrc103_public_allowances = null;
    };

    transient let default_icrc3_args : ICRC3.InitArgs = {
      maxActiveRecords = 3000;
      settleToRecords = 2000;
      maxRecordsInArchiveInstance = 100000000;
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
        }
      ];
    };

    transient let default_icrc4_args : ICRC4.InitArgs = {
      max_balances = ?3000;
      max_transfers = ?3000;
      fee = ?#ICRC1;
    };

    transient let icrc1_args : ICRC1.InitArgs = switch(args){
      case(null) default_icrc1_args;
      case(?args){
        switch(args.icrc1){
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
            };
          };
        };
      };
    };

    transient let icrc2_args : ICRC2.InitArgs = switch(args){
      case(null) default_icrc2_args;
      case(?args){
        switch(args.icrc2){
          case(null) default_icrc2_args;
          case(?val) val;
        };
      };
    };


    transient let icrc3_args : ICRC3.InitArgs = switch(args){
      case(null) default_icrc3_args;
      case(?args){
        switch(?args.icrc3){
          case(null) default_icrc3_args;
          case(?val) val;
        };
      };
    };

    transient let icrc4_args : ICRC4.InitArgs = switch(args){
      case(null) default_icrc4_args;
      case(?args){
        switch(args.icrc4){
          case(null) default_icrc4_args;
          case(?val) val;
        };
      };
    };

    var icrc1_migration_state = ICRC1.init(ICRC1.initialState(), #v0_1_0(#id),?icrc1_args, _owner);
    var icrc2_migration_state = ICRC2.init(ICRC2.initialState(), #v0_1_0(#id),?icrc2_args, _owner);
    let icrc3_migration_state = ICRC3.initialState();
    var icrc4_migration_state = ICRC4.init(ICRC4.initialState(), #v0_1_0(#id),?icrc4_args, _owner);
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

    icrc3Class.update_supported_blocks(List.toArray(supportedBlocks));
  };

  transient let icrc3 = ICRC3.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc3_migration_state_new;
    args = ?icrc3_args;
    pullEnvironment = ?get_icrc3_environment;
    onInitialize = ?(func(newClass: ICRC3.ICRC3) : async*(){
       ensure_block_types(newClass);
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

  private func icrc1_onInitialize(instance: ICRC1.ICRC1) : async* () {
    ignore instance.register_supported_standards({
      name = "ICRC-3";
      url = "https://github.com/dfinity/ICRC-1/tree/icrc-3/standards/ICRC-3"
    });
  };

  transient let getIcrc1 = ICRC1.Init({
    org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
    initialState = icrc1_migration_state;
    args = ?icrc1_args;
    pullEnvironment = ?get_icrc1_environment;
    onInitialize = ?icrc1_onInitialize;
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

  public shared ({ caller }) func icrc1_transfer(args : ICRC1.TransferArgs) : async ICRC1.TransferResult {
      switch(await* icrc1().transfer_tokens(caller, args, false,  ?#Sync(can_transfer))){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
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

   public query ({ caller }) func icrc2_allowance(args: ICRC2.AllowanceArgs) : async ICRC2.Allowance {
      return icrc2().allowance(args.spender, args.account, false);
    };

  public shared ({ caller }) func icrc2_approve(args : ICRC2.ApproveArgs) : async ICRC2.ApproveResponse {
      switch(await*  icrc2().approve_transfers(caller, args, false, ?#Sync(can_approve))){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

  public shared ({ caller }) func icrc2_transfer_from(args : ICRC2.TransferFromArgs) : async ICRC2.TransferFromResponse {
      switch(await* icrc2().transfer_tokens_from(caller, args, ?#Sync(can_transfer_from))){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
  };

  public shared ({ caller }) func icrc4_transfer_batch(args: ICRC4.TransferBatchArgs) : async ICRC4.TransferBatchResults {
      switch(await* icrc4().transfer_batch_tokens(caller, args, ?#Sync(can_transfer), ?#Sync(can_transfer_batch))){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) err;
        case(#err(#awaited(err))) err;
      };
  };

  public shared query func icrc4_balance_of_batch(request : ICRC4.BalanceQueryArgs) : async ICRC4.BalanceQueryResult {
      icrc4().balance_of_batch(request);
  };

  public query func icrc3_get_blocks(args: ICRC3.GetBlocksArgs) : async ICRC3.GetBlocksResult{
    return icrc3().get_blocks(args);
  };

  public query func icrc3_get_archives(args: ICRC3.GetArchivesArgs) : async ICRC3.GetArchivesResult{
    return icrc3().get_archives(args);
  };

  public query func icrc3_get_tip_certificate() : async ?ICRC3.DataCertificate {
    return icrc3().get_tip_certificate();
  };

  public query func get_tip() : async ICRC3.Tip {
    return icrc3().get_tip();
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

  private stable var _init = false;
  public shared(msg) func admin_init() : async () {
    //can only be called once


    if(_init == false){
      //ensure metadata has been registered
      let test1 = icrc1().metadata();
      let test2 = icrc2().metadata();
      let test3 = icrc3().stats();

      //uncomment the following line to register the transfer_listener
      //icrc1().register_token_transferred_listener("my_namespace", transfer_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_token_approved_listener("my_namespace", approval_listener);

      //uncomment the following line to register the transfer_listener
      //icrc1().register_transfer_from_listener("my_namespace", transfer_from_listener);
    };
    _init := true;
  };

  // Deposit cycles into this canister.
  public shared func deposit_cycles() : async () {
      let amount = Cycles.available();
      let accepted = Cycles.accept<system>(amount);
      assert (accepted == amount);
  };

  //////////////////////
  ///
  /// Custom code for implementing a token where those sending tokens must be on an allow list
  ///
  //////////////////////

  //create a allowlist of users that can transfer tokens
  stable let allowlist = Set.empty<Principal>();
  Set.add(allowlist, Principal.compare, _owner);


  private func update_fee(item : ?ICRC1.Value, value : Nat) : ?ICRC1.Value {
    let result =  switch(ICRC1.UtilsHelper.insert_map(item, "fee", #Nat(value))){
      case(#ok(val)) ?val;
      case(#err(err)) Runtime.trap("unreachable map addition");
    };
  };


  private func can_transfer<system>(trx: ICRC1.Value, trxtop: ?ICRC1.Value, notification: ICRC1.TransactionRequestNotification) : Result.Result<(trx: ICRC1.Value, trxtop: ?ICRC1.Value, notification: ICRC1.TransactionRequestNotification), Text>{
    if(Set.contains<Principal>(allowlist, Principal.compare, notification.from.owner)){
      return #ok(trx, update_fee(trxtop,0), {notification with 
        calculated_fee = 0;});
    };
    return #err("Not allowed");
  };

  private func can_approve<system>(trx: ICRC2.Value, trxtop: ?ICRC2.Value, notification: ICRC2.TokenApprovalNotification) : Result.Result<(trx: ICRC2.Value, trxtop: ?ICRC2.Value, notification: ICRC2.TokenApprovalNotification), Text>{
    if(Set.contains<Principal>(allowlist, Principal.compare, notification.from.owner)){
      return #ok(trx,update_fee(trxtop,0),{notification with 
        calculated_fee = 0;});
    };
    return #err("Not allowed");
  };

  private func can_transfer_from<system>(trx: ICRC2.Value, trxtop: ?ICRC2.Value, notification: ICRC2.TransferFromNotification) : Result.Result<(trx: ICRC2.Value, trxtop: ?ICRC2.Value, notification: ICRC2.TransferFromNotification), Text>{
    if(Set.contains<Principal>(allowlist, Principal.compare, notification.from.owner)){
      return #ok(trx,update_fee(trxtop,0),{notification with 
        calculated_fee = 0;});
    };
    return #err("Not allowed");
  };

  private func can_transfer_batch<system>(notification: ICRC4.TransferBatchNotification) : Result.Result<(notification: ICRC4.TransferBatchNotification), ICRC4.TransferBatchResults>{
    if(Set.contains<Principal>(allowlist, Principal.compare, notification.from)){
      return #ok(notification);
    };
    return #err([?#Err(#GenericBatchError({message = "Not allowed"; error_code = 1}))]);
  };

  public shared ({ caller }) func admin_update_allowlist(request : [{principal: Principal; allow: Bool}]) : async () {
    if(caller != owner){ Runtime.trap("Unauthorized")};
    
    for(thisItem in request.vals()){
      if(thisItem.allow){
        Set.add(allowlist, Principal.compare, thisItem.principal);
      } else {
        Set.remove(allowlist, Principal.compare, thisItem.principal);
      }
    };
  };

  system func postupgrade() {
    //re wire up the listener after upgrade
    //uncomment the following line to register the transfer_listener
      //icrc1().register_token_transferred_listener("my_namespace", transfer_listener);

      //uncomment the following line to register the transfer_listener
      //icrc2().register_token_approved_listener("my_namespace", approval_listener);

      //uncomment the following line to register the transfer_listener
      //icrc1().register_transfer_from_listener("my_namespace", transfer_from_listener);
  };

};
