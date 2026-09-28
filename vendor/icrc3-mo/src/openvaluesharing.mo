/// ICRC-85 Open Value Sharing metadata for ICRC-3 Transaction Log Library
///
/// Default OVS behavior:
/// - Base: 1 XDR per month (~1T cycles)
/// - Activity Bonus: +1 XDR per 10,000 archived blocks
/// - Cap: Maximum 100 XDR per sharing period
///
/// Default Beneficiary: ICDevs.org (via OVS collector)
///
/// This behavior may be overridden by providing a custom ICRC85Environment.
module {
  public let openvaluesharing = {
    platform = "icp";
    asset = "cycles";
    payment_mechanism = "icrc85_deposit_cycles_notify";
    custom = [
      {
        key = "namespace";
        value = #text("org.icdevs.icrc85.icrc3");
      },
      {
        key = "principal";
        value = #text("q26le-iqaaa-aaaam-actsa-cai");
      }
    ];
  };
};
