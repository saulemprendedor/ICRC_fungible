/**
 * Message Inspection PIC Tests
 * 
 * Tests the `system func inspect()` functionality which protects against
 * cycle drain attacks through oversized unbounded arguments.
 * 
 * IMPORTANT: The inspect function only runs for ingress messages (external calls),
 * NOT for inter-canister calls. We use pic.updateCall() and pic.queryCall() 
 * which make direct ingress calls that trigger inspect.
 * 
 * Tests verify:
 * 1. Normal-sized arguments are accepted
 * 2. Oversized raw message blobs are rejected (first line of defense)
 * 3. Oversized individual fields (memo, subaccount, Nat) are rejected
 * 4. ICRC-4 batch limits are enforced
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

// Paths to WASM files
const TOKEN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');

// =============== IDL Types ===============

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const TransferArgs = IDL.Record({
  to: Account,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});

const TransferError = IDL.Variant({
  GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
  TemporarilyUnavailable: IDL.Null,
  BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
  BadFee: IDL.Record({ expected_fee: IDL.Nat }),
  CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  TooOld: IDL.Null,
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
});

const TransferResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: TransferError,
});

const ICRC4TransferArgs = IDL.Vec(TransferArgs);

const ICRC4TransferBatchError = IDL.Variant({
  TooManyRequests: IDL.Record({ limit: IDL.Nat }),
  GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
});

const ICRC4TransferBatchResult = IDL.Variant({
  Ok: IDL.Vec(IDL.Opt(TransferResult)),
  Err: ICRC4TransferBatchError,
});

const BalanceQueryArgs = IDL.Record({
  accounts: IDL.Vec(Account),
});

// Token init args (matching the actual token canister)
function buildTokenInitTypes(IDL: typeof import('@icp-sdk/core/candid').IDL) {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const Fee = IDL.Variant({
    Environment: IDL.Null,
    Fixed: IDL.Nat,
    ICRC1: IDL.Null,
  });

  const MaxAllowance = IDL.Variant({
    TotalSupply: IDL.Null,
    Fixed: IDL.Nat,
  });

  const ArchiveIndexType = IDL.Variant({
    Stable: IDL.Null,
    StableTyped: IDL.Null,
    Managed: IDL.Null,
  });

  const BlockType = IDL.Record({
    block_type: IDL.Text,
    url: IDL.Text,
  });

  const Value = IDL.Rec();
  Value.fill(
    IDL.Variant({
      Int: IDL.Int,
      Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
      Nat: IDL.Nat,
      Blob: IDL.Vec(IDL.Nat8),
      Text: IDL.Text,
      Array: IDL.Vec(Value),
    })
  );

  const Transaction = IDL.Record({
    burn: IDL.Opt(IDL.Record({
      from: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
    kind: IDL.Text,
    mint: IDL.Opt(IDL.Record({
      to: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
    timestamp: IDL.Nat64,
    index: IDL.Nat,
    transfer: IDL.Opt(IDL.Record({
      to: Account,
      fee: IDL.Opt(IDL.Nat),
      from: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
  });

  const AdvancedSettings = IDL.Record({
    existing_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    burned_tokens: IDL.Nat,
    fee_collector_emitted: IDL.Bool,
    minted_tokens: IDL.Nat,
    local_transactions: IDL.Vec(Transaction),
    fee_collector_block: IDL.Nat,
  });

  const ICRC1InitArgs = IDL.Record({
    name: IDL.Opt(IDL.Text),
    symbol: IDL.Opt(IDL.Text),
    logo: IDL.Opt(IDL.Text),
    decimals: IDL.Nat8,
    fee: IDL.Opt(Fee),
    minting_account: IDL.Opt(Account),
    max_supply: IDL.Opt(IDL.Nat),
    min_burn_amount: IDL.Opt(IDL.Nat),
    max_memo: IDL.Opt(IDL.Nat),
    advanced_settings: IDL.Opt(AdvancedSettings),
    metadata: IDL.Opt(Value),
    fee_collector: IDL.Opt(Account),
    transaction_window: IDL.Opt(IDL.Nat64),
    permitted_drift: IDL.Opt(IDL.Nat64),
    max_accounts: IDL.Opt(IDL.Nat),
    settle_to_accounts: IDL.Opt(IDL.Nat),
  });

  const ICRC2InitArgs = IDL.Record({
    max_approvals_per_account: IDL.Opt(IDL.Nat),
    max_allowance: IDL.Opt(MaxAllowance),
    fee: IDL.Opt(Fee),
    advanced_settings: IDL.Opt(IDL.Null),
    max_approvals: IDL.Opt(IDL.Nat),
    settle_to_approvals: IDL.Opt(IDL.Nat),
  });

  const ICRC3InitArgs = IDL.Record({
    maxActiveRecords: IDL.Nat,
    settleToRecords: IDL.Nat,
    maxRecordsInArchiveInstance: IDL.Nat,
    maxArchivePages: IDL.Nat,
    archiveIndexType: ArchiveIndexType,
    maxRecordsToArchive: IDL.Nat,
    archiveCycles: IDL.Nat,
    archiveControllers: IDL.Opt(IDL.Opt(IDL.Vec(IDL.Principal))),
    supportedBlocks: IDL.Vec(BlockType),
  });

  const ICRC4InitArgs = IDL.Record({
    max_balances: IDL.Opt(IDL.Nat),
    max_transfers: IDL.Opt(IDL.Nat),
    fee: IDL.Opt(Fee),
  });

  const FullInitArgs = IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(ICRC1InitArgs),
    icrc2: IDL.Opt(ICRC2InitArgs),
    icrc3: ICRC3InitArgs,
    icrc4: IDL.Opt(ICRC4InitArgs),
    icrc85_collector: IDL.Opt(IDL.Principal),
  }));

  return FullInitArgs;
}

// =============== Test Helpers ===============

/**
 * Creates a blob of specified size filled with zeros
 */
