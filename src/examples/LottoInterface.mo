/////////////////////
///
/// Sample token with lotto burn - Interface/Mixin Implementation
///
/// This token uses the Mixin/Interface pattern to replicate the Lotto functionality.
/// Logic: Listen for burns, flip a coin, mint reward if heads.
///
/////////////////////

import Blob "mo:core/Blob";
import D "mo:core/Debug";
import Int "mo:core/Int";
import Runtime "mo:core/Runtime";
import List "mo:core/List";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";

import CertTree "mo:ic-certification/CertTree";

import ClassPlus "mo:class-plus";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ICRC3 "mo:icrc3-mo/";
import ICRC4 "mo:icrc4-mo/ICRC4";

import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
import ICRC2Mixin "mo:icrc2-mo/ICRC2/mixin";
import ICRC3Mixin "mo:icrc3-mo/mixin";
import ICRC4Mixin "mo:icrc4-mo/ICRC4/mixin";

shared ({ caller = _owner }) persistent actor class Token (args: ?{
    icrc1 : ?ICRC1.InitArgs;
    icrc2 : ?ICRC2.InitArgs;
    icrc3 : ICRC3.InitArgs; 
    icrc4 : ?ICRC4.InitArgs;
  }
) = this {

    // Manager for ClassPlus
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager(_owner, Principal.fromActor(this), true);

    // =================================================================================================
    // CONFIGURATION (Defaults)
    // =================================================================================================

    transient let default_icrc1_args : ICRC1.InitArgs = {
      name = ?"Lotto Interface";
      symbol = ?"LTO-I";
      logo = ?"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAB/klEQVR4nO2YLcvyUByH/3uYyoYDX2Do0sBgWDGKbVWxiZhEP4VRm8GPoVjFpN0hLo2VBcEXNCiCgugUGXLuIM+82e2tOw+CTzhXvHb8eTHkBCmEEPx//Pl0wGNIFg4kCweShQPJwoFk4UCycCBZOJAsHEgWDvesVqtFUVStVvtczJ13vi3TNL1eb7/ff2I+kKUoimVZz41b0F+azSYAVKtV9Dvz+bxUKgmC4PF4wuFwNptVVfX2KJPJfJ8dDAY/zfOF72BkLRYLnuclSVIU5XA4GIaRTqd9Pt/t+xBC9XodAHq9nv0Rh3m58C9ZxWIRADRNs81ut2NZNplMusx6uWDj9reFEOp2u6IoJhIJWwaDwVQqNRqNttvtexfcZq3X6/1+H4vFHF4URQAYj8fvXXCbZZomALAs6/AMw9hP37jgNsvv9wPA+Xx2+NPpBAAcx713wW1WJBIJhUKTycThp9MpRVHxePy9CxjXaS6Xm81mmqbZZrPZDIdDWZYDgQAA0DQNANfr1T7gMC8X7ri/IFarlSAIkiSpqno8HnVdl2WZ4zhd128HOp0OAFQqlcvlYprmT/Ny4dd76yGNRuN2ZrlclsvlaDRK0zTP84VCwTAMe8GyrHw+zzAMx3Htdvuheb5gQyHyb6B7SBYOJAsHkoUDycKBZOFAsnAgWTh8AXVUeZJo9EsOAAAAAElFTkSuQmCC";
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
      archiveControllers = null; 
       supportedBlocks = [
        { block_type = "1xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"; },
        { block_type = "2xfer"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"; },
        { block_type = "2approve"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"; },
        { block_type = "1mint"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"; },
        { block_type = "1burn"; url="https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3"; }
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
      case(?args) switch(args.icrc2) { case(null) default_icrc2_args; case(?val) val };
    };

    transient let icrc3_args : ICRC3.InitArgs = switch(args){
      case(null) default_icrc3_args;
      case(?args) switch(?args.icrc3) { case(null) default_icrc3_args; case(?val) val };
    };

    transient let icrc4_args : ICRC4.InitArgs = switch(args){
      case(null) default_icrc4_args;
      case(?args) switch(args.icrc4) { case(null) default_icrc4_args; case(?val) val };
    };


    // =================================================================================================
    // MIXINS
    // =================================================================================================

    // --- ICRC3 Mixin (Must be first because others depend on it) ---
    include ICRC3Mixin({
      ICRC3.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc3_args;
      pullEnvironment = ?(func() : ICRC3.Environment {
         {
          advanced = ?{
            updated_certification = ?(func(_cert: Blob, _lastIndex: Nat) : Bool {
              // CertTree wiring if needed, or default
               // For mixin pattern, we might need access to cert store if we use it
               true // Placeholder simple implementation or wire up CertTree if needed
            });
            icrc85 = null;
          };
          get_certificate_store = null; // ?get_certificate_store;
          var org_icdevs_timer_tool = null;
        }
      });
    });

    // --- ICRC1 Mixin ---
    include ICRC1Mixin({
      ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc1_args;
      pullEnvironment = ?(func() : ICRC1.Environment {
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
        }
      });
      onInitialize = ?(func(instance : ICRC1.ICRC1) : async* () {
         ignore instance.register_supported_standards({
            name = "ICRC-3";
            url = "https://github.com/dfinity/ICRC-1/tree/icrc-3/standards/ICRC-3"
         });
      });
    });

    // --- ICRC2 Mixin ---
    include ICRC2Mixin({
      ICRC2.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc2_args;
      pullEnvironment = ?(func() : ICRC2.Environment {
         {
           icrc1 = icrc1();
           get_fee = null;
         }
      });
    });

    // --- ICRC4 Mixin ---
    include ICRC4Mixin({
      ICRC4.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc4_args;
      pullEnvironment = ?(func() : ICRC4.Environment {
        {
          icrc1 = icrc1();
          get_fee = null;
        }
      });
    });


    // =================================================================================================
    // LOTTO LOGIC
    // =================================================================================================

    stable let lotto_list : List.List<(ICRC1.Account, Nat)> = List.empty<(ICRC1.Account, Nat)>();
    var lotto_timer : ?Nat = null;

    // Use the listener pattern as burn is not in the Interface yet
    private func transfer_listener<system>(trx : ICRC1.Transaction, trxid : Nat) : () {
      switch(trx.burn){
        case(?burn){
           List.add(lotto_list, (burn.from, burn.amount));
           if(lotto_timer == null){
             lotto_timer := ?Timer.setTimer<system>(#seconds(1), run_lotto);
           };
        };
        case(_){};
      };
    };

    private func run_lotto<system>() : async (){
      let tempList = List.fromArray<(ICRC1.Account, Nat)>(List.toArray<(ICRC1.Account, Nat)>(lotto_list));
      List.clear(lotto_list);
      lotto_timer := null;
      var lottos_won : Int = 0;

      // Derive a PRNG seed from cryptographic entropy
      let entropyBlob = await Random.blob();
      let seedBytes = Blob.toArray(entropyBlob);
      var seedVal : Nat64 = 0;
      for(b in seedBytes.vals()){
        seedVal := seedVal *% 256 +% Nat64.fromNat(Nat8.toNat(b));
      };
      let random = Random.seed(seedVal);

      for(thisItem in List.values(tempList)){
        if(random.bool()){
               // Reward!
               let mintingAcc = icrc1().minting_account().owner;
               let result = await* icrc1().mint_tokens(mintingAcc, {
                  to = thisItem.0;
                  amount = thisItem.1 * 2;
                  memo = ?Text.encodeUtf8("Lotto!");
                  created_at_time = ?(Nat64.fromNat(Int.abs(Time.now() + lottos_won)));
               });
               lottos_won += 1;
        };
      };
    };

    // Manually expose burn since Mixin doesn't included it by default (only ICRC1 standard methods)
    public shared ({ caller }) func burn(args : ICRC1.BurnArgs) : async ICRC1.TransferResult {
        switch( await*  icrc1().burn_tokens(caller, args, false)){
           case(#trappable(val)) val;
           case(#awaited(val)) val;
           case(#err(#trappable(err))) Runtime.trap(err);
           case(#err(#awaited(err))) Runtime.trap(err);
        };
    };
    
    public shared ({ caller }) func mint(account : ICRC1.Account) : async ICRC1.TransferResult {
      switch( await* icrc1().mint_tokens(icrc1().minting_account().owner, {
        to = account;
        amount = 100000000000;
        memo = ?Text.encodeUtf8("Mint!");
        created_at_time = null;
      })){
        case(#trappable(val)) val;
        case(#awaited(val)) val;
        case(#err(#trappable(err))) Runtime.trap(err);
        case(#err(#awaited(err))) Runtime.trap(err);
      };
    };

    // =================================================================================================
    // INITIALIZATION
    // =================================================================================================
    
    private stable var _init = false;
    public shared(msg) func admin_init() : async () {
      if(_init == false){
        // Register the listener during init
        icrc1().register_token_transferred_listener("lotto", transfer_listener);
      };
      _init := true;
    };
    
    public shared ({ caller }) func admin_update_owner(new_owner : Principal) : async Bool {
        if(caller != _owner){ Runtime.trap("Unauthorized")};
        // In mixin pattern, owner is handled via ClassPlus or manual variable if not exposed.
        // For this example we just assume _owner is static or managed by class args.
        // But mixins don't expose 'owner' setter directly unless queried from ICRC1 if wired.
        // ICRC1 owner is immutable in args usually? 
        return true; 
    };

    system func postupgrade() {
      icrc1().register_token_transferred_listener("lotto", transfer_listener);
    };
};
