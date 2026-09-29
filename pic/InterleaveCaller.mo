/// A canister that sends two calls without awaiting the first, so that the
/// second reaches a ledger while the first is suspended there.
///
/// PocketIC's client sends ingress one message at a time, so it cannot put a
/// second call on the ledger while the first is suspended at an `await`.
/// Here both calls are enqueued before either is awaited.
///
/// A hand-off takes two principals, so the test installs this canister twice:
/// one instance is the ledger's owner and sends `update_archive_controllers`,
/// the other is the proposed owner and accepts when the first asks it to.
import List "mo:core/List";
import Principal "mo:core/Principal";

persistent actor class InterleaveCaller() {
  type ArchiveControllersResult = {
    canister_id : Principal;
    result : { #Ok : [Principal]; #Err : Text };
  };
  type Ledger = actor {
    update_archive_controllers : () -> async [ArchiveControllersResult];
    admin_propose_owner : ?Principal -> async ();
    accept_ownership : () -> async ();
  };
  type Peer = actor { accept : Principal -> async () };

  /// What answered, in the order it answered. Each call is wrapped in a
  /// function of this canister that records the answer when it arrives, and
  /// both wrappers are started before either is awaited, so the order is the
  /// order of the replies and not the order of the `await`s below.
  let events = List.empty<Text>();

  public query func order() : async [Text] { List.toArray(events) };

  /// Accepts a pending hand-off of `ledger` to this canister.
  public shared func accept(ledger : Principal) : async () {
    let l : Ledger = actor (Principal.toText(ledger));
    await l.accept_ownership();
  };

  /// As the owner of `ledger`, proposes `next`.
  public shared func propose(ledger : Principal, next : Principal) : async () {
    let l : Ledger = actor (Principal.toText(ledger));
    await l.admin_propose_owner(?next);
  };

  /// `update_archive_controllers`, with the acceptance by `next` (another
  /// instance of this canister, already proposed) sent before the first is
  /// awaited. Returns the results of the first call.
  public shared func update_then_hand_off(ledger : Principal, next : Principal) : async [ArchiveControllersResult] {
    let update = updateAndRecord(ledger);
    let handOff = acceptAndRecord(ledger, next);
    let results = await update;
    await handOff;
    results;
  };

  func updateAndRecord(ledger : Principal) : async [ArchiveControllersResult] {
    let l : Ledger = actor (Principal.toText(ledger));
    let results = await l.update_archive_controllers();
    List.add(events, "updated");
    results;
  };

  func acceptAndRecord(ledger : Principal, next : Principal) : async () {
    let peer : Peer = actor (Principal.toText(next));
    await peer.accept(ledger);
    List.add(events, "accepted");
  };
};
