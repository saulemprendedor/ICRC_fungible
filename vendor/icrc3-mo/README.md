# icrc3.mo

A Motoko implementation of the [ICRC-3 Transaction Log Standard](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) for the Internet Computer. This library provides certified transaction logging with automatic archiving, parent hash chaining, and full standards compliance.

## Features

- ✅ Full ICRC-3 specification compliance
- ✅ Certified data with Merkle tree proofs
- ✅ Automatic transaction archiving to child canisters
- ✅ Parent hash (`phash`) chaining for block integrity
- ✅ LEB128-encoded block indices for certificates
- ✅ Legacy transaction format support (Rosetta compatibility)
- ✅ ClassPlus pattern for state management and migrations
- ✅ ICRC-85 Open Value Sharing integration

## Installation

```bash
mops add icrc3-mo
```

## Quick Start

```motoko
import ICRC3 "mo:icrc3.mo";
```

## API Reference

### Standard ICRC-3 Endpoints

| Function | Type | Description |
|----------|------|-------------|
| `icrc3_get_blocks(args)` | Query | Returns blocks and archive callbacks for given ranges |
| `icrc3_get_archives(args)` | Query | Returns list of archive canisters with block ranges |
| `icrc3_get_tip_certificate()` | Query | Returns certified hash tree with last block index/hash |
| `icrc3_supported_block_types()` | Query | Returns array of supported block type descriptors |

### Library Methods

| Method | Description |
|--------|-------------|
| `add_record<system>(transaction, top_level)` | Add a transaction to the log, returns block index |
| `get_blocks(args)` | Get blocks for given ranges with archive callbacks |
| `get_archives(args)` | Get list of archive canisters |
| `get_tip_certificate()` | Get certification data |
| `get_tip()` | Get last block index and hash |
| `get_stats()` | Get current library statistics |
| `supported_block_types()` | Get registered block types |
| `update_supported_blocks(blocks)` | Register custom block types |
| `update_settings(settings)` | Update archive configuration |
| `register_record_added_listener(namespace, callback)` | Subscribe to new records |
| `check_clean_up<system>()` | Trigger archive process manually |
| `get_blocks_legacy(args)` | Legacy format for older clients |
| `get_blocks_rosetta(args)` | Rosetta-compatible format |
| `get_icrc85_stats()` | Get ICRC-85 Open Value Sharing stats |

### Types

#### Value

The generic value type for transaction data:

```motoko
public type Value = { 
  #Blob : Blob; 
  #Text : Text; 
  #Nat : Nat;
  #Int : Int;
  #Array : [Value]; 
  #Map : [(Text, Value)]; 
};
```

#### Transaction

Alias for `Value` - represents a block in the transaction log.

#### BlockType

Describes a supported block type:

```motoko
public type BlockType = {
  block_type : Text;  // e.g., "1xfer", "2approve"
  url : Text;         // Schema documentation URL
};
```

#### Stats

Library statistics:

```motoko
public type Stats = {
  localLedgerSize : Nat;       // Blocks on main canister
  lastIndex : Nat;             // Latest block index
  firstIndex : Nat;            // First block index on main canister
  archives : [(Principal, TransactionRange)];  // Archive info
  supportedBlocks : [BlockType];
  ledgerCanister : Principal;
  bCleaning : Bool;            // Archiving in progress
  constants : { archiveProperties : {...} };
};
```

#### DataCertificate

Certified data for verification:

```motoko
public type DataCertificate = {
  certificate : Blob;  // IC-signed root hash
  hash_tree : Blob;    // CBOR-encoded Merkle tree
};
```

## Initialization

