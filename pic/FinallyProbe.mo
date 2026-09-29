/// The release pattern of `Token.mo`'s `upgradeArchive`, alone, so a test can
/// make its callback trap.
///
/// A flag is set before an `await` and released afterwards. A trap in the
/// callback rolls back the callback's own writes, so a release written as
/// ordinary code after the `await` is lost with it and the flag stays set. A
/// release in `finally` runs in the cleanup that follows the trap, and
/// persists. `withFinally` is the pattern the ledger uses; `withoutFinally` is
/// the control that shows the trap is real.
import Runtime "mo:core/Runtime";

persistent actor class FinallyProbe() {
  transient var inFlight = false;

  public shared func ping() : async () {};

  public shared func withFinally() : async () {
    if (inFlight) Runtime.trap("already in progress");
    inFlight := true;
    try {
      await ping();
      Runtime.trap("trap in the callback");
    } finally {
      inFlight := false;
    };
  };

  public shared func withoutFinally() : async () {
    if (inFlight) Runtime.trap("already in progress");
    inFlight := true;
    await ping();
    Runtime.trap("trap in the callback");
  };

  public query func busy() : async Bool { inFlight };
};
