# icrc1.mo

## Warning - While this this module has been running in production for over a year, It has not been audited and you should use it at your own risk.  If you would like to contribute to getting the library audited, please send an email to austin at icdevs dot org.

This repo contains the implementation of the 
[ICRC-1](https://github.com/dfinity/ICRC-1) token standard. 

Much of this library has been forked from https://github.com/NatLabs/icrc1.  Most of the logic was originally written in that library. We have forked it sync it with our other icrc2.mo, icrc3.mo, icrc7.mo, and icrc30.mo libraries.  The archive functionality has been removed to simplify the code(use icrc3.mo) and we have added a few features like fee_collector found in the SNS core ledger.

This library does not contain a full-featured, scalable, implementation of the library, please see [https://github.com/icdevsorg/ICRC_fungible](https://github.com/icdevsorg/ICRC_fungible) for an implementation example that includes support for ICRC 2, 3, 4, 103 and 106.

## Install
```
mops add icrc1-mo
```

## Testing
Since this item contains async test you need to use an actor to test it.  See /tests/ICRC1/ICRC1.ActorTest.mo

```
make actor-test
```

## Usage
```motoko
import ICRC1 "mo:icrc1-mo";
```

## Initialization

### Recommended: Mixin Pattern (Motoko 1.1.0+)

The mixin pattern is the recommended way to initialize ICRC-1. It uses `persistent actor class` syntax with Class+ and automatically generates all ICRC-1 endpoints, ICRC-106/107 support, ICRC-21 consent messages, and built-in cycle drain guards.

```motoko
import ICRC1Mixin "mo:icrc1-mo/ICRC1/mixin";
import ICRC1 "mo:icrc1-mo/ICRC1";
import ClassPlus "mo:class-plus";
import Principal "mo:core/Principal";

shared ({ caller = _owner }) persistent actor class MyToken(
  init_args : ?ICRC1.InitArgs
) = this {

  transient let canisterId = Principal.fromActor(this);
  transient let manager = ClassPlus.ClassPlusInitializationManager<system>(_owner, canisterId, true);

  private func get_icrc1_environment() : ICRC1.Environment {
    {
      advanced = null;
      add_ledger_transaction = null; // or ?icrc3().add_record for ICRC-3 integration
      var org_icdevs_timer_tool = null;
      var org_icdevs_class_plus_manager = ?manager;
    };
  };

  include ICRC1Mixin.mixin({
    ICRC1.defaultMixinArgs(manager) with
    args = init_args;
    pullEnvironment = ?get_icrc1_environment;
    canSetFeeCollector = ?(func(caller : Principal) : Bool { Principal.isController(caller) }); // Enable ICRC-107
    canSetIndexPrincipal = ?(func(caller : Principal) : Bool { Principal.isController(caller) }); // Enable ICRC-106
  });

  // The mixin provides:
  //   icrc1()                        - access the ICRC1 class instance
  //   org_icdevs_icrc1_interface     - extensible interface for before/after hooks
  //   All ICRC-1, ICRC-10, ICRC-21, ICRC-106, ICRC-107 endpoints
};
```

The mixin auto-generates all public endpoints (`icrc1_transfer`, `icrc1_balance_of`, `icrc1_name`, etc.) with built-in argument guards that trap oversized inputs for inter-canister calls. For ingress protection, see [Cycle Drain Protection](#cycle-drain-protection) below.

#### MixinFunctionArgs

| Field | Type | Description |
|-------|------|-------------|
| `org_icdevs_class_plus_manager` | `ClassPlusInitializationManager` | Required. The Class+ manager instance |
| `args` | `?InitArgs` | Optional init args (see below) |
| `pullEnvironment` | `?(() -> Environment)` | Optional function returning the environment |
| `onInitialize` | `?(ICRC1 -> async*())` | Optional callback after initialization |
| `canTransfer` | `CanTransfer` | Optional interceptor for validating/modifying transfers |
| `canSetFeeCollector` | `?((Principal) -> Bool)` | Authorization for ICRC-107. `null` disables the endpoint |
| `canSetIndexPrincipal` | `?((Principal) -> Bool)` | Authorization for ICRC-106. `null` disables the endpoint |

### Legacy: Direct Instantiation

For older codebases not yet using `persistent actor class`:

```motoko
stable var icrc1_migration_state = ICRC1.init(ICRC1.initialState(), #v0_1_0(#id), _args, init_msg.caller);

let #v0_1_0(#data(icrc1_state_current)) = icrc1_migration_state;

private var _icrc1 : ?ICRC1.ICRC1 = null;

private func get_icrc1_environment() : ICRC1.Environment {
  {
    advanced = null;
    get_fee = null;
    add_ledger_transaction = ?icrc3().add_record;
    var org_icdevs_timer_tool = null;
    var org_icdevs_class_plus_manager = null;
  };
};

func icrc1() : ICRC1.ICRC1 {
  switch(_icrc1){
    case(null){
      let initclass : ICRC1.ICRC1 = ICRC1.ICRC1(?icrc1_migration_state, Principal.fromActor(this), get_icrc1_environment());
      _icrc1 := ?initclass;
      initclass;
    };
    case(?val) val;
  };
};
```

The above pattern will allow your class to call `icrc1().XXXXX` to easily access the stable state of your class and you will not have to worry about pre or post upgrade methods.

The mixin pattern handles all boilerplate automatically and is recommended for new projects.

Init args:

```

  public type Fee = {
    #Fixed: Nat; //a fixed fee per transaction
    #Environment; //ask the environment for a fee based on the transaction details
  };

   public type AdvancedSettings = {
        /// needed if a token ever needs to be migrated to a new canister
        burned_tokens : Balance; //Number of previously burned tokens
        minted_tokens : Balance; //Number of previously minted tokens
        fee_collector_block : ?Nat; //Previously declared fee_collector_block  
        existing_balances: [(Account, Balance)]; //only used for migration..do not use
        local_transactions: [Transaction]; //only used for migration..do not use
        //custom config
        
    };

  public type InitArgs = {
        name : ?Text; //name of the token
        symbol : ?Text; //symbol of the token
        decimals : Nat8; //number of decimals
        logo : ?Text; //text based URL of the logo. Can be a data url
        fee : ?Fee; // fee setup
        minting_account : ?Account; //define a minting account, defaults to caller of canister initialization with null subaccount
        max_supply : ?Balance; //max supply for the token
        min_burn_amount : ?Balance; //a min burn amount to apply
        max_memo : ?Nat; //max size of the memo field, defaults to 384
        /// optional settings for the icrc1 canister
        advanced_settings: ?AdvancedSettings;
        metadata: ?Value; //Initial metadata in a #Map
        fee_collector: ?Account; //specify a fee collector account
        transaction_window : ?Timestamp; //time during which transactions should be deduplicated. Nanoseconds. Default 86_400_000_000_000
        permitted_drift : ?Timestamp; //time transactions can drift from canister time. Nanoseconds. Default 60_000_000_000
        max_accounts: ?Nat; Default 5_000_000
        settle_to_accounts: ?Nat; Default 4_990_000
    };
```

### Environment

The environment pattern lets you pass dynamic information about your environment to the class.

```
public type Environment = {

    get_fee : ?((State, Environment, TransferArgs) -> Balance); //assign a dynamic fee at runtime
    add_ledger_transaction: ?((Value, ?Value) -> Nat); //called when a transaction needs to be added to the ledger.  Used to provide compatibility with ICRC3 based transaction logs. When used in conjunction with ICRC3.mo you will get an ICRC3 compatible transaction log complete with self archiving.
    
  };
```
## Account Pruning

### Overview
When the ledger exceeds `max_accounts` (default: 5,000,000), it automatically prunes accounts down to `settle_to_accounts` (default: 4,990,000).

### Pruning Algorithm
Accounts are sorted by balance in **ascending order**. The **smallest balances are burned first** until the account count reaches `settle_to_accounts`. Pruned balances are transferred to the minting account (burned) and recorded in the transaction log with memo `"clean"`.

### ⚠️ Important Considerations
- **Dust Attack Risk:** Attackers could create many small-balance accounts to trigger pruning of legitimate small balances
- **No Minimum Protection:** Currently, there is no minimum balance threshold that protects accounts from pruning
- **Irreversible:** Pruned balances cannot be recovered

### Configuration
| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_accounts` | 5,000,000 | Trigger threshold for pruning |
| `settle_to_accounts` | 4,990,000 | Target account count after pruning |

### Recommendations
1. Set `min_burn_amount` to a value that discourages dust attacks
2. Monitor account growth patterns
3. Consider the economic impact of your pruning thresholds
4. Communicate pruning behavior to users

## Deduplication

The class uses a Representational Independent Hash map to keep track of duplicate transactions within the permitted drift timeline.  The hash of the "tx" value is used such that provided memos and created_at_time will keep deduplication from triggering.

**Note:** Per ICRC-1 specification, if `created_at_time` is `null`, deduplication is **not** performed. Transactions with different `memo` or `created_at_time` values are treated as distinct transactions.

## Event system

### Subscriptions

The class has a register_token_transferred_listener endpoint that allows other objects to register an event listener and be notified whenever a token event occurs from one user to another.

The events are synchronous and cannot directly make calls to other canisters.  We suggest using them to set timers if notifications need to be sent using the Timers API.

```

    public type Burn = {
        from : Account;
        amount : Balance;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };

    public type Mint = {
        to : Account;
        amount : Balance;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };
    public type Transaction = {
        kind : Text;
        mint : ?Mint;
        burn : ?Burn;
        transfer : ?Transfer;
        index : TxIndex;
        timestamp : Timestamp;
    };
    public type Transfer = {
        from : Account;
        to : Account;
        amount : Balance;
        fee : ?Balance;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };

  public type TokenTransferredListener = (TransferNotification, trxid: Nat) -> ();

```

### Overrides

The user may assign a function to intercept each transaction type just before it is committed to the transaction log.  These functions are optional. The user may manipulate the values and return them to the processing transaction and the new values will be used for the transaction block information and for notifying subscribed components.

By returning an #err from these functions you will effectively cancel the transaction and the caller will receive back a #GenericError for that request with the message you provide.

Wire these functions up by including them in the call to transfer_tokens as the last parameter.

```

 can_transfer : ?{ //intercept transfers and modify them or cancel them at runtime. Note: If you update the notification you must also update the trx and trxtop manually
      #Sync : ((trx: Value, trxtop: ?Value, notification: TransactionRequest) -> Result.Result<(trx: Value, trxtop: ?Value, notification: TransactionRequest), Text>);
      #Async : ((trx: Value, trxtop: ?Value, notification: TransactionRequest) -> async* Star.Star<(trx: Value, trxtop: ?Value, notification: TransactionRequest), Text>);
    };
```

### ⚠️ Reentrancy Warning for Async can_transfer

When using `#Async` can_transfer handlers, be aware of potential reentrancy risks:

1. **State Changes:** The ledger state may change between validation and execution if other transfers complete during your async operation
2. **Re-validation:** After async operations complete, the transfer is re-validated against current state to prevent race conditions
3. **Concurrent Transfers:** Multiple transfers may be in-flight simultaneously during async operations
4. **Best Practices:**
   - Keep async operations minimal and fast
   - Avoid modifying ledger state within the handler
   - Consider using `#Sync` handlers when possible for simpler, safer code
   - If async is required, implement your own locking mechanism if needed
   - Be aware that your handler may be called but the transfer could still fail re-validation

## Updating Ledger Settings with `update_ledger_info`

The `update_ledger_info` function in `icrc1.mo` allows you to modify various settings of the ICRC-1 token ledger after initialization. This function is essential for updating ledger parameters such as token name, symbol, decimals, fees, and other advanced settings. Below is a guide on how to use this function effectively.

### Function Prototype

```motoko
public func update_ledger_info(request: [UpdateLedgerInfoRequest]) : [Bool];
```

### Request Types

`UpdateLedgerInfoRequest` is an enumerated type that covers various ledger settings you can update. Each type corresponds to a specific ledger parameter:

- `#Name(Text)`: Update the token name.
- `#Symbol(Text)`: Update the token symbol.
- `#Decimals(Nat8)`: Update the number of decimals for token precision.
- `#Fee(Fee)`: Update the fee structure.
- `#MaxSupply(Nat)`: Update the maximum token supply.
- `#MinBurnAmount(?Nat)`: Update the minimum amount for token burning.
- `#MintingAccount(Account)`: Update the minting account.
- `#MaxAccounts(Nat)`: Update the max accounts allowed on the canister.
- `#SettleToAccounts(Nat)`: Update the number of accounts to reduce to if the canister goes over the max accounts.
- `#FeeCollector(?Account)`: set a fee collector for collecting fees.
- `#Metadata((Text, ?Value))`: Adds or removes a metadata value.


### Usage Example

Here's an example of how you can use `update_ledger_info` to update the token's name and symbol:

```motoko
import ICRC1 "mo:icrc1.mo";

// Assuming `icrc1` is an instance of your ICRC1 token
let updateRequests : [ICRC1.UpdateLedgerInfoRequest] = [
    #Name("New Token Name"),
    #Symbol("NTN")
];

let updateResults = icrc1.update_ledger_info(updateRequests);
```

### Return Value

The function returns an array of `Bool`, indicating the success or failure of each update request. 

### Important Considerations

- The function processes the requests in the order they are provided.
- It's crucial to check the returned array to ensure that all updates were successful.


### Metadata Synchronization

After updating ledger settings, it's recommended to verify that the changes are reflected in the token metadata. You can retrieve the updated metadata using the `metadata()` function and cross-verify the updates.

## Error Codes Reference

### TransferError Variants

| Error | Description | Resolution |
|-------|-------------|------------|
| `#BadFee` | Fee doesn't match expected value | Use `icrc1_fee()` to get the correct fee |
| `#BadBurn` | Amount below `min_burn_amount` | Increase the burn amount |
| `#InsufficientFunds` | Balance less than amount + fee | Check balance before transfer |
| `#Duplicate` | Transaction already exists in window | Use different `created_at_time` or memo |
| `#TooOld` | `created_at_time` outside valid window | Use current time within `transaction_window` |
| `#CreatedInFuture` | `created_at_time` in the future | Use current time, respecting `permitted_drift` |
| `#TemporarilyUnavailable` | Ledger temporarily unavailable | Retry the operation later |
| `#GenericError` | See error codes below | Check `error_code` for specifics |

### GenericError Codes

| Code | Context | Description |
|------|---------|-------------|
| 1 | Transfer | Self-transfer not allowed (sender equals recipient) |
| 2 | Transfer | Invalid sender account format |
| 3 | Transfer | Invalid recipient account format |
| 4 | Transfer | Memo exceeds `max_memo` bytes |
| 5 | Transfer | Amount must be greater than 0 |
| 6 | Mint | Max supply would be exceeded |
| 7 | Transfer | Both sender and recipient are minting account (ICRC-3 violation) |
| 401 | Mint | Unauthorized - only `minting_account` can mint |
| 6453 | Transfer | Rejected by `can_transfer` callback |

## Integration with Other ICRC Standards

### ICRC-2 (Approve/TransferFrom)
Use with [icrc2-mo](https://mops.one/icrc2-mo) for approval mechanics:
```motoko
// Wire ICRC-2 to use ICRC-1's environment
let icrc2_environment = {
  icrc1 = icrc1();
  // ... other ICRC-2 config
};
```

### ICRC-3 (Transaction Log)
For scalable transaction history with auto-archiving:
```motoko
get_icrc1_environment = func() : ICRC1.Environment {
  {
    add_ledger_transaction = ?(icrc3().add_record);
    // ... other config
  }
};
```

### ICRC-4 (Batch Transfers)
Use with [icrc4-mo](https://mops.one/icrc4-mo) for efficient batch operations.

### ICRC-107 (Fee Collector Management)
This library supports ICRC-107 fee collection:
- **Set collector:** `update_ledger_info([#FeeCollector(?account)])`
- **Remove collector:** `update_ledger_info([#FeeCollector(null)])` — fees are burned after removal
- First transfer after setting emits `fee_col` in transaction
- Subsequent transfers reference via `fee_col_block`

### Complete Implementation Example
See [ICRC_fungible](https://github.com/icdevsorg/ICRC_fungible) for a full implementation combining ICRC-1, 2, 3, 4, 103, and 106.

## References and other implementations
- [demergent-labs/ICRC-1 (Typescript)](https://github.com/demergent-labs/ICRC-1)
- [Ledger ref in Motoko](https://github.com/dfinity/ledger-ref/blob/main/src/Ledger.mo)
- [ICRC1 Rosetta API](https://github.com/dfinity/ic/blob/master/rs/rosetta-api/icrc1/ledger)


## Textual Representation of the ICRC-1 Accounts
This library implements the [Textual Representation](https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/README.md#textual-representation-of-accounts) format for accounts defined by the standard. It utilizes this implementation to encode each account into a sequence of bytes for improved hashing and comparison.
To help with this process, the library provides functions in the [ICRC1/Account](./src/ICRC1/Account.mo) module for [encoding](./docs/ICRC1/Account.md#encode), [decoding](./docs/ICRC1/Account.md#decode), [converting from text](./docs/ICRC1/Account.md#fromText), and [converting to text](./docs/ICRC1/Account.md#toText).

## API Reference

### Module-Level Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `initialState()` | `() -> State` | Returns initial migration state for storage |
| `init` | `migrate` | Migration function for state upgrades |
| `Init` | `(InitFunctionArgs) -> (() -> ICRC1)` | ClassPlus-compatible initialization |

### Module-Level Helpers

| Export | Description |
|--------|-------------|
| `CoreMap` | Map utilities from mo:core |
| `CoreList` | List utilities from mo:core |
| `AccountHelper` | Account module for encoding/decoding |
| `UtilsHelper` | Internal utilities (hash, balance operations) |
| `account_eq` | Account equality function |
| `account_compare` | Account comparison function |
| `blob_compare` | Blob comparison function |

### ICRC1 Class - Query Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `name()` | `Text` | Token name |
| `symbol()` | `Text` | Token symbol |
| `decimals()` | `Nat8` | Decimal places (0-255) |
| `fee()` | `Balance` | Current transfer fee |
| `metadata()` | `[MetaDatum]` | All token metadata as key-value pairs |
| `total_supply()` | `Balance` | Current circulating supply (minted - burned) |
| `minted_supply()` | `Balance` | Total tokens ever minted |
| `burned_supply()` | `Balance` | Total tokens ever burned |
| `max_supply()` | `?Balance` | Maximum supply cap (null = unlimited) |
| `minting_account()` | `Account` | Account authorized to mint |
| `balance_of(Account)` | `Balance` | Balance of specified account |
| `supported_standards()` | `[SupportedStandard]` | List of supported ICRC standards |
| `get_state()` | `CurrentState` | Full internal state (for debugging/migration) |
| `get_environment()` | `Environment` | Current environment configuration |
| `get_local_transactions()` | `List<Transaction>` | Local transaction log |
| `get_canister()` | `Principal` | Canister principal |
| `get_icrc85_stats()` | `{...}` | ICRC-85 OVS statistics |

### ICRC1 Class - Transfer Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `transfer_tokens<system>(caller, args, system_override, can_transfer)` | `async* Star<TransferResult, Text>` | **Recommended.** Full transfer with overrides and error handling via Star monad |
| `transfer(caller, args)` | `async* TransferResult` | Simple transfer (traps on internal errors) |
| `mint_tokens(caller, args)` | `async* Star<TransferResult, Text>` | **Recommended.** Mint with Star monad error handling |
| `mint(caller, args)` | `async* TransferResult` | Simple mint (traps on internal errors) |
| `burn_tokens(caller, args, system_override)` | `async* Star<TransferResult, Text>` | **Recommended.** Burn with Star monad error handling |
| `burn(caller, args)` | `async* TransferResult` | Simple burn (traps on internal errors) |

### ICRC1 Class - Admin Functions

> ⚠️ **These functions have no built-in authorization. You must implement access control.**

| Function | Returns | Description |
|----------|---------|-------------|
| `update_ledger_info([UpdateLedgerInfoRequest])` | `[Bool]` | Update ledger settings (name, symbol, fee, etc.) |
| `register_metadata([MetaDatum])` | `[MetaDatum]` | Add custom metadata entries |
| `register_supported_standards(SupportedStandard)` | `Bool` | Register support for an ICRC standard |

### ICRC1 Class - Utility Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `get_fee(TransferArgs)` | `Nat` | Calculate fee for a specific transfer |
| `get_expected_fee(TransferArgs)` | `Nat` | Get base ledger fee |
| `validate_request(tx_req, fee, override)` | `Result<(), TransferError>` | Validate a transfer request |
| `deduplicate(TransactionRequest)` | `Result<(), Nat>` | Check for duplicate transaction |
| `testMemo(?Blob)` | `??Blob` | Validate memo size (returns null if invalid) |
| `testCreatedAt(?Nat64)` | `{#ok; #Err}` | Validate timestamp |
| `find_dupe(Blob)` | `?Nat` | Find duplicate by transaction hash |
| `get_time64()` | `Nat64` | Current time in nanoseconds |
| `is_too_old(Nat64)` | `Bool` | Check if timestamp is outside window |
| `is_in_future(Nat64)` | `Bool` | Check if timestamp is in future |

### ICRC1 Class - Event Functions

| Function | Description |
|----------|-------------|
| `register_token_transferred_listener(namespace, callback)` | Subscribe to transfer events |

### Account Module Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `validate(Account)` | `Result<(), Text>` | Validate account format |
| `encodeAccount(Account)` | `Text` | Encode to textual representation |
| `decodeAccount(Text)` | `Result<Account, Text>` | Decode from textual representation |
| `fromText(Text)` | `Result<Account, Text>` | Parse account from text |
| `toText(Account)` | `Text` | Convert account to text |

### Full Type Definitions
See [types.mo](src/ICRC1/migrations/v000_002_000/types.mo) for complete type definitions.

## Benchmarks

Run benchmarks with `mops bench`. Results measured using mo:bench on copying GC.

### ICRC1 Account Operations

Account validation, encoding, decoding using ICRC1 modules.

**Instructions**

|          |       100 |       1000 |       10000 |
| :------- | --------: | ---------: | ----------: |
| validate |   423_776 |  4_216_477 |  42_146_365 |
| encode   | 1_011_374 | 10_095_285 | 100_938_093 |
| decode   | 4_641_666 | 46_397_944 | 464_007_849 |
| hash     |    41_239 |    393_175 |   3_913_072 |

### ICRC1 Balance Operations

Balance lookup and update using ICRC1.Utils functions.

**Instructions**

|                |       100 |       1000 |       10000 |
| :------------- | --------: | ---------: | ----------: |
| get_balance    | 1_570_487 | 20_582_458 | 239_600_278 |
| update_balance | 1_989_436 | 26_809_064 | 318_266_388 |

## Cycle Drain Protection

On the Internet Computer, ingress messages cost cycles to decode. An attacker can send messages with oversized unbounded arguments (large `Nat`, `Blob`, `Text`) to drain a canister's cycles without making valid calls. This library provides a two-layer defense:

### Layer 1: Guards (Inter-Canister Protection)

The mixin automatically calls guard functions before processing arguments. These trap immediately if arguments exceed safe limits:

```
icrc1_transfer     → Inspect.guardTransfer()
icrc1_balance_of   → Inspect.guardBalanceOf()
icrc107_set_fee_collector → Inspect.guardSetFeeCollector()
icrc21_canister_call_consent_message → Inspect.guardConsentMessage()
```

No action is required — this protection is built into the mixin.

### Layer 2: Inspect (Ingress Protection)

Guard functions cannot protect against ingress messages because `system func inspect()` runs before the message is dispatched to the endpoint. You must wire up inspect in your actor to reject oversized ingress messages before cycles are spent decoding them.

Import the Inspect module and use the `inspect*` functions (which return `Bool`) in your `system func inspect()`:

```motoko
import ICRC1Inspect "mo:icrc1-mo/ICRC1/Inspect";

// In your persistent actor class
system func inspect(
  {
    arg : Blob;
    msg : {
      #icrc1_balance_of : () -> ICRC1.Account;
      #icrc1_transfer : () -> ICRC1.TransferArgs;
      #icrc1_name : () -> ();
      #icrc1_symbol : () -> ();
      #icrc1_decimals : () -> ();
      #icrc1_fee : () -> ();
      #icrc1_metadata : () -> ();
      #icrc1_total_supply : () -> ();
      #icrc1_minting_account : () -> ();
      #icrc1_supported_standards : () -> ();
      #icrc10_supported_standards : () -> ();
      #icrc107_set_fee_collector : () -> ICRC1.SetFeeCollectorArgs;
      #icrc107_get_fee_collector : () -> ();
      #icrc106_get_index_principal : () -> ();
      #icrc21_canister_call_consent_message : () -> ICRC1.ConsentMessageRequest;
      #mint : () -> ICRC1.Mint;
      #burn : () -> ICRC1.BurnArgs;
      // ... your other endpoints
    };
  }
) : Bool {
  // Check raw arg size FIRST — cheapest check, prevents expensive decoding
  if (arg.size() > 50_000) return false;

  switch (msg) {
    case (#icrc1_transfer(getArgs)) { ICRC1Inspect.inspectTransfer(getArgs(), null) };
    case (#icrc1_balance_of(getArgs)) { ICRC1Inspect.inspectBalanceOf(getArgs(), null) };
    case (#icrc107_set_fee_collector(getArgs)) { ICRC1Inspect.inspectSetFeeCollector(getArgs(), null) };
    case (#icrc21_canister_call_consent_message(getArgs)) { ICRC1Inspect.inspectConsentMessage(getArgs(), null) };
    case (#mint(getArgs)) {
      let args = getArgs();
      ICRC1Inspect.isValidAccount(args.to, ICRC1Inspect.defaultConfig) and
      ICRC1Inspect.isValidNat(args.amount, ICRC1Inspect.defaultConfig) and
      ICRC1Inspect.isValidMemo(args.memo, ICRC1Inspect.defaultConfig);
    };
    case (#burn(getArgs)) { ICRC1Inspect.inspectBurn(getArgs(), null) };
    // Endpoints with only bounded types — always accept
    case (_) { true };
  };
};
```

### Inspect Module API

The Inspect module (`mo:icrc1-mo/ICRC1/Inspect`) provides:

| Function | Purpose | Returns |
|----------|---------|---------|
| `inspectTransfer(args, ?config)` | Validate `icrc1_transfer` args | `Bool` |
| `inspectBalanceOf(args, ?config)` | Validate `icrc1_balance_of` args | `Bool` |
| `inspectBurn(args, ?config)` | Validate burn args | `Bool` |
| `inspectSetFeeCollector(args, ?config)` | Validate `icrc107_set_fee_collector` args | `Bool` |
| `inspectConsentMessage(args, ?config)` | Validate `icrc21_canister_call_consent_message` args | `Bool` |
| `guardTransfer(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardBalanceOf(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardBurn(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardSetFeeCollector(args, ?config)` | Guard version — traps on invalid | `()` |
| `guardConsentMessage(args, ?config)` | Guard version — traps on invalid | `()` |

Pass `null` for config to use default limits. To customize:

```motoko
let customConfig = ICRC1Inspect.configWith({
  maxMemoSize = ?64;       // Allow larger memos
  maxNatDigits = ?50;      // Allow larger numbers
  maxSubaccountSize = null; // Keep default (32)
  maxRawArgSize = null;     // Keep default (256)
});
ICRC1Inspect.inspectTransfer(args, ?customConfig);
```

Default limits:
| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxMemoSize` | 32 | ICRC-1 standard memo limit |
| `maxNatDigits` | 40 | ~2^128 digit count |
| `maxSubaccountSize` | 32 | Standard subaccount size |
| `maxRawArgSize` | 256 | Max raw arg blob for single transfer |

## Security Notes

The following functions do not provide security and must be guarded at the implementation level:

- `update_ledger_info`
- `register_metadata`
- `register_supported_standards`

> ⚠️ **Security Warning:** These functions allow modification of critical ledger parameters. 
> When exposing through an actor interface, you **MUST** implement proper access control.

### Example Security Implementation

```motoko
// In your actor, wrap admin functions with authorization checks
shared(msg) func admin_update_ledger_info(request: [ICRC1.UpdateLedgerInfoRequest]) : async [Bool] {
  // Only allow controllers or a designated admin principal
  assert(Principal.isController(msg.caller) or msg.caller == adminPrincipal);
  icrc1().update_ledger_info(request);
};

shared(msg) func admin_register_metadata(request: [ICRC1.MetaDatum]) : async [ICRC1.MetaDatum] {
  assert(Principal.isController(msg.caller));
  icrc1().register_metadata(request);
};

shared(msg) func admin_register_supported_standards(req: ICRC1.SupportedStandard) : async Bool {
  assert(Principal.isController(msg.caller));
  icrc1().register_supported_standards(req);
};
```

**Never expose these functions directly without authorization checks.**

## ICRC-85 Open Value Sharing

This library implements [ICRC-85 Open Value Sharing](https://github.com/icdevsorg/ovs-ledger/blob/main/icrc85.md) to support sustainable open-source development on the Internet Computer.

### Default Behavior

By default, this library shares a small portion of cycles with ICDevs.org to fund continued development:

| Parameter | Value |
|-----------|-------|
| **Base Amount** | 1 XDR (~1T cycles) per month |
| **Activity Bonus** | +1 XDR per 10,000 transactions |
| **Maximum** | 100 XDR per sharing period |
| **Grace Period** | 7 days after initial deploy |
| **Collector** | `q26le-iqaaa-aaaam-actsa-cai` (ICDevs OVS Ledger) |
| **Namespace** | `org.icdevs.icrc85.icrc1` |

### OVS Statistics

Monitor OVS activity via `get_icrc85_stats()`:

```motoko
public query func get_icrc85_stats() : async ICRC1.ICRC85Stats {
  icrc1().get_icrc85_stats();
};
```

### Why OVS?

- **Sustainable Development**: Fund ongoing maintenance and improvements
- **Fair Distribution**: Libraries report usage, cycles are shared proportionally
- **Voluntary**: Full control to disable or redirect contributions
- **Transparent**: All transactions logged on the OVS Ledger (ICRC-3 compliant)

For more information, see the [ICRC-85 specification](https://github.com/icdevsorg/ovs-ledger/blob/main/icrc85.md).


## Funding

This library was initially incentivized by [ICDevs](https://icdevs.org/). You can view more about the bounty on the [forum](https://forum.dfinity.org/t/completed-icdevs-org-bounty-26-icrc-1-motoko-up-to-10k/14868/54) or [website](https://icdevs.org/bounties/2022/08/14/ICRC-1-Motoko.html). The bounty was funded by The ICDevs.org community and the DFINITY Foundation and the award was paid to [@NatLabs](https://github.com/NatLabs). If you use this library and gain value from it, please consider a [donation](https://icdevs.org/donations.html) to ICDevs.