# icrc2.mo

> **Warning:** While this module has been running in production for over a year, it has not been audited and you should use it at your own risk. If you would like to contribute to getting the library audited, please send an email to austin at panindustrial dot com.

## Install

```bash
mops add icrc2-mo
```

## Usage

```motoko
import ICRC2 "mo:icrc2-mo/ICRC2";
```

## Initialization

Note: The see the section below on mixin patterns for modern, simple initialization.

This ICRC2 class uses a migration pattern as laid out in https://github.com/ZhenyaUsenko/motoko-migrations, but encapsulates the pattern in the Class+ pattern as described at https://forum.dfinity.org/t/writing-motoko-stable-libraries/21201. As a result, when you instantiate the class you need to pass the stable memory state into the class:

```motoko
stable var icrc2_migration_state = ICRC2.init(ICRC2.initialState(), #v0_1_0(#id), _args, init_msg.caller);

let #v0_1_0(#data(icrc2_state_current)) = icrc2_migration_state;

private var _icrc2 : ?ICRC2.ICRC2 = null;

private func get_icrc2_environment() : ICRC2.Environment {
  {
    icrc1 = icrc1();
    get_fee = null;
  };
};

func icrc2() : ICRC2.ICRC2 {
  switch(_icrc2){
    case(null){
      let initclass : ICRC2.ICRC2 = ICRC2.ICRC2(?icrc2_migration_state, Principal.fromActor(this), get_icrc2_environment());
      _icrc2 := ?initclass;
      initclass;
    };
    case(?val) val;
  };
};
```

The above pattern will allow your class to call `icrc2().XXXXX` to easily access the stable state of your class and you will not have to worry about pre or post upgrade methods.

### Init Args

```motoko
/// MaxAllowance indicates the maximum allowance a spender can be approved for.
public type MaxAllowance = {
  /// A fixed maximum value for the allowance.
  #Fixed: Nat;
  /// Indicates the allowance is set to the total supply of the token.
  #TotalSupply;
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

public type InitArgs = {
  max_approvals_per_account : ?Nat;  // Maximum number of approvals to allow each account
  max_allowance : ?MaxAllowance;     // Max allowance to allow for each approval
  fee : ?Fee;                        // Fee to charge for each approval or transfer from
  advanced_settings : ?AdvancedSettings;  // Optional advanced settings
  max_approvals : ?Nat;              // Max number of approvals to keep active in the canister
  settle_to_approvals : ?Nat;        // Number of approvals to settle to during clean up
  cleanup_interval : ?Nat;           // Interval in nanoseconds for timer-based cleanup
  cleanup_on_zero_balance : ?Bool;   // Whether to clean up approvals when spender balance is zero
  icrc103_max_take_value : ?Nat;     // Max pagination limit for ICRC-103 (default: 1000)
  icrc103_public_allowances : ?Bool; // Whether ICRC-103 allowances are public (default: true)
};
```

### Environment

The environment pattern lets you pass dynamic information about your environment to the class.

```motoko
// Environment defines the context in which the token ledger operates.
public type Environment = {
  /// Reference to the ICRC-1 ledger interface.
  icrc1 : ICRC1.ICRC1;
  /// Optional fee calculating function.
  get_fee : ?((State, Environment, ApproveArgs) -> Balance);
};
```

## Deduplication

The class uses a Representational Independent Hash map to keep track of duplicate transactions within the permitted drift timeline. The hash of the "tx" value is used such that provided memos and `created_at_time` will keep deduplication from triggering.

## Event System

### Subscriptions

The class has `register_token_approved_listener` and `register_transfer_from_listener` endpoints that allow other objects to register an event listener and be notified whenever a token event occurs from one user to another.

The events are synchronous and cannot directly make calls to other canisters. We suggest using them to set timers if notifications need to be sent using the Timers API.

**Listener Types:**

```motoko
/// TransferFromListener is a callback type used to listen to transfer_from events.
/// The <system> capability is required for timer operations.
public type TransferFromListener = <system>(TransferFromNotification, trxid: Nat) -> ();

/// TokenApprovalListener is a callback type used to listen to approval events.
/// The <system> capability is required for timer operations.
public type TokenApprovalListener = <system>(TokenApprovalNotification, trxid: Nat) -> ();
```

**Registration Functions:**

