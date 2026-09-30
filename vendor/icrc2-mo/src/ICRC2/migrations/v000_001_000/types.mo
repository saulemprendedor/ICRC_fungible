// please do not import any types from your project outside migrations folder here
// it can lead to bugs when you change those types later, because migration types should not be changed
// you should also avoid importing these types anywhere in your project directly from here
// use MigrationTypes.Current property instead

import Order "mo:core/Order";
import Result "mo:core/Result";
import Star "mo:star/star";

import Map "mo:core/Map";
import Set "mo:core/Set";
import List "mo:core/List";

import ICRC1 "mo:icrc1-mo/ICRC1/";

module {

  /// List provides an interface to a mutable list-like collection.
  public let ListModule = List;

  /// Map provides an interface to a key-value storage collection.
  public let MapModule = Map;

  /// Set provides an interface to a set-like collection, storing unique elements.
  public let SetModule = Set;

  /// LedgerInfoShared contains shared configuration settings for the ledger.
  public type LedgerInfoShared = {
    /// Maximum number of approvals one account can set for others.
    max_approvals_per_account : Nat;
    /// Maximum number of total approvals the ledger can store.
    max_approvals : Nat;
    /// Maximum allowance for a spender, which could be a fixed value or based on total supply.
    max_allowance : ?MaxAllowance;
    /// Number of approvals the ledger is settled to when cleanup routines run.
    settle_to_approvals : Nat;
    /// Structure describing how transaction fees are determined.
    fee : Fee;
    /// Optional interval (in seconds) for automatic cleanup of expired approvals.
    /// If set, a timer will periodically remove expired approvals.
    cleanup_interval : ?Nat;
    /// Optional flag to enable cleanup of approvals when an account's balance goes to zero.
    /// If true, all approvals for an account will be removed when its balance reaches zero.
    cleanup_on_zero_balance : ?Bool;
    /// Maximum number of allowances to return in a single icrc103_get_allowances query.
    icrc103_max_take_value : Nat;
    /// Flag to make allowances publicly queryable via ICRC-103.
    icrc103_public_allowances : Bool;
  };

  /// Stats contains general statistics about the ledger and approvals in the system.
  public type Stats = {
    /// Shared ledger info with configurations.
    ledger_info : LedgerInfoShared;
    /// Count of all current token approvals.
    token_approvals_count : Nat;
    /// Counts of approvals broken down by spender and owner.
    indexes: {
      /// Count of approvals per spender.
      spender_to_approval_account_count : Nat;
      /// Count of approvals per owner.
      owner_to_approval_account_count : Nat;
    };
  };

  /// Fee defines the structure of how fees are calculated and charged.
  public type Fee = {
    /// A fixed fee amount that is applied to transactions.
    #Fixed: Nat;
    /// Indicates fee structure is defined in the surrounding environment.
    #Environment;
    /// Fee is defined and managed by ICRC-1 standards.
    #ICRC1;
  };

  /// MaxAllowance indicates the maximum allowance a spender can be approved for.
  public type MaxAllowance = {
    /// A fixed maximum value for the allowance.
    #Fixed: Nat;
    /// Indicates the allowance is set to the total supply of the token.
    #TotalSupply;
  };

  /// Environment defines the context in which the token ledger operates.
  public type Environment = {
    /// Reference to the ICRC-1 ledger interface.
    icrc1 : ICRC1.ICRC1;
    /// Optional fee calculating function.
    get_fee : ?((State, Environment, ApproveArgs) -> Balance);
  };

  public type CanTransferFrom = ?{
      #Sync : (<system>(trx: Value, trxtop: ?Value, notification: TransferFromNotification) -> Result.Result<(trx: Value, trxtop: ?Value, notification: TransferFromNotification), Text>);
      #Async : (<system>(trx: Value, trxtop: ?Value, notification: TransferFromNotification) -> async* Star.Star<(trx: Value, trxtop: ?Value, notification: TransferFromNotification), Text>);
    };

  public type CanApprove = ?{
    #Sync : (<system>(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification) -> Result.Result<(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification), Text>);
    #Async : (<system>(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification) -> async* Star.Star<(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification), Text>);
  };

  /// Value is a generic type capable of representing different values in a shared data structure.
  public type Value = {
    #Nat : Nat;
    #Int : Int;
    #Blob : Blob;
    #Text : Text;
    #Array : [Value];
    #Map: [(Text, Value)];
  };

  /// Account represents a unique identity on the ledger with an optional subaccount.
  public type Account = {
    /// The principal identifier for the account.
    owner : Principal;
    /// An optional subaccount providing for multiple identities under the same owner.
    subaccount : ?Subaccount;
  };

  /// Subaccount represents a byte array used to create multiple account identities for the same owner.
  public type Subaccount = Blob;

  /// ApproveArgs defines the arguments that are necessary when creating an approval.
  public type ApproveArgs = {
    from_subaccount : ?Blob;
    spender : Account;
    amount : Nat;
    expected_allowance : ?Nat;
    expires_at : ?Nat64;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  /// ApproveError lists varieties of errors that can be returned during approval process.
  public type ApproveError = {
    #BadFee :  { expected_fee : Nat };
    #InsufficientFunds :  { balance : Nat };
    #AllowanceChanged :  { current_allowance : Nat };
    #Expired :  { ledger_time : Nat64; };
    #TooOld;
    #CreatedInFuture:  { ledger_time : Nat64 };
    #Duplicate :  { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError :  { error_code : Nat; message : Text };
  };

  /// UpdateLedgerInfoRequest defines requests that can update ledger configurations.
  public type UpdateLedgerInfoRequest = {
    #MaxApprovalsPerAccount : Nat;
    #MaxApprovals : Nat;
    #MaxAllowance : ?MaxAllowance;
    #SettleToApprovals : Nat;
    #Fee : Fee;
  };

  /// ApproveResponse is the result type of approve operations, indicating success or the error occurred.
  public type ApproveResponse = { #Ok : Nat; #Err : ApproveError };

  /// ApproveStar combines ApproveResponse and Text using the Star pattern.
  public type ApproveStar = Star.Star<ApproveResponse, Text>;

  /// TransferFromError defines different errors that can occur during a transfer from an account.
  public type TransferFromError = {
    #BadFee :  { expected_fee : Nat };
    #BadBurn :  { min_burn_amount : Nat };
    #InsufficientFunds :  { balance : Nat };
    #InsufficientAllowance :  { allowance : Nat };
    #TooOld;
    #CreatedInFuture:  { ledger_time : Nat64 };
    #Duplicate :  { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError :  { error_code : Nat; message : Text };
  };

  /// TransferFromArgs contains the arguments necessary for a transfer from one account to another.
  public type TransferFromArgs = {
    spender_subaccount : ?Blob;
    from : Account;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  /// AllowanceArgs contains the arguments necessary for querying the allowance on the ledger.
  public type AllowanceArgs = {
    account : Account;
    spender : Account;
  };

  /// Allowance represents the amount a spender is allowed to use and its expiration time.
  public type Allowance = {
    allowance : Nat;
    expires_at : ?Nat64;
  };

  /// account_eq is an equality checker for accounts.
  public let account_eq = ICRC1.account_eq;

  /// account_compare is a comparator function for accounts.
  public let account_compare = ICRC1.account_compare;

  /// InitArgs represents the initialization arguments for setting up an ICRC1 token canister that includes ICRC2 standards.
  public type InitArgs = {
      max_approvals_per_account : ?Nat;
      max_allowance : ?MaxAllowance;
      fee : ?Fee;
      advanced_settings: ?AdvancedSettings;
      max_approvals: ?Nat;
      settle_to_approvals: ?Nat;
      /// Optional interval (in seconds) for automatic cleanup of expired approvals.
      /// If set, a timer will periodically remove expired approvals.
      cleanup_interval: ?Nat;
      /// Optional flag to enable cleanup of approvals when an account's balance goes to zero.
      /// If true, all approvals for an account will be removed when its balance reaches zero.
      cleanup_on_zero_balance: ?Bool;
      /// Optional maximum number of allowances to return in a single icrc103_get_allowances query.
      /// Defaults to 1000 if not specified.
      icrc103_max_take_value: ?Nat;
      /// Optional flag to make allowances publicly queryable via ICRC-103.
      /// If true (default), any caller can query allowances. If false, only the owner/spender can query their allowances.
      icrc103_public_allowances: ?Bool;
  };

  /// Balance represents numerical token balance.
  public type Balance = Nat;

  /// AdvancedSettings allows specifying existing approvals for migration into a new token canister in [InitArgs](#type.InitArgs).
  public type AdvancedSettings = {
      existing_approvals: [((Account, Account), ApprovalInfo)];
  };

  /// Transaction is a record that logs a transaction action.
  public type Transaction = ICRC1.Transaction;

  /// TokenApprovalNotification captures the necessary information for a token approval event.
  public type TokenApprovalNotification = {
    from : Account;
    amount : Nat;
    requested_amount: Nat;
    expected_allowance : ?Nat;
    spender : Account;
    memo :  ?Blob;
    fee : ?Nat;
    calculated_fee: Nat;
    expires_at : ?Nat64;
    created_at_time : ?Nat64; 
  };

  /// TransferFromNotification captures the necessary information for a transfer from event.
  public type TransferFromNotification = {
    spender: Account;
    from : Account;
    to : Account;
    memo : ?Blob;
    amount : Nat;
    fee : ?Nat;
    calculated_fee: Nat;
    created_at_time : ?Nat64;
  };

  /// TransferFromResponse represents the outcome of a transfer from operation.
  public type TransferFromResponse = { #Ok : Nat; #Err : TransferFromError };

  /// ApprovalInfo contains all details of a specific approval setting.
  public type ApprovalInfo = {
    from_subaccount : ?Blob;
    spender : Account;
    amount : Nat;
    expires_at : ?Nat64;
  };

  /// approvalEquals is a function that checks the equality of two account approval mappings.
  public func approvalEquals(x: (Account, Account), y: (Account, Account)) : Bool{
    return ICRC1.account_eq(x.0, y.0) and ICRC1.account_eq(x.1, y.1);
  };

  /// approval_compare is a comparator function for approval mappings.
  public func approval_compare(x: (Account, Account), y: (Account, Account)) : Order.Order {
    switch(account_compare(x.0, y.0)) {
      case(#equal) account_compare(x.1, y.1);
      case(other) other;
    };
  };

  /// TransferFromListener is a callback type used to listen to transfer events.
  public type TransferFromListener = <system>(TransferFromNotification, trxid: Nat) -> ();

  /// TokenApprovalListener is a callback type used to listen to approval events.
  public type TokenApprovalListener = <system>(TokenApprovalNotification, trxid: Nat) -> ();

  /// LedgerInfo contains mutable configurations for the ledger.
  public type LedgerInfo = {
    var max_approvals_per_account : Nat;
    var max_approvals : Nat;
    var max_allowance : ?MaxAllowance;
    var settle_to_approvals : Nat;
    var fee : Fee;
    var metadata : ?Value;
    /// Optional interval (in seconds) for automatic cleanup of expired approvals.
    var cleanup_interval : ?Nat;
    /// Optional flag to enable cleanup of approvals when an account's balance goes to zero.
    var cleanup_on_zero_balance : ?Bool;
    /// Maximum number of allowances to return in a single icrc103_get_allowances query.
    var icrc103_max_take_value : Nat;
    /// Flag to make allowances publicly queryable via ICRC-103.
    var icrc103_public_allowances : Bool;
  };

  /// Indexes contains structures that index approvals by spender or owner.
  public type Indexes = {
    spender_to_approval_account : Map.Map<Account, Set.Set<Account>>;
    owner_to_approval_account : Map.Map<Account, Set.Set<(Account)>>;
  };

  /// State represents the entire state of the ledger, containing ledger configurations, approvals, and indices.
  public type State = {
    ledger_info : LedgerInfo;
    token_approvals : Map.Map<(Account, Account), ApprovalInfo>;
    indexes: Indexes;
  };

};
