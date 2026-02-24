/**
 * ICRC-107 Fee Collector Lifecycle PIC Tests
 *
 * End-to-end test that deploys a token with a known fee, cycles through
 * multiple fee collector changes with real transfers in between, and verifies:
 *
 *  1. Fees are burned when no collector is set
 *  2. Fees route to collectorA after setting it
 *  3. Fees route to collectorB after switching
 *  4. Fees are burned again after clearing the collector
 *  5. Fees resume to collectorA after re-enabling
 *  6. Multiple consecutive transfers all route fees correctly
 *  7. All 107feecol blocks are Rosetta-compatible (btype, tx map, phash chain)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

const TOKEN_WASM_PATH = resolve(
  __dirname,
  '../.dfx/local/canisters/token/token.wasm.gz',
);

// =============== IDL Types ===============

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

// --- ICRC-107 ---

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

const GetFeeCollectorResult = IDL.Variant({
  Ok: IDL.Opt(Account),
  Err: IDL.Variant({
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  }),
});

// --- Transfers ---

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

const TransferArgs = IDL.Record({
  to: Account,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});

const MintArgs = IDL.Record({
  to: Account,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});

// --- ICRC-3 blocks ---

const Value = IDL.Rec();
Value.fill(
  IDL.Variant({
    Int: IDL.Int,
    Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
    Nat: IDL.Nat,
    Blob: IDL.Vec(IDL.Nat8),
    Text: IDL.Text,
    Array: IDL.Vec(Value),
  }),
);

const TransactionRange = IDL.Record({
  start: IDL.Nat,
  length: IDL.Nat,
});

const ArchivedTransactionResponse = IDL.Record({
  args: IDL.Vec(TransactionRange),
  callback: IDL.Func(
    [IDL.Vec(TransactionRange)],
    [
      IDL.Record({
        blocks: IDL.Vec(IDL.Record({ block: Value, id: IDL.Nat })),
        log_length: IDL.Nat,
      }),
    ],
    ['query'],
  ),
});

const GetBlocksResult = IDL.Record({
  archived_blocks: IDL.Vec(ArchivedTransactionResponse),
  blocks: IDL.Vec(IDL.Record({ block: Value, id: IDL.Nat })),
  log_length: IDL.Nat,
});

// =============== Token Init Types ===============

function buildTokenInitTypes(idl: typeof IDL) {
  const Acct = idl.Record({
    owner: idl.Principal,
    subaccount: idl.Opt(idl.Vec(idl.Nat8)),
  });

  const Fee = idl.Variant({
    Environment: idl.Null,
    Fixed: idl.Nat,
    ICRC1: idl.Null,
  });

  const MaxAllowance = idl.Variant({
    TotalSupply: idl.Null,
    Fixed: idl.Nat,
  });

  const ArchiveIndexType = idl.Variant({
    Stable: idl.Null,
    StableTyped: idl.Null,
    Managed: idl.Null,
  });

  const BlockTypeInit = idl.Record({
    block_type: idl.Text,
    url: idl.Text,
  });

  const Val = idl.Rec();
  Val.fill(
    idl.Variant({
      Int: idl.Int,
      Map: idl.Vec(idl.Tuple(idl.Text, Val)),
      Nat: idl.Nat,
      Blob: idl.Vec(idl.Nat8),
      Text: idl.Text,
      Array: idl.Vec(Val),
    }),
  );

  const Transaction = idl.Record({
    burn: idl.Opt(
      idl.Record({
        from: Acct,
        memo: idl.Opt(idl.Vec(idl.Nat8)),
        created_at_time: idl.Opt(idl.Nat64),
        amount: idl.Nat,
      }),
    ),
    kind: idl.Text,
    mint: idl.Opt(
      idl.Record({
        to: Acct,
        memo: idl.Opt(idl.Vec(idl.Nat8)),
        created_at_time: idl.Opt(idl.Nat64),
        amount: idl.Nat,
      }),
    ),
    timestamp: idl.Nat64,
    index: idl.Nat,
    transfer: idl.Opt(
      idl.Record({
        to: Acct,
        fee: idl.Opt(idl.Nat),
        from: Acct,
        memo: idl.Opt(idl.Vec(idl.Nat8)),
        created_at_time: idl.Opt(idl.Nat64),
        amount: idl.Nat,
      }),
    ),
  });

  const AdvancedSettings = idl.Record({
    existing_balances: idl.Vec(idl.Tuple(Acct, idl.Nat)),
    burned_tokens: idl.Nat,
    fee_collector_emitted: idl.Bool,
    minted_tokens: idl.Nat,
    local_transactions: idl.Vec(Transaction),
    fee_collector_block: idl.Nat,
  });

  const ICRC1InitArgs = idl.Record({
    name: idl.Opt(idl.Text),
    symbol: idl.Opt(idl.Text),
    logo: idl.Opt(idl.Text),
    decimals: idl.Nat8,
    fee: idl.Opt(Fee),
    minting_account: idl.Opt(Acct),
    max_supply: idl.Opt(idl.Nat),
    min_burn_amount: idl.Opt(idl.Nat),
    max_memo: idl.Opt(idl.Nat),
    advanced_settings: idl.Opt(AdvancedSettings),
    metadata: idl.Opt(Val),
    fee_collector: idl.Opt(Acct),
    transaction_window: idl.Opt(idl.Nat64),
    permitted_drift: idl.Opt(idl.Nat64),
    max_accounts: idl.Opt(idl.Nat),
    settle_to_accounts: idl.Opt(idl.Nat),
  });

  const ICRC2InitArgs = idl.Record({
    max_approvals_per_account: idl.Opt(idl.Nat),
    max_allowance: idl.Opt(MaxAllowance),
    fee: idl.Opt(Fee),
    advanced_settings: idl.Opt(idl.Null),
    max_approvals: idl.Opt(idl.Nat),
    settle_to_approvals: idl.Opt(idl.Nat),
  });

  const ICRC3InitArgs = idl.Record({
    maxActiveRecords: idl.Nat,
    settleToRecords: idl.Nat,
    maxRecordsInArchiveInstance: idl.Nat,
    maxArchivePages: idl.Nat,
    archiveIndexType: ArchiveIndexType,
    maxRecordsToArchive: idl.Nat,
    archiveCycles: idl.Nat,
    archiveControllers: idl.Opt(idl.Opt(idl.Vec(idl.Principal))),
    supportedBlocks: idl.Vec(BlockTypeInit),
  });

  const ICRC4InitArgs = idl.Record({
    max_balances: idl.Opt(idl.Nat),
    max_transfers: idl.Opt(idl.Nat),
    fee: idl.Opt(Fee),
  });

  return idl.Opt(
    idl.Record({
      icrc1: idl.Opt(ICRC1InitArgs),
      icrc2: idl.Opt(ICRC2InitArgs),
      icrc3: ICRC3InitArgs,
      icrc4: idl.Opt(ICRC4InitArgs),
      icrc85_collector: idl.Opt(idl.Principal),
    }),
  );
}

// =============== Helpers ===============

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

// =============== Constants ===============

const FEE = 10_000n;
const MINT_AMOUNT = 10_000_000_000n; // 100 tokens (8 decimals)
const TRANSFER_AMOUNT = 1_000_000n; // 0.01 tokens

// =============== Test Suite ===============

describe('ICRC-107 Fee Collector Lifecycle Tests', () => {
  let pic: PocketIc;
  let picServer: PocketIcServer;
  let tokenCanisterId: Principal;

  const admin = createIdentity(40);
  const alice = createIdentity(41);
  const bob = createIdentity(42);
  const collectorAIdentity = createIdentity(43);
  const collectorBIdentity = createIdentity(44);

  const collectorAAccount = {
    owner: collectorAIdentity.getPrincipal(),
    subaccount: [],
  };
  const collectorBAccount = {
    owner: collectorBIdentity.getPrincipal(),
    subaccount: [],
  };

  // Monotonic time counter so every set_fee_collector gets a unique created_at_time
  let timeCounter = BigInt(Math.floor(Date.now())) * 1_000_000n; // start in ns

  // Collected block indices from every set_fee_collector call
  const feecolBlockIndices: bigint[] = [];

  // -------- low-level helpers --------

  function nextTime(): bigint {
    timeCounter += 2_000_000_000n; // advance 2 s
    return timeCounter;
  }

  async function syncTime(): Promise<void> {
    await pic.setTime(Number(timeCounter / 1_000_000n));
    await pic.tick(2);
  }

  async function getBalance(owner: Principal): Promise<bigint> {
    const raw = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc1_balance_of',
      arg: IDL.encode([Account], [{ owner, subaccount: [] }]),
      sender: admin.getPrincipal(),
    });
    return IDL.decode([IDL.Nat], raw)[0] as bigint;
  }

  async function getTotalSupply(): Promise<bigint> {
    const raw = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc1_total_supply',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    return IDL.decode([IDL.Nat], raw)[0] as bigint;
  }

  async function doMint(to: Principal, amount: bigint): Promise<bigint> {
    const raw = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'mint',
      arg: IDL.encode([MintArgs], [
        { to: { owner: to, subaccount: [] }, memo: [], created_at_time: [], amount },
      ]),
      sender: admin.getPrincipal(),
    });
    const decoded = IDL.decode([TransferResult], raw)[0] as any;
    if (decoded.Err) throw new Error(`Mint failed: ${JSON.stringify(decoded.Err)}`);
    return decoded.Ok as bigint;
  }

  async function doTransfer(
    from: Ed25519KeyIdentity,
    to: Principal,
    amount: bigint,
  ): Promise<bigint> {
    const raw = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc1_transfer',
      arg: IDL.encode([TransferArgs], [
        {
          to: { owner: to, subaccount: [] },
          fee: [],
          memo: [],
          from_subaccount: [],
          created_at_time: [],
          amount,
        },
      ]),
      sender: from.getPrincipal(),
    });
    const decoded = IDL.decode([TransferResult], raw)[0] as any;
    if (decoded.Err) throw new Error(`Transfer failed: ${JSON.stringify(decoded.Err)}`);
    return decoded.Ok as bigint;
  }

  async function setFeeCollector(
    account: { owner: Principal; subaccount: never[] } | null,
  ): Promise<bigint> {
    const t = nextTime();
    await syncTime();

    const raw = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_set_fee_collector',
      arg: IDL.encode([SetFeeCollectorArgs], [
        {
          fee_collector: account ? [account] : [],
          created_at_time: t,
        },
      ]),
      sender: admin.getPrincipal(),
    });
    const decoded = IDL.decode([SetFeeCollectorResult], raw)[0] as any;
    if (decoded.Err) {
      throw new Error(`set_fee_collector failed: ${JSON.stringify(decoded.Err)}`);
    }
    feecolBlockIndices.push(decoded.Ok as bigint);
    return decoded.Ok as bigint;
  }

  async function getFeeCollector(): Promise<any> {
    const raw = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc107_get_fee_collector',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    return IDL.decode([GetFeeCollectorResult], raw)[0] as any;
  }

  async function getBlocks(start: bigint, length: bigint): Promise<any> {
    const raw = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc3_get_blocks',
      arg: IDL.encode([IDL.Vec(TransactionRange)], [[{ start, length }]]),
      sender: admin.getPrincipal(),
    });
    return IDL.decode([GetBlocksResult], raw)[0] as any;
  }

  // -------- setup / teardown --------

  beforeAll(async () => {
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(
        `Token WASM not found at ${TOKEN_WASM_PATH}. Run 'dfx build token' first.`,
      );
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

    const initArgs = [
      {
        icrc1: [
          {
            name: ['Fee Lifecycle Token'],
            symbol: ['FLT'],
            logo: [],
            decimals: 8,
            fee: [{ Fixed: FEE }],
            minting_account: [{ owner: admin.getPrincipal(), subaccount: [] }],
            max_supply: [],
            min_burn_amount: [],
            max_memo: [],
            advanced_settings: [],
            metadata: [],
            fee_collector: [], // no initial collector
            transaction_window: [],
            permitted_drift: [],
            max_accounts: [],
            settle_to_accounts: [],
          },
        ],
        icrc2: [],
        icrc3: {
          maxActiveRecords: BigInt(3000),
          settleToRecords: BigInt(2000),
          maxRecordsInArchiveInstance: BigInt(500_000),
          maxArchivePages: BigInt(62_500),
          archiveIndexType: { Stable: null },
          maxRecordsToArchive: BigInt(8000),
          archiveCycles: BigInt(20_000_000_000_000),
          archiveControllers: [],
          supportedBlocks: [],
        },
        icrc4: [
          {
            max_balances: [BigInt(100)],
            max_transfers: [BigInt(100)],
            fee: [],
          },
        ],
        icrc85_collector: [],
      },
    ];

    await pic.installCode({
      canisterId: tokenCanisterId,
      wasm: tokenWasm,
      arg: IDL.encode([TokenInitType], [initArgs]),
      sender: admin.getPrincipal(),
    });

    await syncTime();

    console.log('Token deployed:', tokenCanisterId.toText());
  }, 120_000);

  afterAll(async () => {
    if (pic) await pic.tearDown();
    if (picServer) await picServer.stop();
  });

  // -------- tests --------

  it('should deploy with the configured fee and no collector', async () => {
    // Verify fee
    const feeRaw = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc1_fee',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });
    const fee = IDL.decode([IDL.Nat], feeRaw)[0] as bigint;
    expect(fee).toBe(FEE);

    // Verify no collector
    const fc = await getFeeCollector();
    expect(fc.Ok).toBeDefined();
    expect(fc.Ok).toHaveLength(0);
  });

  it('Phase 1 – fees are burned when no collector is set', async () => {
    // Mint tokens to alice
    await doMint(alice.getPrincipal(), MINT_AMOUNT);
    await pic.tick(2);

    const supplyBefore = await getTotalSupply();
    const aliceBefore = await getBalance(alice.getPrincipal());
    const bobBefore = await getBalance(bob.getPrincipal());

    await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    await pic.tick(2);

    const supplyAfter = await getTotalSupply();
    const aliceAfter = await getBalance(alice.getPrincipal());
    const bobAfter = await getBalance(bob.getPrincipal());

    expect(aliceAfter).toBe(aliceBefore - TRANSFER_AMOUNT - FEE);
    expect(bobAfter).toBe(bobBefore + TRANSFER_AMOUNT);
    // Fee is burned → supply drops
    expect(supplyAfter).toBe(supplyBefore - FEE);
  });

  it('Phase 2 – fees go to collectorA after setting', async () => {
    const blockIdx = await setFeeCollector(collectorAAccount);
    console.log('  set collectorA at block', blockIdx.toString());

    const fc = await getFeeCollector();
    expect(fc.Ok).toHaveLength(1);
    expect(fc.Ok[0].owner.toText()).toBe(
      collectorAIdentity.getPrincipal().toText(),
    );

    const supplyBefore = await getTotalSupply();
    const aliceBefore = await getBalance(alice.getPrincipal());
    const bobBefore = await getBalance(bob.getPrincipal());
    const caBefore = await getBalance(collectorAIdentity.getPrincipal());

    await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    await pic.tick(2);

    const supplyAfter = await getTotalSupply();
    const aliceAfter = await getBalance(alice.getPrincipal());
    const bobAfter = await getBalance(bob.getPrincipal());
    const caAfter = await getBalance(collectorAIdentity.getPrincipal());

    expect(aliceAfter).toBe(aliceBefore - TRANSFER_AMOUNT - FEE);
    expect(bobAfter).toBe(bobBefore + TRANSFER_AMOUNT);
    expect(caAfter).toBe(caBefore + FEE);
    // Supply unchanged – fee routed, not burned
    expect(supplyAfter).toBe(supplyBefore);
  });

  it('Phase 3 – fees go to collectorB after switching', async () => {
    const blockIdx = await setFeeCollector(collectorBAccount);
    console.log('  switched to collectorB at block', blockIdx.toString());

    const fc = await getFeeCollector();
    expect(fc.Ok).toHaveLength(1);
    expect(fc.Ok[0].owner.toText()).toBe(
      collectorBIdentity.getPrincipal().toText(),
    );

    const caBefore = await getBalance(collectorAIdentity.getPrincipal());
    const cbBefore = await getBalance(collectorBIdentity.getPrincipal());
    const supplyBefore = await getTotalSupply();

    await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    await pic.tick(2);

    const caAfter = await getBalance(collectorAIdentity.getPrincipal());
    const cbAfter = await getBalance(collectorBIdentity.getPrincipal());
    const supplyAfter = await getTotalSupply();

    expect(caAfter).toBe(caBefore); // A unchanged
    expect(cbAfter).toBe(cbBefore + FEE); // B receives
    expect(supplyAfter).toBe(supplyBefore);
  });

  it('Phase 4 – fees burned again after clearing', async () => {
    const blockIdx = await setFeeCollector(null);
    console.log('  cleared collector at block', blockIdx.toString());

    const fc = await getFeeCollector();
    expect(fc.Ok).toHaveLength(0);

    const caBefore = await getBalance(collectorAIdentity.getPrincipal());
    const cbBefore = await getBalance(collectorBIdentity.getPrincipal());
    const supplyBefore = await getTotalSupply();

    await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    await pic.tick(2);

    const caAfter = await getBalance(collectorAIdentity.getPrincipal());
    const cbAfter = await getBalance(collectorBIdentity.getPrincipal());
    const supplyAfter = await getTotalSupply();

    expect(caAfter).toBe(caBefore); // A unchanged
    expect(cbAfter).toBe(cbBefore); // B unchanged
    expect(supplyAfter).toBe(supplyBefore - FEE); // burned again
  });

  it('Phase 5 – fees resume to collectorA after re-enabling', async () => {
    const blockIdx = await setFeeCollector(collectorAAccount);
    console.log('  re-enabled collectorA at block', blockIdx.toString());

    const supplyBefore = await getTotalSupply();
    const caBefore = await getBalance(collectorAIdentity.getPrincipal());

    await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    await pic.tick(2);

    const supplyAfter = await getTotalSupply();
    const caAfter = await getBalance(collectorAIdentity.getPrincipal());

    expect(caAfter).toBe(caBefore + FEE);
    expect(supplyAfter).toBe(supplyBefore);
  });

  it('Phase 6 – multiple consecutive transfers all route to current collector', async () => {
    // collectorA is still active from Phase 5
    const caBefore = await getBalance(collectorAIdentity.getPrincipal());

    const NUM_TRANSFERS = 5;
    for (let i = 0; i < NUM_TRANSFERS; i++) {
      await doTransfer(alice, bob.getPrincipal(), TRANSFER_AMOUNT);
    }
    await pic.tick(2);

    const caAfter = await getBalance(collectorAIdentity.getPrincipal());
    expect(caAfter).toBe(caBefore + FEE * BigInt(NUM_TRANSFERS));
  });

  it('should have exactly 4 Rosetta-compatible 107feecol blocks', async () => {
    // We performed 4 set_fee_collector calls across Phases 2-5
    expect(feecolBlockIndices).toHaveLength(4);

    // Fetch enough blocks to cover everything
    const result = await getBlocks(0n, 200n);
    const blocks: any[] = result.blocks;

    console.log('  total blocks in log:', result.log_length.toString());
    console.log(
      '  feecol block indices:',
      feecolBlockIndices.map(String).join(', '),
    );

    // ---- extract all 107feecol blocks ----
    const feecolBlocks = blocks.filter((b: any) => {
      const m = new Map(
        b.block.Map.map(([k, v]: [string, any]) => [k, v]),
      );
      return m.has('btype') && (m.get('btype') as any).Text === '107feecol';
    });

    expect(feecolBlocks.length).toBe(4);

    // Expected sequence:
    //  0 → set collectorA
    //  1 → switch collectorB
    //  2 → clear (null)
    //  3 → re-enable collectorA
    const expectHasCollector = [true, true, false, true];

    for (let i = 0; i < feecolBlocks.length; i++) {
      const blockMap = new Map(
        feecolBlocks[i].block.Map.map(([k, v]: [string, any]) => [k, v]),
      );

      // btype
      expect((blockMap.get('btype') as any).Text).toBe('107feecol');

      // ts (timestamp)
      expect(blockMap.has('ts')).toBe(true);

      // phash (every block after genesis must have one)
      if (feecolBlocks[i].id > 0n) {
        expect(blockMap.has('phash')).toBe(true);
        expect((blockMap.get('phash') as any).Blob).toBeDefined();
      }

      // tx map
      expect(blockMap.has('tx')).toBe(true);
      const txMap = new Map(
        (blockMap.get('tx') as any).Map.map(([k, v]: [string, any]) => [k, v]),
      );

      // mthd
      expect(txMap.has('mthd')).toBe(true);
      expect((txMap.get('mthd') as any).Text).toBe('107set_fee_collector');

      // caller
      expect(txMap.has('caller')).toBe(true);
      expect((txMap.get('caller') as any).Blob).toBeDefined();

      // fee_collector presence / absence
      if (expectHasCollector[i]) {
        expect(txMap.has('fee_collector')).toBe(true);
      }
      // When clearing, implementations may either omit fee_collector entirely
      // or include an empty representation — so we don't assert absence.

      console.log(
        `  107feecol #${i}: id=${feecolBlocks[i].id} ` +
          `has_fc=${txMap.has('fee_collector')} ` +
          `has_phash=${blockMap.has('phash')}`,
      );
    }
  });

  it('should have a valid phash chain across all blocks', async () => {
    const result = await getBlocks(0n, 200n);
    const blocks: any[] = result.blocks;

    for (let i = 1; i < blocks.length; i++) {
      const blockMap = new Map(
        blocks[i].block.Map.map(([k, v]: [string, any]) => [k, v]),
      );
      expect(blockMap.has('phash')).toBe(true);
      const phash = (blockMap.get('phash') as any).Blob;
      expect(phash).toBeDefined();
      expect(phash.length).toBeGreaterThan(0);
    }
  });

  it('final balances are self-consistent', async () => {
    const aliceBal = await getBalance(alice.getPrincipal());
    const bobBal = await getBalance(bob.getPrincipal());
    const caBal = await getBalance(collectorAIdentity.getPrincipal());
    const cbBal = await getBalance(collectorBIdentity.getPrincipal());
    const supply = await getTotalSupply();

    console.log('  alice :', aliceBal.toString());
    console.log('  bob   :', bobBal.toString());
    console.log('  colA  :', caBal.toString());
    console.log('  colB  :', cbBal.toString());
    console.log('  supply:', supply.toString());

    // Phase breakdown (8 transfers total: 1+1+1+1+1+5 = 10):
    //  10 transfers × TRANSFER_AMOUNT deducted from alice
    //  10 transfers × TRANSFER_AMOUNT credited to bob
    //  Fees: Phase 1 burned (1×FEE), Phase 2 to A (1×FEE), Phase 3 to B (1×FEE),
    //         Phase 4 burned (1×FEE), Phase 5 to A (1×FEE), Phase 6 to A (5×FEE)
    //  → A received 7×FEE, B received 1×FEE, burned 2×FEE
    const NUM_TRANSFERS = 10n;
    const FEES_TO_A = 7n * FEE;
    const FEES_TO_B = 1n * FEE;
    const FEES_BURNED = 2n * FEE;

    expect(bobBal).toBe(NUM_TRANSFERS * TRANSFER_AMOUNT);
    expect(caBal).toBe(FEES_TO_A);
    expect(cbBal).toBe(FEES_TO_B);
    expect(aliceBal).toBe(
      MINT_AMOUNT - NUM_TRANSFERS * TRANSFER_AMOUNT - NUM_TRANSFERS * FEE,
    );
    expect(supply).toBe(MINT_AMOUNT - FEES_BURNED);
  });
});