```motoko
/// Register a listener to be notified when approvals are created or updated.
/// The namespace should uniquely identify your listener to avoid conflicts.
public func register_token_approved_listener(namespace: Text, remote_func: TokenApprovalListener);

/// Register a listener to be notified when transfer_from operations complete.
/// The namespace should uniquely identify your listener to avoid conflicts.
public func register_transfer_from_listener(namespace: Text, remote_func: TransferFromListener);
```

**Usage Example:**

```motoko
// In your canister, register listeners after initialization
icrc2().register_token_approved_listener<system>("my_approval_tracker", func<system>(notification, trxid) {
  // Handle approval event
  // Note: Cannot make inter-canister calls directly
  // Use Timer.setTimer if you need async notifications
  Debug.print("Approval created: " # Nat.toText(trxid));
});

icrc2().register_transfer_from_listener<system>("my_transfer_tracker", func<system>(notification, trxid) {
  // Handle transfer_from event
  Debug.print("Transfer from " # Principal.toText(notification.from.owner) # 
              " to " # Principal.toText(notification.to.owner));
});
```

### Overrides

The user may assign a function to intercept each transaction type just before it is committed to the transaction log. These functions are optional. The user may manipulate the values and return them to the processing transaction and the new values will be used for the transaction block information and for notifying subscribed components.

By returning an `#err` from these functions you will effectively cancel the transaction and the caller will receive back a `#GenericError` for that request with the message you provide.

Wire these functions up by including them in your call to `transfer_tokens_from` and `approve_transfer`.

```motoko
public type TokenApprovalNotification = {
  from : Account;
  amount : Nat;
  requested_amount : Nat;
  expected_allowance : ?Nat;
  spender : Account;
  memo : ?Blob;
  fee : ?Nat;
  calculated_fee : Nat;
  expires_at : ?Nat64;
  created_at_time : ?Nat64;
};

public type TransferFromNotification = {
  spender : Account;
  from : Account;
  to : Account;
  memo : ?Blob;
  amount : Nat;
  fee : ?Nat;
  calculated_fee : Nat;
  created_at_time : ?Nat64;
};

/// Optional synchronous or asynchronous functions triggered when transferring from an account.
can_transfer_from : ?{
  #Sync : ((trx: Value, trxtop: ?Value, notification: TransferFromNotification) -> Result.Result<(trx: Value, trxtop: ?Value, notification: TransferFromNotification), Text>);
  #Async : ((trx: Value, trxtop: ?Value, notification: TransferFromNotification) -> async* Star.Star<(trx: Value, trxtop: ?Value, notification: TransferFromNotification), Text>);
};

/// Optional synchronous or asynchronous functions triggered upon approval of a transfer.
can_approve : ?{
  #Sync : ((trx: Value, trxtop: ?Value, notification: TokenApprovalNotification) -> Result.Result<(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification), Text>);
  #Async : ((trx: Value, trxtop: ?Value, notification: TokenApprovalNotification) -> async* Star.Star<(trx: Value, trxtop: ?Value, notification: TokenApprovalNotification), Text>);
};
```

## Funding

