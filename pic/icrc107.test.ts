/**
 * ICRC-107 PIC Tests
 * 
 * Tests the ICRC-107 (Fee Collector Management) implementation:
 * 1. get_fee_collector returns null when no fee collector is set
 * 2. Owner can set the fee collector
 * 3. get_fee_collector returns the set account
 * 4. Non-owner is rejected with AccessDenied
 * 5. Duplicate created_at_time is rejected
 * 6. TooOld created_at_time is rejected
 * 7. CreatedInFuture created_at_time is rejected
 * 8. Setting fee_collector to null clears it
 * 9. 107feecol block is recorded in ICRC-3 log
 * 10. Fee collector persists across upgrade
 * 11. ICRC-107 is in supported standards
 * 12. 107feecol is in supported block types
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

const TOKEN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');

// =============== IDL Types ===============

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const SetFeeCollectorArgs = IDL.Record({
  fee_collector: IDL.Opt(Account),
  created_at_time: IDL.Nat64,
});

const SetFeeCollectorError = IDL.Variant({
  AccessDenied: IDL.Text,
  InvalidAccount: IDL.Text,
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
  TooOld: IDL.Null,
  CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
});

const SetFeeCollectorResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: SetFeeCollectorError,
});

const GetFeeCollectorError = IDL.Variant({
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
});

const GetFeeCollectorResult = IDL.Variant({
  Ok: IDL.Opt(Account),
  Err: GetFeeCollectorError,
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

const TransactionRange = IDL.Record({
  start: IDL.Nat,
  length: IDL.Nat,
});

const ArchivedTransactionResponse = IDL.Record({
  args: IDL.Vec(TransactionRange),
  callback: IDL.Func([IDL.Vec(TransactionRange)], [IDL.Record({
    blocks: IDL.Vec(IDL.Record({ block: Value, id: IDL.Nat })),
    log_length: IDL.Nat,
  })], ['query']),
});

const GetBlocksResult = IDL.Record({
  archived_blocks: IDL.Vec(ArchivedTransactionResponse),
  blocks: IDL.Vec(IDL.Record({ block: Value, id: IDL.Nat })),
  log_length: IDL.Nat,
});

const StandardType = IDL.Record({
  name: IDL.Text,
  url: IDL.Text,
});

const BlockType = IDL.Record({
  block_type: IDL.Text,
  url: IDL.Text,
});

// =============== Token Init ===============

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

  const BlockTypeInit = IDL.Record({
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
    supportedBlocks: IDL.Vec(BlockTypeInit),
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

// =============== Helpers ===============

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

function defaultTokenArgs() {
  return [{
    icrc1: [],
    icrc2: [],
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
      max_balances: [BigInt(100)],
      max_transfers: [BigInt(100)],
      fee: [],
    }],
    icrc85_collector: [],
  }];
}

function nowNanos(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

// =============== Test Suite ===============

describe('ICRC-107 Fee Collector Management Tests', () => {
  let pic: PocketIc;
  let picServer: PocketIcServer;
  let tokenCanisterId: Principal;
  const admin = createIdentity(20);
  const nonAdmin = createIdentity(21);
  const feeCollectorIdentity = createIdentity(22);
  const feeCollectorAccount = {
    owner: feeCollectorIdentity.getPrincipal(),
    subaccount: [],
  };
  const feeCollector2Identity = createIdentity(23);
  const feeCollectorAccount2 = {
    owner: feeCollector2Identity.getPrincipal(),
    subaccount: [],
  };

  beforeAll(async () => {
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(`Token WASM not found at ${TOKEN_WASM_PATH}. Run 'dfx build token' first.`);
    }

    picServer = await PocketIcServer.start();
    pic = await PocketIc.create(picServer.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });

    const tokenWasm = readFileSync(TOKEN_WASM_PATH);
    const TokenInitType = buildTokenInitTypes(IDL);

    tokenCanisterId = await pic.createCanister({
      sender: admin.getPrincipal(),
    });
    await pic.addCycles(tokenCanisterId, 100_000_000_000_000n);

    await pic.installCode({
      canisterId: tokenCanisterId,
      wasm: tokenWasm,
      arg: IDL.encode([TokenInitType], [defaultTokenArgs()]),
      sender: admin.getPrincipal(),
    });

    console.log('Token canister deployed:', tokenCanisterId.toText());
  }, 120000);

  afterAll(async () => {
    if (pic) await pic.tearDown();
    if (picServer) await picServer.stop();
  });

  it('should return Ok(null) when no fee collector is set', async () => {
    const result = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([GetFeeCollectorResult], result)[0] as any;
    expect(decoded.Ok).toBeDefined();
    // Ok contains opt Account — empty means no fee collector
    expect(decoded.Ok).toHaveLength(0);
  });

  it('should allow owner to set the fee collector', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount],
        created_at_time: now,
      }]),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([SetFeeCollectorResult], result)[0] as any;
    expect(decoded.Ok).toBeDefined();
    expect(typeof decoded.Ok).toBe('bigint');
    // Block index should be >= 0
    expect(decoded.Ok).toBeGreaterThanOrEqual(0n);
  });

  it('should return the set fee collector account', async () => {
    const result = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([GetFeeCollectorResult], result)[0] as any;
    expect(decoded.Ok).toBeDefined();
    expect(decoded.Ok).toHaveLength(1);
    const account = decoded.Ok[0];
    expect(account.owner.toText()).toEqual(feeCollectorIdentity.getPrincipal().toText());
  });

  it('should reject non-owner with AccessDenied', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount2],
        created_at_time: now,
      }]),
      sender: nonAdmin.getPrincipal(),
    });

    const decoded = IDL.decode([SetFeeCollectorResult], result)[0] as any;
    expect(decoded.Err).toBeDefined();
    expect(decoded.Err.AccessDenied).toBeDefined();
  });

  it('should reject duplicate created_at_time', async () => {
    // Use the same created_at_time as the first successful set
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    // First call should succeed
    const result1 = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount2],
        created_at_time: now,
      }]),
      sender: admin.getPrincipal(),
    });
    const decoded1 = IDL.decode([SetFeeCollectorResult], result1)[0] as any;
    expect(decoded1.Ok).toBeDefined();

    // Second call with same created_at_time and same args should return Duplicate
    const result2 = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount2],
        created_at_time: now,
      }]),
      sender: admin.getPrincipal(),
    });
    const decoded2 = IDL.decode([SetFeeCollectorResult], result2)[0] as any;
    expect(decoded2.Err).toBeDefined();
    expect(decoded2.Err.Duplicate).toBeDefined();
    expect(decoded2.Err.Duplicate.duplicate_of).toBeDefined();
  });

  it('should reject TooOld created_at_time', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    // Set created_at_time to way in the past (> transaction_window + permitted_drift)
    // Default transaction_window = 86_400_000_000_000 (24h), permitted_drift = 60_000_000_000 (60s)
    const tooOld = now - 100_000_000_000_000n; // ~27.7 hours ago, well past the window
    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount],
        created_at_time: tooOld,
      }]),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([SetFeeCollectorResult], result)[0] as any;
    expect(decoded.Err).toBeDefined();
    expect(decoded.Err.TooOld).toBeDefined();
  });

  it('should reject CreatedInFuture created_at_time', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    // Set created_at_time to far in the future
    const future = now + 86_400_000_000_000n; // 24 hours in future
    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount],
        created_at_time: future,
      }]),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([SetFeeCollectorResult], result)[0] as any;
    expect(decoded.Err).toBeDefined();
    expect(decoded.Err.CreatedInFuture).toBeDefined();
    expect(decoded.Err.CreatedInFuture.ledger_time).toBeDefined();
  });

  it('should clear fee collector when set to null', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [],
        created_at_time: now,
      }]),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([SetFeeCollectorResult], result)[0] as any;
    expect(decoded.Ok).toBeDefined();

    // Verify it's cleared
    const getResult = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    const getDecoded = IDL.decode([GetFeeCollectorResult], getResult)[0] as any;
    expect(getDecoded.Ok).toBeDefined();
    expect(getDecoded.Ok).toHaveLength(0);
  });

  it('should record 107feecol block in ICRC-3 log', async () => {
    const now = nowNanos();
    await pic.setTime(Number(now / 1_000_000n));
    await pic.tick(2);

    // Set fee collector and get block index
    const setResult = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [{
        fee_collector: [feeCollectorAccount],
        created_at_time: now,
      }]),
      sender: admin.getPrincipal(),
    });
    const setDecoded = IDL.decode([SetFeeCollectorResult], setResult)[0] as any;
    expect(setDecoded.Ok).toBeDefined();
    const blockIndex = setDecoded.Ok;

    // Query the block from ICRC-3
    const blocksResult = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc3_get_blocks',
      arg: IDL.encode([IDL.Vec(TransactionRange)], [[{ start: blockIndex, length: 1n }]]),
      sender: admin.getPrincipal(),
    });
    const blocks = IDL.decode([GetBlocksResult], blocksResult)[0] as any;
    
    expect(blocks.blocks).toHaveLength(1);
    const block = blocks.blocks[0].block;
    
    // The block should be a Map at the top level
    expect(block.Map).toBeDefined();
    const blockMap = new Map(block.Map.map(([k, v]: [string, any]) => [k, v]));
    
    // Should have btype = "107feecol"
    expect(blockMap.has('btype')).toBe(true);
    expect((blockMap.get('btype') as any).Text).toBe('107feecol');
    
    // Should have a tx map
    expect(blockMap.has('tx')).toBe(true);
    const txMap = new Map((blockMap.get('tx') as any).Map.map(([k, v]: [string, any]) => [k, v]));
    
    // tx should have mthd = "107set_fee_collector"
    expect(txMap.has('mthd')).toBe(true);
    expect((txMap.get('mthd') as any).Text).toBe('107set_fee_collector');
    
    // tx should have caller
    expect(txMap.has('caller')).toBe(true);
    
    // tx should have fee_collector
    expect(txMap.has('fee_collector')).toBe(true);
  });

  it('should persist fee collector across upgrade', async () => {
    // First confirm that fee collector is currently set (from previous test)
    const preResult = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    const preDecoded = IDL.decode([GetFeeCollectorResult], preResult)[0] as any;
    expect(preDecoded.Ok).toBeDefined();
    expect(preDecoded.Ok).toHaveLength(1);
    expect(preDecoded.Ok[0].owner.toText()).toEqual(feeCollectorIdentity.getPrincipal().toText());

    // Upgrade the canister
    const tokenWasm = readFileSync(TOKEN_WASM_PATH);
    const TokenInitType = buildTokenInitTypes(IDL);

    await pic.upgradeCanister({
      canisterId: tokenCanisterId,
      wasm: tokenWasm,
      arg: IDL.encode([TokenInitType], [defaultTokenArgs()]),
      sender: admin.getPrincipal(),
      upgradeModeOptions: {
        skip_pre_upgrade: [],
        wasm_memory_persistence: [{ keep: null }],
      },
    });

    // Verify fee collector persists
    const postResult = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    const postDecoded = IDL.decode([GetFeeCollectorResult], postResult)[0] as any;
    expect(postDecoded.Ok).toBeDefined();
    expect(postDecoded.Ok).toHaveLength(1);
    expect(postDecoded.Ok[0].owner.toText()).toEqual(feeCollectorIdentity.getPrincipal().toText());
  });

  it('should include ICRC-107 in supported standards', async () => {
    const result = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc10_supported_standards',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([IDL.Vec(StandardType)], result)[0] as any[];
    const icrc107Standard = decoded.find((s: any) => s.name === 'ICRC-107');
    expect(icrc107Standard).toBeDefined();
    expect(icrc107Standard.url).toContain('ICRC-107');
  });

  it('should include 107feecol in supported block types', async () => {
    const result = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc3_supported_block_types',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });

    const decoded = IDL.decode([IDL.Vec(BlockType)], result)[0] as any[];
    const feecolBlock = decoded.find((b: any) => b.block_type === '107feecol');
    expect(feecolBlock).toBeDefined();
    expect(feecolBlock.url).toContain('ICRC-107');
  });
});
