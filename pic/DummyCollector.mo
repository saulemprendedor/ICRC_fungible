/// ICRC-85 Dummy Collector Canister
/// This canister receives ICRC-85 cycle share notifications for testing purposes.
/// It tracks all received notifications and cycles for verification.

import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import D "mo:core/Debug";
import Principal "mo:core/Principal";
import Time "mo:core/Time";

shared persistent actor class DummyCollector() = this {

  public type ShareNotification = {
    namespace: Text;
    actions: Nat;
    cycles_received: Nat;
    timestamp: Int;
    caller: Principal;
  };

  public type ShareArgs = [(Text, Nat)];

  // Track all received notifications using stable array
  var notifications : [ShareNotification] = [];
  var total_cycles_received : Nat = 0;
  var total_notifications : Nat = 0;

  /// ICRC-85 deposit cycles with async response
  public shared ({ caller }) func icrc85_deposit_cycles(request: ShareArgs) : async {#Ok: Nat; #Err: Text} {
    D.print("icrc85_deposit_cycles received");
    let amount = Cycles.available();
    let accepted = Cycles.accept(amount);
    
    let newNotifications = Array.map<(Text, Nat), ShareNotification>(request, func((namespace, actions)) {
      {
        namespace = namespace;
        actions = actions;
        cycles_received = accepted;
        timestamp = Time.now();
        caller = caller;
      }
    });
    
    notifications := Array.concat(notifications, newNotifications);
    total_cycles_received += accepted;
    total_notifications += 1;
    
    D.print("Accepted cycles: " # debug_show(accepted));
    #Ok(accepted)
  };

  /// ICRC-85 deposit cycles notification (one-way, no response)
  public shared ({ caller }) func icrc85_deposit_cycles_notify(request: ShareArgs) : () {
    D.print("icrc85_deposit_cycles_notify received");
    let amount = Cycles.available();
    let accepted = Cycles.accept(amount);
    
    let newNotifications = Array.map<(Text, Nat), ShareNotification>(request, func((namespace, actions)) {
      {
        namespace = namespace;
        actions = actions;
        cycles_received = accepted;
        timestamp = Time.now();
        caller = caller;
      }
    });
    
    notifications := Array.concat(notifications, newNotifications);
    total_cycles_received += accepted;
    total_notifications += 1;
    
    D.print("Accepted cycles (notify): " # debug_show(accepted));
  };

  /// Get all notifications for testing verification
  public query func get_notifications() : async [ShareNotification] {
    notifications
  };

  /// Get the most recent notification
  public query func get_last_notification() : async ?ShareNotification {
    if (notifications.size() == 0) { return null };
    ?notifications[notifications.size() - 1]
  };

  /// Get total cycles received
  public query func get_total_cycles() : async Nat {
    total_cycles_received
  };

  /// Get notification count
  public query func get_notification_count() : async Nat {
    total_notifications
  };

  /// Get notifications by namespace
  public query func get_notifications_by_namespace(namespace: Text) : async [ShareNotification] {
    Array.filter<ShareNotification>(notifications, func(n) = n.namespace == namespace)
  };

  /// Reset all data (for test cleanup)
  public func reset() : async () {
    notifications := [];
    total_cycles_received := 0;
    total_notifications := 0;
  };

  /// Get stats summary
  public query func get_stats() : async {
    total_cycles: Nat;
    total_notifications: Nat;
    notification_count: Nat;
  } {
    {
      total_cycles = total_cycles_received;
      total_notifications = total_notifications;
      notification_count = notifications.size();
    }
  };
};