This library was initially incentivized by [ICDevs](https://icdevs.org/). You can view more about the bounty on the [forum](https://forum.dfinity.org/t/assigned-icdevs-org-bounty-44-icrc-2-and-icrc-3-motoko-6-000). If you use this library and gain value from it, please consider a [donation](https://icdevs.org/donations.html) to ICDevs.

---

## Complete Usage Example

Below is a complete example showing how to create an ICRC-1 token with ICRC-2 approval functionality using the mixin pattern:

```motoko
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
import ICRC1 "mo:icrc1-mo/ICRC1";
import ICRC2Mixin "mo:icrc2-mo/ICRC2/mixin";
import ICRC2 "mo:icrc2-mo/ICRC2";
import ClassPlus "mo:class-plus";
import Principal "mo:core/Principal";

shared ({ caller = _owner }) persistent actor class MyToken(
  icrc1Args : ?ICRC1.InitArgs,
  icrc2Args : ?ICRC2.InitArgs
) = this {
  
  transient let canisterId = Principal.fromActor(this);
  transient let manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

  // Include ICRC-1 base token functionality
  include ICRC1Mixin.mixin({
    org_icdevs_class_plus_manager = manager;
    args = icrc1Args;
    pullEnvironment = ?func() : ICRC1.Environment {
      {
        advanced = null;
        add_ledger_transaction = null;
        var org_icdevs_timer_tool = null;
        var org_icdevs_class_plus_manager = ?manager;
      }
    };
    onInitialize = null;
  });

  // Include ICRC-2 approval functionality
  include ICRC2Mixin.mixin({
    org_icdevs_class_plus_manager = manager;
    args = icrc2Args;
    pullEnvironment = ?func() : ICRC2.Environment {
      {
        icrc1 = icrc1();
        get_fee = null;  // Use default fee logic
      }
    };
    onInitialize = null;
  });

  // Custom functions can access icrc1() and icrc2() directly
  public shared ({ caller }) func mintTokens(to: ICRC1.Account, amount: Nat) : async ICRC1.TransferResult {
    // Only allow minting account to mint
    assert(caller == _owner);
    await* icrc1().mint_tokens(caller, { to; amount; memo = null; created_at_time = null });
  };
};
```

### Recommended InitArgs

```motoko
let icrc1Args : ICRC1.InitArgs = {
  name = ?"My Token";
  symbol = ?"MTK";
  decimals = 8;
  logo = null;
  fee = ?#Fixed(10_000);  // 0.0001 tokens
  max_supply = ?(1_000_000_000 * 100_000_000);  // 1 billion tokens
  minting_account = ?{ owner = _owner; subaccount = null };
  min_burn_amount = ?(100_000);  // 0.001 tokens
  advanced_settings = null;
  metadata = null;
  max_memo = null;
  fee_collector = null;
  permitted_drift = null;
  transaction_window = null;
  max_accounts = null;
  settle_to_accounts = null;
};

let icrc2Args : ICRC2.InitArgs = {
  max_approvals_per_account = ?50;    // Max 50 approvals per account
  max_allowance = ?#TotalSupply;      // No single approval > total supply
  fee = ?#ICRC1;                      // Use ICRC-1 fee
  advanced_settings = null;
  max_approvals = ?10000;             // Max 10k active approvals
  settle_to_approvals = ?9000;        // Clean up to 9k when limit reached
  cleanup_interval = null;            // No timer-based cleanup
  cleanup_on_zero_balance = ?true;    // Remove approvals when balance is zero
  icrc103_max_take_value = ?100;      // Paginate ICRC-103 queries at 100
  icrc103_public_allowances = ?true;  // Allow anyone to query allowances
};
```

---

## API Reference

### ICRC-2 Standard Endpoints

#### `icrc2_approve`

Creates or updates an approval for a spender to transfer tokens from the caller's account.

```motoko
public shared func icrc2_approve(args: ApproveArgs) : async ApproveResponse;

type ApproveArgs = {
  from_subaccount : ?Blob;      // Caller's subaccount
  spender : Account;            // Who can spend the tokens
  amount : Nat;                 // Maximum amount spender can transfer
  expected_allowance : ?Nat;    // Optional: fail if current allowance doesn't match
  expires_at : ?Nat64;          // Optional: when approval expires (nanoseconds)
  fee : ?Nat;                   // Optional: override default fee
  memo : ?Blob;                 // Optional: up to 32 bytes
  created_at_time : ?Nat64;     // Optional: for deduplication
};

type ApproveResponse = { #Ok : Nat; #Err : ApproveError };
```

#### `icrc2_transfer_from`

Transfers tokens from one account to another using a pre-approved allowance.

```motoko
public shared func icrc2_transfer_from(args: TransferFromArgs) : async TransferFromResponse;

type TransferFromArgs = {
  spender_subaccount : ?Blob;   // Spender's subaccount
  from : Account;               // Source account (must have approved caller)
  to : Account;                 // Destination account
  amount : Nat;                 // Amount to transfer
  fee : ?Nat;                   // Optional: override default fee
  memo : ?Blob;                 // Optional: up to 32 bytes
  created_at_time : ?Nat64;     // Optional: for deduplication
};

type TransferFromResponse = { #Ok : Nat; #Err : TransferFromError };
```

#### `icrc2_allowance`

Queries the current allowance for a spender on an account.

```motoko
public query func icrc2_allowance(args: AllowanceArgs) : async Allowance;

type AllowanceArgs = {
  account : Account;            // The account that gave approval
  spender : Account;            // The approved spender
};

type Allowance = {
  allowance : Nat;              // Current remaining allowance
  expires_at : ?Nat64;          // When approval expires (if set)
};
```

### ICRC-103 Allowance Query Extension

#### `icrc103_get_allowances`

Queries all allowances for an account with pagination. Controlled by `icrc103_public_allowances` setting.

```motoko
public query func icrc103_get_allowances(args: GetAllowancesArgs) : async AllowanceResult;

type GetAllowancesArgs = {
  from_account : ?Account;      // Filter by approving account
  prev_spender : ?Account;      // Pagination cursor
  take : ?Nat;                  // Max results (capped by icrc103_max_take_value)
};

type AllowanceResult = { 
  #Ok : [AllowanceDetail]; 
  #Err : GetAllowancesError 
};
```

### Stats Endpoint

#### `icrc2_get_stats`

Returns current ledger statistics and configuration.

```motoko
public query func icrc2_get_stats() : async Stats;

type Stats = {
  ledger_info : LedgerInfoShared;
  token_approvals_count : Nat;
  indexes : {
    spender_to_approval_account_count : Nat;
    owner_to_approval_account_count : Nat;
  };
};
```

### Internal Helper Functions

The following functions are available on the ICRC2 class for advanced use cases. They do **not** charge fees or create ledger transactions.

#### `revoke_approval`

Revokes a specific approval from an owner to a spender.

```motoko
public func revoke_approval(from: Account, spender: Account) : Bool;
```

Returns `true` if the approval was found and removed, `false` if no such approval existed.

#### `revoke_all_approvals`

Revokes all approvals granted by the specified account.

```motoko
public func revoke_all_approvals(from: Account) : Nat;
```

Returns the number of approvals that were revoked.

#### `get_approvals_count`

Returns the number of active approvals for an account.

```motoko
public func get_approvals_count(from: Account) : Nat;
```

**Usage Example:**

```motoko
// In your canister, access via icrc2()
let removed = icrc2().revoke_all_approvals({ owner = caller; subaccount = null });
D.print("Removed " # Nat.toText(removed) # " approvals");
```

---

## Performance

Benchmarks were run using `mops bench` on the core approval storage and query operations. Results show instruction counts for operations at different scales.

### Approval Operations

| Operation | 100 approvals | 1,000 approvals | 10,000 approvals |
|:----------|-------------:|----------------:|-----------------:|
| store_approval | 1.8M | 21.4M | 232.3M |
| lookup_approval | 3.1M | 36.4M | 399.3M |
| lookup_by_owner | 2.4M | 15.2M | 171.8M |
| delete_approval | 3.6M | 39.8M | 433.7M |

### Allowance Queries

| Operation | 100 | 1,000 | 10,000 |
|:----------|----:|------:|-------:|
| single_allowance | 3.4M | 45.9M | 602.5M |
| iterate_owner_approvals | 2.7M | 38.8M | 530.4M |
| paginate_100 | 2.7M | 38.8M | 379.7M |

**Notes:**
- All operations use O(log n) tree-based maps for efficient lookups
- Owner-indexed lookups are faster due to the index structure
- Paginated queries (ICRC-103 style) show constant overhead per page

Run benchmarks locally with:
```bash
cd ICRC2.mo && mops bench
```

---

## Security Considerations

### Cycle Drain Protection

This library includes guards against cycle drain attacks from oversized arguments. The mixin automatically calls guard functions that trap on invalid inputs for inter-canister calls:

```
icrc2_approve          → Inspect.guardApprove()
icrc2_transfer_from    → Inspect.guardTransferFrom()
icrc2_allowance        → Inspect.guardAllowance()
icrc103_get_allowances → Inspect.guardGetAllowances()
icrc130_get_allowances → Inspect.guardGetAllowances()
```

No action is required for this layer — it is built into the mixin.

For **ingress message protection**, you must add `system func inspect()` in your actor. Import the Inspect module and validate arguments before they are decoded:

```motoko
import ICRC1Inspect "mo:icrc1-mo/ICRC1/Inspect";
import ICRC2Inspect "mo:icrc2-mo/ICRC2/Inspect";

// In your persistent actor class
system func inspect(
  {
    arg : Blob;
    msg : {
      // ICRC-1 endpoints
      #icrc1_balance_of : () -> ICRC1.Account;
      #icrc1_transfer : () -> ICRC1.TransferArgs;
      #icrc1_name : () -> ();
      // ... other ICRC-1 endpoints
      
      // ICRC-2 endpoints
      #icrc2_approve : () -> ICRC2.ApproveArgs;
      #icrc2_transfer_from : () -> ICRC2.TransferFromArgs;
      #icrc2_allowance : () -> ICRC2.AllowanceArgs;
      #icrc103_get_allowances : () -> ICRC2.GetAllowancesArgs;
      // ... other endpoints
    };
  }
) : Bool {
  // Check raw arg size FIRST — cheapest check
  if (arg.size() > 50_000) return false;

  switch (msg) {
    // ICRC-1
    case (#icrc1_transfer(getArgs)) { ICRC1Inspect.inspectTransfer(getArgs(), null) };
    case (#icrc1_balance_of(getArgs)) { ICRC1Inspect.inspectBalanceOf(getArgs(), null) };
    
    // ICRC-2
    case (#icrc2_approve(getArgs)) { ICRC2Inspect.inspectApprove(getArgs(), null) };
    case (#icrc2_transfer_from(getArgs)) { ICRC2Inspect.inspectTransferFrom(getArgs(), null) };
    case (#icrc2_allowance(getArgs)) { ICRC2Inspect.inspectAllowance(getArgs(), null) };
    case (#icrc103_get_allowances(getArgs)) { ICRC2Inspect.inspectGetAllowances(getArgs(), null) };
    
    // Bounded-type endpoints — always accept
    case (_) { true };
  };
};
```

#### ICRC-2 Inspect Module API

The Inspect module (`mo:icrc2-mo/ICRC2/Inspect`) provides:

| Function | Purpose | Returns |
|----------|---------|---------|
| `inspectApprove(args, ?config)` | Validate `icrc2_approve` args | `Bool` |
| `inspectTransferFrom(args, ?config)` | Validate `icrc2_transfer_from` args | `Bool` |
| `inspectAllowance(args, ?config)` | Validate `icrc2_allowance` args | `Bool` |
| `inspectGetAllowances(args, ?config)` | Validate `icrc103/icrc130_get_allowances` args | `Bool` |
| `guardApprove(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardTransferFrom(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardAllowance(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardGetAllowances(args, ?config)` | Guard version — traps on invalid | `()` |

Pass `null` for config to use default limits. To customize:

```motoko
let customConfig = ICRC2Inspect.configWith({
  maxMemoSize = ?64;
  maxNatDigits = null;
  maxSubaccountSize = null;
  maxRawArgSize = null;
  maxTake = ?500;  // Lower pagination limit
});
```

Default limits:
| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxMemoSize` | 32 | ICRC-1 standard memo limit |
| `maxNatDigits` | 40 | ~2^128 digit count |
| `maxSubaccountSize` | 32 | Standard subaccount size |
| `maxRawArgSize` | 2048 | 2KB max raw arg size |
| `maxTake` | 1000 | Max pagination for get_allowances |

See [ICRC_fungible Token.mo](https://github.com/icdevsorg/ICRC_fungible) for a complete inspect implementation covering ICRC-1 through ICRC-4.

### Approval Cleanup

Stale approvals can accumulate over time. This library provides several cleanup strategies:

1. **Automatic limit-based cleanup**: When `max_approvals` is reached, oldest approvals are removed until `settle_to_approvals` is reached.

2. **Timer-based cleanup** (optional): Set `cleanup_interval` to periodically remove expired approvals.

3. **Balance-aware cleanup** (optional): Set `cleanup_on_zero_balance = true` to remove approvals when the approving account's balance reaches zero.

### Private Mode

Set `icrc103_public_allowances = false` to restrict `icrc103_get_allowances` queries to only return allowances where the caller is either the owner or spender.

---


### Using Class+ vs Legacy Pattern

The library supports two initialization patterns:

**Recommended: Mixin Pattern (Class+)**
```motoko
include ICRC2Mixin.mixin({ ... });
// Access via icrc2()
```

**Legacy: Direct Instantiation**
```motoko
stable var icrc2_migration_state = ICRC2.init(ICRC2.initialState(), #v0_1_0(#id), args, caller);
let icrc2Instance = ICRC2.ICRC2(?icrc2_migration_state, principal, environment);
```

The mixin pattern handles all boilerplate automatically and is recommended for new projects.