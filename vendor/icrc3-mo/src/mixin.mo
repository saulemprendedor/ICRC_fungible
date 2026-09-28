/////////
// ICRC3 Mixin - Transaction Log Interface
//
// This mixin provides ICRC-3 transaction log functionality with archive support.
// It wraps the ICRC3 class and manages state persistence.
//
// Guards are included to protect against cycle drain attacks from oversized arguments.
// These guards trap early for inter-canister calls. For ingress protection, use the
// inspect helpers in your main actor's `system func inspect()`.
//
// Usage:
// ```motoko
// import ICRC3Mixin "mo:icrc3-mo/mixin";
// import ICRC3 "mo:icrc3-mo";
// import ClassPlus "mo:class-plus";
// import Principal "mo:core/Principal";
//
// shared ({ caller = _owner }) persistent actor class MyToken() = this {
//   transient let canisterId = Principal.fromActor(this);
//   transient let org_icdevs_class_plus_manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);
//
//   include ICRC3Mixin.mixin({
//     org_icdevs_class_plus_manager = org_icdevs_class_plus_manager;
//     args = ?icrc3Args;
//     pullEnvironment = ?getEnvironment;
//     onInitialize = null;
//   });
//
//   // Access via icrc3()
// };
// ```
/////////

import ICRC3 ".";
import Legacy "legacy";
import List "mo:core/List";
import Interface "./Interface";
import Inspect "./Inspect";

mixin(
  config: ICRC3.MixinFunctionArgs
) {

  stable var icrc3_migration_state = ICRC3.initialState();

  // Use ICRC3.Init which handles ClassPlus registration internally
  transient let icrc3 = ICRC3.Init({
    org_icdevs_class_plus_manager = config.org_icdevs_class_plus_manager;
    initialState = icrc3_migration_state;
    args = config.args;
    pullEnvironment = config.pullEnvironment;
    onInitialize = config.onInitialize;
    onStorageChange = func(state: ICRC3.State) {
      icrc3_migration_state := state;
    };
  });

  /// The extensible interface for ICRC-3 endpoints
  transient let org_icdevs_icrc3_interface : Interface.ICRC3Interface = Interface.defaultInterface(icrc3);

  public query func icrc3_get_blocks(getBlocksArgs: ICRC3.GetBlocksArgs) : async ICRC3.GetBlocksResult {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardGetBlocks(getBlocksArgs, null);
    
    let ctx = Interface.queryContext<ICRC3.GetBlocksArgs>(getBlocksArgs, null);
    Interface.executeQuery<ICRC3.GetBlocksArgs, ICRC3.GetBlocksResult>(
      ctx,
      org_icdevs_icrc3_interface.beforeGetBlocks,
      org_icdevs_icrc3_interface.icrc3_get_blocks,
      org_icdevs_icrc3_interface.afterGetBlocks
    );
  };

  public query func icrc3_get_archives(getArchivesArgs: ICRC3.GetArchivesArgs) : async ICRC3.GetArchivesResult {
    // Guard not strictly needed for Principal, but included for consistency
    Inspect.guardGetArchives(getArchivesArgs, null);
    
    let ctx = Interface.queryContext<ICRC3.GetArchivesArgs>(getArchivesArgs, null);
     Interface.executeQuery<ICRC3.GetArchivesArgs, ICRC3.GetArchivesResult>(
      ctx,
      org_icdevs_icrc3_interface.beforeGetArchives,
      org_icdevs_icrc3_interface.icrc3_get_archives,
      org_icdevs_icrc3_interface.afterGetArchives
    );
  };

  public query func icrc3_get_tip_certificate() : async ?ICRC3.DataCertificate {
    let ctx = Interface.queryContext<()>( (), null);
    Interface.executeQuery<(), ?ICRC3.DataCertificate>(
      ctx,
      org_icdevs_icrc3_interface.beforeGetTipCertificate,
      org_icdevs_icrc3_interface.icrc3_get_tip_certificate,
      org_icdevs_icrc3_interface.afterGetTipCertificate
    );
  };

  public query func icrc3_supported_block_types() : async [ICRC3.BlockType] {
    let ctx = Interface.queryContext<()>( (), null);
    Interface.executeQuery<(), [ICRC3.BlockType]>(
      ctx,
      org_icdevs_icrc3_interface.beforeSupportedBlockTypes,
      org_icdevs_icrc3_interface.icrc3_supported_block_types,
      org_icdevs_icrc3_interface.afterSupportedBlockTypes
    );
  };

  public query func get_tip() : async ICRC3.Tip {
    let ctx = Interface.queryContext<()>( (), null);
    Interface.executeQuery<(), ICRC3.Tip>(
      ctx,
      org_icdevs_icrc3_interface.beforeGetTip,
      org_icdevs_icrc3_interface.get_tip,
      org_icdevs_icrc3_interface.afterGetTip
    );
  };

  // Legacy endpoints for Rosetta compatibility
  public query func get_blocks(legacyArgs: { start : Nat; length : Nat }) : async Legacy.RosettaGetBlocksResponse {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardLegacyBlocks(legacyArgs, null);
    
    let ctx = Interface.queryContext<{ start : Nat; length : Nat }>(legacyArgs, null);
     Interface.executeQuery<{ start : Nat; length : Nat }, Legacy.RosettaGetBlocksResponse>(
      ctx,
      org_icdevs_icrc3_interface.beforeLegacyGetBlocks,
      org_icdevs_icrc3_interface.get_blocks,
      org_icdevs_icrc3_interface.afterLegacyGetBlocks
    );
  };

  public query func get_transactions(txnArgs: { start : Nat; length : Nat }) : async Legacy.GetTransactionsResponse {
    // Guard against oversized arguments (protects inter-canister calls)
    Inspect.guardLegacyBlocks(txnArgs, null);
    
    let ctx = Interface.queryContext<{ start : Nat; length : Nat }>(txnArgs, null);
     Interface.executeQuery<{ start : Nat; length : Nat }, Legacy.GetTransactionsResponse>(
      ctx,
      org_icdevs_icrc3_interface.beforeLegacyGetTransactions,
      org_icdevs_icrc3_interface.get_transactions,
      org_icdevs_icrc3_interface.afterLegacyGetTransactions
    );
  };

  // Legacy archives endpoint for Rosetta compatibility
  public query func archives() : async [{ canister_id: Principal; block_range_start: Nat; block_range_end: Nat }] {
    let icrc3Archives = icrc3().get_archives({ from = null });
    let buffer = List.empty<{ canister_id: Principal; block_range_start: Nat; block_range_end: Nat }>();
    for (archive in icrc3Archives.vals()) {
      List.add(buffer, {
        canister_id = archive.canister_id;
        block_range_start = archive.start;
        block_range_end = archive.end;
      });
    };
    List.toArray(buffer);
  };

  /// Returns statistics about the transaction log
  public query func icrc3_get_stats() : async ICRC3.Stats {
    icrc3().get_stats();
  };
};
