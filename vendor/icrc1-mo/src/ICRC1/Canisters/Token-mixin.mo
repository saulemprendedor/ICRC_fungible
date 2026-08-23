///This is a naieve token implementation and shows the minimum possible implementation. It does not provide archiving and will not scale.
///Please see https://github.com/icdevsorg/ICRC_fungible for a full featured implementation

import Cycles "mo:core/Cycles";

import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";
import ICRC1Mixin "../mixin";


import ICRC1 "..";

shared ({ caller = _owner }) persistent actor class Token  (
    init_args : ICRC1.InitArgs,
) = this{

    transient let canisterId = Principal.fromActor(this);
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

    private func get_icrc1_environment() : ICRC1.Environment {
      {
        advanced = null;
        add_ledger_transaction = null;
        var org_icdevs_timer_tool = null; // No TimerTool for basic example
        var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
      };
    };

    include ICRC1Mixin({
      ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?init_args;
      pullEnvironment = ?get_icrc1_environment;
      onInitialize = null;
    });

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