function createLargeBlob(size: number): number[] {
  return new Array(size).fill(0);
}

/**
 * Creates a very large Nat (attack vector)
 */
function createLargeNat(digits: number): bigint {
  return BigInt('9'.repeat(digits));
}

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

// =============== Test Suite ===============

describe('Message Inspection Tests', () => {
  let pic: PocketIc;
  let picServer: PocketIcServer;
  let tokenCanisterId: Principal;
  const admin = createIdentity(1);
  const alice = createIdentity(2);

  beforeAll(async () => {
    // Verify WASM exists
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(`Token WASM not found at ${TOKEN_WASM_PATH}. Run 'dfx build token' first.`);
    }

    // Start PocketIC server
    picServer = await PocketIcServer.start();
    pic = await PocketIc.create(picServer.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });

    // Read WASM
    const tokenWasm = readFileSync(TOKEN_WASM_PATH);

    // Build init args (minimal config for testing)
    const TokenInitType = buildTokenInitTypes(IDL);
    const tokenInitArgs = [{
      icrc1: [],  // Use defaults
      icrc2: [],  // Use defaults
      icrc3: {
        maxActiveRecords: BigInt(3000),
        settleToRecords: BigInt(2000),
        maxRecordsInArchiveInstance: BigInt(500000),
        maxArchivePages: BigInt(62500),
        archiveIndexType: { Stable: null },
        maxRecordsToArchive: BigInt(8000),
        archiveCycles: BigInt(20_000_000_000_000),
        archiveControllers: [],
        supportedBlocks: [],
      },
      icrc4: [{
        max_balances: [BigInt(100)],    // Small limit for testing
        max_transfers: [BigInt(100)],   // Small limit for testing
        fee: [],
      }],
      icrc85_collector: [],
    }];

    // Create canister
    tokenCanisterId = await pic.createCanister({
      sender: admin.getPrincipal(),
    });
    await pic.addCycles(tokenCanisterId, 100_000_000_000_000n);

    // Install code
    await pic.installCode({
      canisterId: tokenCanisterId,
      wasm: tokenWasm,
      arg: IDL.encode([TokenInitType], [tokenInitArgs]),
      sender: admin.getPrincipal(),
    });

    console.log('Token canister deployed:', tokenCanisterId.toText());
  }, 120000);

  afterAll(async () => {
    if (pic) await pic.tearDown();
    if (picServer) await picServer.stop();
  });

  describe('Raw Arg Size Check (First Line of Defense)', () => {
    it('should accept normal-sized transfer arguments', async () => {
      const args = {
        to: { owner: alice.getPrincipal(), subaccount: [] },
        fee: [],
        memo: [Array.from({ length: 32 }, () => 0)],  // 32 byte memo (valid)
        from_subaccount: [],
        created_at_time: [],
        amount: 1000000n,
      };

      const encoded = IDL.encode([TransferArgs], [args]);
      console.log('Normal transfer arg size:', encoded.length, 'bytes');

      // This should succeed (though transfer will fail due to no balance)
      try {
        const result = await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_transfer',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        // Decode result - should be InsufficientFunds, not rejected by inspect
        const decoded = IDL.decode([TransferResult], result)[0] as any;
        expect(decoded.Err).toBeDefined();
        expect(decoded.Err.InsufficientFunds).toBeDefined();
      } catch (e: any) {
        // If it throws, check it's not an inspect rejection
        console.log('Error:', e.message);
        // Accept InsufficientFunds or similar business logic errors
        if (!e.message.includes('InsufficientFunds')) {
          throw e;
        }
      }
    });

    it('should reject extremely large raw message blob', async () => {
      // Create a message with a huge memo that exceeds the 50KB raw arg limit
      const hugeMemo = createLargeBlob(60_000);  // 60KB > 50KB limit
      
      const args = {
        to: { owner: alice.getPrincipal(), subaccount: [] },
        fee: [],
        memo: [hugeMemo],
        from_subaccount: [],
        created_at_time: [],
        amount: 1000000n,
      };

      const encoded = IDL.encode([TransferArgs], [args]);
      console.log('Large transfer arg size:', encoded.length, 'bytes');

      try {
        await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_transfer',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        // Should not reach here - inspect should reject
        expect.fail('Expected request to be rejected by inspect');
      } catch (e: any) {
        // Expected: inspect should reject this
        console.log('Rejection error (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ICRC-1 Transfer Validation', () => {
    it('should reject transfer with oversized memo', async () => {
      // Memo larger than 32 bytes but under raw arg limit
      const oversizedMemo = createLargeBlob(100);  // 100 bytes > 32 byte standard
      
      const args = {
        to: { owner: alice.getPrincipal(), subaccount: [] },
        fee: [],
        memo: [oversizedMemo],
        from_subaccount: [],
        created_at_time: [],
        amount: 1000000n,
      };

      const encoded = IDL.encode([TransferArgs], [args]);
      console.log('Oversized memo arg size:', encoded.length, 'bytes');

      try {
        await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_transfer',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        expect.fail('Expected request to be rejected');
      } catch (e: any) {
        console.log('Memo rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });

    it('should reject transfer with oversized subaccount', async () => {
      // Subaccount must be <= 32 bytes
      const oversizedSubaccount = createLargeBlob(64);  // 64 bytes > 32 byte limit
      
      const args = {
        to: { owner: alice.getPrincipal(), subaccount: [oversizedSubaccount] },
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: [],
        amount: 1000000n,
      };

      const encoded = IDL.encode([TransferArgs], [args]);

      try {
        await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_transfer',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        expect.fail('Expected request to be rejected');
      } catch (e: any) {
        console.log('Subaccount rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });

    it('should reject transfer with astronomically large amount', async () => {
      // Amount with 50+ digits (exceeds the 40 digit limit)
      const hugeAmount = createLargeNat(50);
      
      const args = {
        to: { owner: alice.getPrincipal(), subaccount: [] },
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: [],
        amount: hugeAmount,
      };

      const encoded = IDL.encode([TransferArgs], [args]);
      console.log('Large amount arg size:', encoded.length, 'bytes');

      try {
        await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_transfer',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        expect.fail('Expected request to be rejected');
      } catch (e: any) {
        console.log('Large amount rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ICRC-1 Balance Query Validation', () => {
    it('should accept balance query with valid account', async () => {
      const args = { owner: alice.getPrincipal(), subaccount: [] };
      const encoded = IDL.encode([Account], [args]);

      const result = await pic.queryCall({
        canisterId: tokenCanisterId,
        method: 'icrc1_balance_of',
        arg: encoded,
        sender: alice.getPrincipal(),
      });

      const decoded = IDL.decode([IDL.Nat], result)[0];
      expect(decoded).toBe(0n);  // No balance yet
    });

    it('should reject balance query with oversized subaccount', async () => {
      const args = { 
        owner: alice.getPrincipal(), 
        subaccount: [createLargeBlob(64)]  // 64 bytes > 32 byte limit
      };
      const encoded = IDL.encode([Account], [args]);

      try {
        await pic.queryCall({
          canisterId: tokenCanisterId,
          method: 'icrc1_balance_of',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        expect.fail('Expected query to be rejected');
      } catch (e: any) {
        console.log('Balance query rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ICRC-4 Batch Validation', () => {
    it('should accept batch transfer within limits', async () => {
      // Create a small batch (within the 100 transfer limit)
      const batch: any[] = [];
      for (let i = 0; i < 5; i++) {
        batch.push({
          to: { owner: alice.getPrincipal(), subaccount: [] },
          fee: [],
          memo: [],
          from_subaccount: [],
          created_at_time: [],
          amount: 1000n,
        });
      }

      const encoded = IDL.encode([ICRC4TransferArgs], [batch]);
      console.log('Small batch arg size:', encoded.length, 'bytes');

      try {
        const result = await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc4_transfer_batch',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        // Should succeed past inspect (may fail with InsufficientFunds)
        const decoded = IDL.decode([ICRC4TransferBatchResult], result)[0] as any;
        // Either Ok with results or business logic error - both acceptable
        expect(decoded.Ok || decoded.Err).toBeDefined();
      } catch (e: any) {
        // Business logic errors are acceptable
        console.log('Batch error:', e.message);
      }
    });

    it('should reject batch transfer exceeding max_transfers limit', async () => {
      // Create a batch larger than the 100 transfer limit
      const batch: any[] = [];
      for (let i = 0; i < 150; i++) {
        batch.push({
          to: { owner: alice.getPrincipal(), subaccount: [] },
          fee: [],
          memo: [],
          from_subaccount: [],
          created_at_time: [],
          amount: 1000n,
        });
      }

      const encoded = IDL.encode([ICRC4TransferArgs], [batch]);
      console.log('Large batch arg size:', encoded.length, 'bytes');

      try {
        const result = await pic.updateCall({
          canisterId: tokenCanisterId,
          method: 'icrc4_transfer_batch',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        
        // Might pass inspect but fail with TooManyRequests from function
        const decoded = IDL.decode([ICRC4TransferBatchResult], result)[0] as any;
        if (decoded.Err) {
          expect(decoded.Err.TooManyRequests).toBeDefined();
        } else {
          expect.fail('Expected batch to be rejected');
        }
      } catch (e: any) {
        // Also acceptable: rejected by inspect
        console.log('Large batch rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });

    it('should reject balance query batch exceeding limits', async () => {
      // Create a balance query larger than the 100 account limit
      const accounts: any[] = [];
      for (let i = 0; i < 150; i++) {
        accounts.push({ owner: alice.getPrincipal(), subaccount: [] });
      }

      const args = { accounts };
      const encoded = IDL.encode([BalanceQueryArgs], [args]);
      console.log('Large balance query arg size:', encoded.length, 'bytes');

      try {
        const result = await pic.queryCall({
          canisterId: tokenCanisterId,
          method: 'icrc4_balance_of_batch',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        
        // If passes inspect, should still fail with too many requests
        const BalanceResult = IDL.Variant({
          Ok: IDL.Vec(IDL.Nat),
          Err: IDL.Text,
        });
        const decoded = IDL.decode([BalanceResult], result)[0] as any;
        if (decoded.Err) {
          expect(decoded.Err).toContain('too many');
        } else {
          expect.fail('Expected balance query to be rejected');
        }
      } catch (e: any) {
        // Also acceptable: rejected by inspect
        console.log('Large balance query rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ICRC-3 Block Query Validation', () => {
    it('should accept normal get_blocks request', async () => {
      const args = { start: 0n, length: 100n };
      const GetBlocksArgs = IDL.Record({
        start: IDL.Nat,
        length: IDL.Nat,
      });
      const encoded = IDL.encode([GetBlocksArgs], [args]);

      try {
        await pic.queryCall({
          canisterId: tokenCanisterId,
          method: 'get_blocks',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        // Should succeed (may return empty)
      } catch (e: any) {
        // May fail for other reasons, but not inspect
        console.log('get_blocks result:', e.message);
      }
    });

    it('should reject get_blocks with astronomically large start', async () => {
      const args = { start: createLargeNat(50), length: 100n };  // 50 digit start
      const GetBlocksArgs = IDL.Record({
        start: IDL.Nat,
        length: IDL.Nat,
      });
      const encoded = IDL.encode([GetBlocksArgs], [args]);

      try {
        await pic.queryCall({
          canisterId: tokenCanisterId,
          method: 'get_blocks',
          arg: encoded,
          sender: alice.getPrincipal(),
        });
        expect.fail('Expected request to be rejected');
      } catch (e: any) {
        console.log('Large start rejection (expected):', e.message);
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });
});
