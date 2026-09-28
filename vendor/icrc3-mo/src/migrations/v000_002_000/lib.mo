import MigrationTypes "../types";
import v0_2_0 "types";

import Map "mo:core/Map";
import List "mo:core/List";

import OVSFixed "mo:ovs-fixed";

module {

  type Transaction = v0_2_0.Transaction;
  type BlockType = v0_2_0.BlockType;
  type TransactionRange = v0_2_0.TransactionRange;

  public func upgrade(prevMigrationState: MigrationTypes.State, _args: ?MigrationTypes.Args, _caller: Principal, _canister: Principal): MigrationTypes.State {

    let #v0_1_0(#data(prevState)) = prevMigrationState else {
      return prevMigrationState; // Already at or past this version
    };

    // Migrating from mo:core/List (v0.1.0 updated) to mo:core/List (v0.2.0)
    let newLedger = List.fromArray<Transaction>(List.toArray<Transaction>(prevState.ledger));

    // Migrating from mo:core/List (v0.1.0 updated) to mo:core/List (v0.2.0)
    let newSupportedBlocks = List.fromArray<BlockType>(List.toArray<BlockType>(prevState.supportedBlocks));

    // Migrating from mo:core/Map (v0.1.0 updated) to mo:core/Map (v0.2.0)
    let newArchives = Map.fromIter<Principal, TransactionRange>(Map.entries<Principal, TransactionRange>(prevState.archives), v0_2_0.principal_compare);

    let state : v0_2_0.State = {
      var ledger = newLedger;
      archives = newArchives;
      supportedBlocks = newSupportedBlocks;
      ledgerCanister = prevState.ledgerCanister;
      var lastIndex = prevState.lastIndex;
      var firstIndex = prevState.firstIndex;
      var bCleaning = prevState.bCleaning;
      var cleaningTimer = prevState.cleaningTimer;
      var latest_hash = prevState.latest_hash;
      constants = {
        archiveProperties = {
          var maxActiveRecords = prevState.constants.archiveProperties.maxActiveRecords;
          var settleToRecords = prevState.constants.archiveProperties.settleToRecords;
          var maxRecordsInArchiveInstance = prevState.constants.archiveProperties.maxRecordsInArchiveInstance;
          var maxRecordsToArchive = prevState.constants.archiveProperties.maxRecordsToArchive;
          var maxArchivePages = prevState.constants.archiveProperties.maxArchivePages;
          var archiveIndexType = prevState.constants.archiveProperties.archiveIndexType;
          var archiveCycles = prevState.constants.archiveProperties.archiveCycles;
          var archiveControllers = prevState.constants.archiveProperties.archiveControllers;
        };
      };
      // Initialize ICRC-85 state for OVS
      
      var org_icdevs_ovs_fixed_state = OVSFixed.initialState();
      var org_icdevs_timer_tool = null;
    };

    return #v0_2_0(#data(state));
  };

};
