import Archive "./archive";
import Result "mo:core/Result";
import List "mo:core/List";
import Error "mo:core/Error";
import Principal "mo:core/Principal";


module {
   /// Upgrades archive canisters to the latest version.
   /// 
   /// This function iterates through the provided canister principals and attempts
   /// to upgrade each archive canister. The archive's state is stable, so the init
   /// arguments are a noop - they won't affect existing data.
   ///
   /// Arguments:
   /// - `canisters`: Array of archive canister principals to upgrade
   ///
   /// Returns:
   /// - Array of Result types indicating success or failure for each canister
   ///
   /// Example:
   /// ```motoko
   /// let archives = icrc3.get_archives({ from = null });
   /// let principals = Array.map<GetArchivesResultItem, Principal>(archives, func(a) { a.canister_id });
   /// let results = await upgradeArchive(principals);
   /// ```
   public func upgradeArchive<system>(canisters: [Principal]) : async [Result.Result<(),Text>]{
    await upgradeArchiveWith<system>(canisters, { icrc85KillSwitch = null });
   };

   /// LOCAL PATCH (archive kill switch): `upgradeArchive` with the ledger's
   /// icrc3 ICRC-85 kill switch. An archive created before the switch existed
   /// takes it from this upgrade; an archive that already has it keeps its own.
   /// Pass the same value the ledger's icrc3 environment has.
   public func upgradeArchiveWith<system>(canisters: [Principal], options : { icrc85KillSwitch : ?Bool }) : async [Result.Result<(),Text>]{

    let result = List.empty<Result.Result<(),Text>>();
    label proc for(thisCanister in canisters.vals()){
      try{
        //note: args is stable in archive so these init items are a noop
        let anActor : actor{} = actor(Principal.toText(thisCanister));
        let _upgraded = await (system Archive.Archive)(#upgrade anActor)({
          maxRecords = 0;
          maxPages = 62500;
          indexType = #Stable;
          firstIndex = 0;
          icrc85Collector = null;
          icrc85KillSwitch = options.icrc85KillSwitch;
        });
        List.add(result, #ok(()));
      }catch(e){
        List.add(result, #err("Failed to upgrade archive canister " # Principal.toText(thisCanister) # ": " # Error.message(e)));
        continue proc;
      };
    };
    return List.toArray(result);

   };
}