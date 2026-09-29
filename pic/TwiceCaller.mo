/// A canister that sends `upgradeArchive` twice before awaiting either, so the
/// second call reaches the ledger while the first is suspended there.
///
/// PocketIC's client sends ingress one message at a time and cannot do this.
/// The test hands the ledger's ownership to this canister first, so both calls
/// pass the owner check.
import Error "mo:core/Error";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";

persistent actor class TwiceCaller() {
  type ArchiveUpgradeResult = {
    canister_id : Principal;
    result : { #Ok; #Err : Text };
  };
  type Ledger = actor {
    upgradeArchive : Bool -> async [ArchiveUpgradeResult];
    accept_ownership : () -> async ();
  };

  /// Accepts a pending hand-off of `ledger` to this canister.
  public shared func accept(ledger : Principal) : async () {
    let l : Ledger = actor (Principal.toText(ledger));
    await l.accept_ownership();
  };

  /// The outcome of each call, in the order sent: `"ok <entries>"` or
  /// `"err <message>"`.
  public shared func upgradeTwice(ledger : Principal, bOverride : Bool) : async [Text] {
    let l : Ledger = actor (Principal.toText(ledger));
    let first = l.upgradeArchive(bOverride);
    let second = l.upgradeArchive(bOverride);
    let a = try { "ok " # Nat.toText((await first).size()) } catch (e) { "err " # Error.message(e) };
    let b = try { "ok " # Nat.toText((await second).size()) } catch (e) { "err " # Error.message(e) };
    [a, b];
  };
};
