///This is a naieve token implementation and shows the minimum possible implementation. It does not provide archiving and will not scale.
///Please see https://github.com/icdevsorg/ICRC_fungible for a full featured implementation


import Cycles "mo:core/Cycles";
import Principal "mo:core/Principal";
import ClassPlus "mo:class-plus";

import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
import ICRC2Mixin "../mixin";
import ICRC2 "..";
import Service "../service";

shared ({ caller = _owner }) persistent actor class Token  (
    init_args1 : ICRC1.InitArgs,
    init_args2 : ICRC2.InitArgs,
) = this{

    let icrc1_args : ICRC1.InitArgs = {
        init_args1 with minting_account = switch(
            init_args1.minting_account){
              case(?val) ?val;
              case(null) {?{
                owner = _owner;
                subaccount = null;
              }};
            };
    };

    let icrc2_args : ICRC2.InitArgs = init_args2;

    transient let canisterId = Principal.fromActor(this);
    transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

    private func get_icrc1_environment() : ICRC1.Environment {
      {
        advanced = null;
        add_ledger_transaction = null;
        var org_icdevs_timer_tool = null;
        var org_icdevs_class_plus_manager = ?org_icdevs_class_plus_manager;
      };
    };

    include ICRC1Mixin({
      ICRC1.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc1_args;
      pullEnvironment = ?get_icrc1_environment;
    });

    private func get_icrc2_environment() : ICRC2.Environment {
      {
        icrc1 = icrc1();
        get_fee = null;
      };
    };

    include ICRC2Mixin({
      ICRC2.defaultMixinArgs(org_icdevs_class_plus_manager) with
      args = ?icrc2_args;
      pullEnvironment = ?get_icrc2_environment;
    });

    /// Mint new tokens (only minting account can call)
    public shared ({ caller }) func mint(args : ICRC1.Mint) : async ICRC1.TransferResult {
        await* icrc1().mint(caller, args);
    };

    /// Burn tokens
    public shared ({ caller }) func burn(args : ICRC1.BurnArgs) : async ICRC1.TransferResult {
        await* icrc1().burn(caller, args);
    };

    /// Set the ICRC-103 private mode for allowance queries
    /// If is_public is true, any principal can query allowances for any other principal
    /// If is_public is false, principals can only query their own allowances
    public shared ({ caller }) func icrc103_set_private_mode(is_public: Bool) : async Bool {
        assert(caller == _owner);
        return icrc2().set_private_mode(is_public);
    };

    /// Manually trigger cleanup of expired approvals (useful for testing)
    public shared func icrc2_trigger_cleanup() : async () {
        icrc2().triggerCleanup();
    };

    // Deposit cycles into this canister.
    public shared func deposit_cycles() : async () {
        let amount = Cycles.available();
        let accepted = Cycles.accept<system>(amount);
        assert (accepted == amount);
    };
};
