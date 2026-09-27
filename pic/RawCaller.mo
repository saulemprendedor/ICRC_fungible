/// A canister that forwards any call, byte for byte.
///
/// `system func inspect` runs for INGRESS messages only. Once a method's
/// caller class is refused at ingress, a test that can send nothing but
/// ingress never reaches the method body again, and the body's own
/// authorisation check goes untested. An inter-canister call walks straight
/// past `inspect`, so a test sends the method's Candid argument through here
/// and decodes the reply itself. A trap in the target comes back as a
/// rejected call.
import InternetComputer "mo:core/InternetComputer";

persistent actor class RawCaller() {
  public shared func call(target : Principal, method : Text, arg : Blob) : async Blob {
    await InternetComputer.call(target, method, arg)
  };
};