This library uses the [ClassPlus](https://mops.one/class-plus) pattern for state management and migrations.

### Full Example

```motoko
import ICRC3 "mo:icrc3.mo";
import Principal "mo:core/Principal";
import CertTree "mo:ic-certification/CertTree";
import ClassPlus "mo:class-plus";

shared(init_msg) actor class Example(_args: ?ICRC3.InitArgs) = this {

  stable let cert_store : CertTree.Store = CertTree.newStore();
  let ct = CertTree.Ops(cert_store);

  let manager = ClassPlus.ClassPlusInitializationManager(
    init_msg.caller, 
    Principal.fromActor(this), 
    true
  );

  private func get_icrc3_environment() : ICRC3.Environment {
    {
      updated_certification = ?updated_certification;
      get_certificate_store = ?get_certificate_store;
    };
  };

  private func get_certificate_store() : CertTree.Store {
    return cert_store;
  };

  private func updated_certification(_cert: Blob, _lastIndex: Nat) : Bool {
    ct.setCertifiedData();
    return true;
  };

  stable var icrc3_migration_state = ICRC3.initialState();

  let icrc3 = ICRC3.Init<system>({
    org_icdevs_class_plus_manager = manager;
    initialState = icrc3_migration_state;
    args = _args;
    pullEnvironment = ?get_icrc3_environment;
    onInitialize = ?(func(newClass: ICRC3.ICRC3) : async*() {
      if (newClass.stats().supportedBlocks.size() == 0) {
        newClass.update_supported_blocks([
          { block_type = "my_custom_tx"; url = "https://docs.example.com/schema" }
        ]);
      };
    });
    onStorageChange = func(state: ICRC3.State) {
      icrc3_migration_state := state;
    };
  });

  // Standard ICRC-3 endpoints
  public query func icrc3_get_blocks(args: ICRC3.GetBlocksArgs) : async ICRC3.GetBlocksResult {
    return icrc3().get_blocks(args);
  };

  public query func icrc3_get_archives(args: ICRC3.GetArchivesArgs) : async ICRC3.GetArchivesResult {
    return icrc3().get_archives(args);
  };

  public query func icrc3_supported_block_types() : async [ICRC3.BlockType] {
    return icrc3().supported_block_types();
  };

  public query func icrc3_get_tip_certificate() : async ?ICRC3.DataCertificate {
    return icrc3().get_tip_certificate();
  };

  // Additional utility endpoints
  public query func get_tip() : async ICRC3.Tip {
    return icrc3().get_tip();
  };

  public query func icrc3_get_stats() : async ICRC3.Stats {
    return icrc3().get_stats();
  };
};
```

### InitArgs

Configuration options for the ICRC3 component:

```motoko
public type InitArgs = {
  maxActiveRecords : Nat;         // Max blocks on main canister before archiving
  settleToRecords : Nat;          // Target block count after archiving
  maxRecordsInArchiveInstance : Nat; // Max blocks per archive canister
  maxArchivePages : Nat;          // Max stable memory pages per archive
  archiveIndexType : SW.IndexType; // Index type for stable memory
  maxRecordsToArchive : Nat;      // Blocks to archive per round
  archiveCycles : Nat;            // Cycles for new archive canisters
  archiveControllers : ?[Principal]; // Archive controllers (canister added automatically)
};
```

### Recommended Configuration

For production deployments:

```motoko
?{
  maxActiveRecords = 2000;          // Keep 2000 blocks on main canister
  settleToRecords = 1000;           // Archive down to 1000 blocks
  maxRecordsInArchiveInstance = 1_000_000;
  maxArchivePages = 62500;          // ~4GB stable memory
  archiveIndexType = #Stable;
  maxRecordsToArchive = 1000;       // Archive 1000 blocks per round
  archiveCycles = 2_000_000_000_000; // 2T cycles per archive
  archiveControllers = null;        // Use default controllers
}
```

## Adding Transactions

```motoko
// Create a transaction value
let transaction : ICRC3.Value = #Map([
  ("op", #Text("transfer")),
  ("from", #Blob(Principal.toBlob(sender))),
  ("to", #Blob(Principal.toBlob(recipient))),
  ("amt", #Nat(amount)),
  ("ts", #Nat(Int.abs(Time.now())))
]);

// Add to log - returns the block index
let blockIndex = icrc3().add_record<system>(transaction, null);
```

## Listening for New Records

```motoko
icrc3().register_record_added_listener("my_listener", func(
  transaction: ICRC3.Transaction, 
  index: Nat
) : () {
  // Handle new transaction
  Debug.print("New block at index: " # Nat.toText(index));
});
```

## Interface Hooks

The library provides a hook system via `Interface.mo` for customizing query behavior without modifying core code. Hooks can intercept queries before execution or transform results after.

### Hook Types

```motoko
// Context passed to all hooks
public type QueryContext<T> = {
  args: T;
  caller: ?Principal;
};

// Before hook - return ?R to short-circuit, null to continue
public type QueryBeforeHook<T, R> = (QueryContext<T>) -> ?R;

// After hook - transform the result
public type QueryAfterHook<T, R> = (QueryContext<T>, R) -> R;
```

### Available Hook Points

| Endpoint | Before Hook | After Hook |
|----------|-------------|------------|
| `icrc3_get_blocks` | `beforeGetBlocks` | `afterGetBlocks` |
| `icrc3_get_archives` | `beforeGetArchives` | `afterGetArchives` |
| `icrc3_get_tip_certificate` | `beforeGetTipCertificate` | `afterGetTipCertificate` |
| `icrc3_supported_block_types` | `beforeSupportedBlockTypes` | `afterSupportedBlockTypes` |
| `get_tip` | `beforeGetTip` | `afterGetTip` |
| `get_blocks` (legacy) | `beforeLegacyGetBlocks` | `afterLegacyGetBlocks` |
| `get_transactions` (legacy) | `beforeLegacyGetTransactions` | `afterLegacyGetTransactions` |

### Using Hooks

```motoko
import ICRC3Interface "mo:icrc3.mo/Interface";

// Get the default interface
let iface = ICRC3Interface.defaultInterface(icrc3);

// Add a before hook that logs all block queries
ICRC3Interface.addBeforeGetBlocks(iface, "logger", func(ctx) {
  Debug.print("Block query from: " # debug_show(ctx.caller));
  null  // Return null to continue, ?result to short-circuit
});

// Add an after hook that filters results
ICRC3Interface.addAfterGetBlocks(iface, "filter", func(ctx, result) {
  // Transform the result
  result
});

// Remove a hook by name
ICRC3Interface.removeBeforeGetBlocks(iface, "logger");
```

### Helper Functions

Each endpoint has add/remove helpers:

```motoko
// GetBlocks
addBeforeGetBlocks(iface, name, hook)
removeBeforeGetBlocks(iface, name)
addAfterGetBlocks(iface, name, hook)
removeAfterGetBlocks(iface, name)

// GetArchives
addBeforeGetArchives(iface, name, hook)
removeBeforeGetArchives(iface, name)
addAfterGetArchives(iface, name, hook)
removeAfterGetArchives(iface, name)

// And similar for all other endpoints...
```

## Archival System

The library automatically archives transactions when `maxActiveRecords` is exceeded:

1. **Trigger**: Each `add_record` call checks if archiving is needed
2. **Timer-based**: Archiving runs in the next round via timers
3. **Chunked**: Archives `maxRecordsToArchive` blocks per round
4. **Cascading**: Creates new archive canisters when current ones fill up

### Archive Canister Management

Archive canisters are automatically created and managed. Each archive:

- Uses stable memory for persistence
- Has the parent canister as a controller
- Implements the ICRC-3 query interface
- Supports the same block query methods

## ICRC-3 Compliance

This library is fully compliant with the [ICRC-3 standard](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3):

| Requirement | Status |
|-------------|--------|
| `icrc3_get_blocks` | ✅ Implemented |
| `icrc3_get_archives` | ✅ Implemented |
| `icrc3_get_tip_certificate` | ✅ Implemented |
| `icrc3_supported_block_types` | ✅ Implemented |
| Block hashing (representation-independent) | ✅ Implemented |
| `phash` parent hash chaining | ✅ Implemented |
| LEB128-encoded block indices | ✅ Implemented (fixed in v0.3.6) |
| Certificate hash tree | ✅ Implemented |

### Standard Block Types

The library supports standard ICRC block types:

| Type | Description |
|------|-------------|
| `1mint` | ICRC-1 mint operation |
| `1burn` | ICRC-1 burn operation |
| `1xfer` | ICRC-1 transfer |
| `2approve` | ICRC-2 approval |
| `2xfer` | ICRC-2 transfer from |

Register custom types with `update_supported_blocks()`.

## ICRC-85 Open Value Sharing

This library implements [ICRC-85 Open Value Sharing](https://github.com/icdevsorg/ovs-ledger/blob/main/icrc85.md) to support sustainable open-source development on the Internet Computer.

### Default Behavior

By default, this library shares a small portion of cycles with ICDevs.org to fund continued development:

| Parameter | Value |
|-----------|-------|
| **Base Amount** | 1 XDR (~1T cycles) per month |
| **Activity Bonus** | +1 XDR per 10,000 archived blocks |
| **Maximum** | 100 XDR per sharing period |
| **Grace Period** | 7 days after initial deploy |
| **Collector** | `q26le-iqaaa-aaaam-actsa-cai` (ICDevs OVS Ledger) |
| **Namespace** | `org.icdevs.icrc85.icrc3` |

### Archive OVS

Archive canisters also participate in OVS independently with namespace `org.icdevs.icrc85.icrc3archive`.


### OVS Statistics

Monitor OVS activity via `get_icrc85_stats()`:

```motoko
public query func get_icrc85_stats() : async ICRC3.ICRC85Stats {
  icrc3().get_icrc85_stats();
};
```

### Why OVS?

- **Sustainable Development**: Fund ongoing maintenance and improvements
- **Fair Distribution**: Libraries report usage, cycles are shared proportionally
- **Voluntary**: Full control to disable or redirect contributions
- **Transparent**: All transactions logged on the OVS Ledger (ICRC-3 compliant)

For more information, see the [ICRC-85 specification](https://github.com/icdevsorg/ovs-ledger/blob/main/icrc85.md).

## Security Considerations

### Certification

- All block data is certified via IC's certification system
- Clients should verify certificates using the IC's public key
- The `hash_tree` in `DataCertificate` contains Merkle proofs

### Archive Security

- Archive canisters inherit controllers from the parent
- Only the parent canister can append transactions
- Archives use stable memory for crash resistance

### Block Integrity

- Each block contains `phash` (parent hash) linking to the previous block
- Representation-independent hashing ensures consistent block hashes
- Any tampering breaks the hash chain


## Testing

### Unit Tests

```bash
mops test
```

### Compliance Tests

```bash
mops test icrc3.compliance
```

### PocketIC Integration Tests

```bash
cd pic && npm test
```

The test suite includes:

- LEB128 encoding validation with DFINITY test vectors
- Block schema validation
- Certificate structure validation
- Value type and account encoding tests
- Archive creation and querying
- Parent hash chaining verification

## Transaction Log Best Practices

### Sizing Guidelines

- **Main canister**: Keep small (1000-2000 blocks) for fast queries
- **Archive size**: 4GB stable memory supports ~1M variable-size blocks
- **Archive frequency**: Balance between overhead and main canister size

### Example Configurations

**High-volume token ledger:**
```motoko
maxActiveRecords = 2000;
settleToRecords = 1000;
maxRecordsToArchive = 500;  // Smaller chunks, more frequent
```

**Low-volume governance log:**
```motoko
maxActiveRecords = 10000;
settleToRecords = 5000;
maxRecordsToArchive = 2500;  // Larger chunks, less frequent
```

## Roadmap

- [ ] Archive canister upgrades
- [ ] Multi-subnet archives
- [ ] Archive splitting for subnet moves
- [ ] Automatic memory monitoring
- [ ] Configurable retention policies

## Related Standards

- [ICRC-1](https://github.com/dfinity/ICRC-1) - Token Standard
- [ICRC-2](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-2) - Approve/Transfer From
- [ICRC-85](https://github.com/icdevs/ICEventsWG/blob/main/Meetings/20240821/icrc85.md) - Open Value Sharing

## License

MIT

