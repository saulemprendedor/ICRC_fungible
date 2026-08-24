///This is a naieve token implementation and shows the minimum possible implementation. It does not provide archiving and will not scale.
///Please see https://github.com/icdevsorg/ICRC_fungible for a full featured implementation

import Cycles "mo:core/Cycles";

import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";

import ICRC1 "..";

shared ({ caller = _owner }) persistent actor class Token  (
    init_args : ICRC1.InitArgs,
) = this {

    transient let canisterId = Principal.fromActor(this);
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

    var icrc1_migration_state = ICRC1.init(ICRC1.initialState(), #v0_1_0(#id), ?init_args, _owner);

    private func get_icrc1_environment() : ICRC1.Environment {
      {
        advanced = null;
        add_ledger_transaction = null;
        var org_icdevs_timer_tool = null; // No TimerTool for basic example
        var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
      };
    };

    transient let icrc1 = ICRC1.Init({
      org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
      initialState = icrc1_migration_state;
      args = ?init_args;
      pullEnvironment = ?get_icrc1_environment;
      onInitialize = null;
      onStorageChange = func(state: ICRC1.State) {
        icrc1_migration_state := state;
      };
    });

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
        await* icrc1().transfer(caller, args);
    };

    public shared ({ caller }) func mint(args : ICRC1.Mint) : async ICRC1.TransferResult {
        await* icrc1().mint(caller, args);
    };

    public shared ({ caller }) func burn(args : ICRC1.BurnArgs) : async ICRC1.TransferResult {
        await*  icrc1().burn(caller, args);
    };

    // Deposit cycles into this canister.
    public shared func deposit_cycles() : async () {
        let amount = Cycles.available();
        let accepted = Cycles.accept<system>(amount);
        assert (accepted == amount);
    };
};
