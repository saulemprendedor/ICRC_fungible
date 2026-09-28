/// A canister that sends two calls to a ledger without awaiting the first.
///
/// PocketIC's client sends ingress one message at a time, so it cannot put a
/// second call on the ledger while the first is suspended at an `await`. Both
/// calls here are enqueued before either is awaited: the ledger runs the first
/// up to its first `await`, then the second, then the rest of the first.
/// The canister must be the ledger's owner for both calls to be admitted.
import Principal "mo:core/Principal";

persistent actor class InterleaveCaller() {
  type ArchiveControllersResult = {
    canister_id : Principal;
    result : { #Ok : [Principal]; #Err : Text };
  };
  type Ledger = actor {
    update_archive_controllers : () -> async [ArchiveControllersResult];
    admin_update_owner : Principal -> async Bool;
  };

  /// `update_archive_controllers`, with `admin_update_owner(next)` sent before
  /// the first is awaited. Returns the results of the first call.
  public shared func update_then_hand_off(ledger : Principal, next : Principal) : async [ArchiveControllersResult] {
    let l : Ledger = actor (Principal.toText(ledger));
    let update = l.update_archive_controllers();
    let handOff = l.admin_update_owner(next);
    let results = await update;
    ignore await handOff;
    results;
  };
};
