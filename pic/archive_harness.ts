/**
 * Shared harness for the pic tests that need real ICRC-3 archives and a
 * collector for ICRC-85 cycle shares.
 *
 * - The ledger is created with small icrc3 bounds so a few dozen transfers
 *   spawn archives.
 * - The collector can be created at the library's DEFAULT collector id, so the
 *   production `src/Token.mo` is tested unchanged: PocketIC places a canister
 *   created with `targetCanisterId` (and no `targetSubnetId`) on a subnet of
 *   its own, and cross-subnet cycle shares reach it.
 */

import { PocketIc, Actor } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

/** The collector `ovs-fixed` uses when a consumer sets none. */
export const DEFAULT_COLLECTOR = Principal.fromText('q26le-iqaaa-aaaam-actsa-cai');

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `PIC_TRACE=1` prints each harness step with a wall-clock timestamp. */
export function trace(msg: string): void {
  if (process.env.PIC_TRACE) console.log(`[trace ${new Date().toISOString()}] ${msg}`);
}

export const NAMESPACES = {
  icrc1: 'org.icdevs.icrc85.icrc1',
  icrc3: 'org.icdevs.icrc85.icrc3',
  timerTool: 'org.icdevs.icrc85.supertimer',
  archive: 'org.icdevs.icrc85.icrc3archive',
} as const;

export function wasmPath(envVar: string, dfxName: string): string {
  const p = process.env[envVar]
    ? resolve(process.env[envVar] as string)
    : resolve(__dirname, `../.dfx/local/canisters/${dfxName}/${dfxName}.wasm.gz`);
  if (!existsSync(p)) {
    throw new Error(
      `WASM not found at ${p}. Run 'bash pic/build-token-wasm.sh' first ` +
      `(it builds every wasm the pic tests load, token_baseline included, which needs git history).`,
    );
  }
  return p;
}

export function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

// =============== IDL ===============

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });

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
const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError });

const Value = IDL.Rec();
Value.fill(IDL.Variant({
  Int: IDL.Int,
  Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
  Nat: IDL.Nat,
  Blob: IDL.Vec(IDL.Nat8),
  Text: IDL.Text,
  Array: IDL.Vec(Value),
}));

const TransactionRange = IDL.Record({ start: IDL.Nat, length: IDL.Nat });
// Decoding skips the fields not listed here (log_length, archived_blocks).
const GetBlocksResult = IDL.Record({
  blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
});

export const ledgerIdl: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
  mint: IDL.Func([IDL.Record({
    to: Account,
    amount: IDL.Nat,
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  })], [TransferResult], []),
  icrc1_transfer: IDL.Func([IDL.Record({
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  })], [TransferResult], []),
  icrc3_get_archives: IDL.Func(
    [IDL.Record({ from: IDL.Opt(IDL.Principal) })],
    [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat }))],
    ['query'],
  ),
  upgradeArchive: IDL.Func([IDL.Bool], [], []),
  getUpgradeError: IDL.Func([], [IDL.Text], ['query']),
  admin_propose_owner: IDL.Func([IDL.Opt(IDL.Principal)], [], []),
  accept_ownership: IDL.Func([], [], []),
  get_owner: IDL.Func([], [IDL.Principal], ['query']),
  get_pending_owner: IDL.Func([], [IDL.Opt(IDL.Principal)], ['query']),
});

export const archiveIdl: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
  icrc3_get_blocks: IDL.Func([IDL.Vec(TransactionRange)], [GetBlocksResult], ['query']),
  remaining_capacity: IDL.Func([], [IDL.Nat], ['query']),
  total_transactions: IDL.Func([], [IDL.Nat], ['query']),
  get_stats: IDL.Func([], [IDL.Record({
    total_records: IDL.Nat,
    first_block_index: IDL.Nat,
    last_block_index: IDL.Nat,
    max_records: IDL.Nat,
    remaining_capacity: IDL.Nat,
  })], ['query']),
});

const ShareNotification = IDL.Record({
  namespace: IDL.Text,
  actions: IDL.Nat,
  cycles_received: IDL.Nat,
  timestamp: IDL.Int,
  caller: IDL.Principal,
});

export const collectorIdl: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
  get_notifications: IDL.Func([], [IDL.Vec(ShareNotification)], ['query']),
});

export interface Notification {
  namespace: string;
  actions: bigint;
  cycles_received: bigint;
  timestamp: bigint;
  caller: Principal;
}

// =============== Ledger init args ===============

/** `Token.mo`'s class argument. Extra record fields are ignored by Candid. */
export function tokenInitType() {
  const ArchiveIndexType = IDL.Variant({ Stable: IDL.Null, StableTyped: IDL.Null, Managed: IDL.Null });
  const BlockType = IDL.Record({ block_type: IDL.Text, url: IDL.Text });
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
  return IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(IDL.Null),
    icrc2: IDL.Opt(IDL.Null),
    icrc3: IDL.Opt(ICRC3InitArgs),
    icrc4: IDL.Opt(IDL.Null),
  }));
}

/**
 * `archiveControllers` in the Candid encoding of `??[Principal]`:
 * `'unmanaged'` → null, `'default'` → ?null, a list → ?(?list).
 */
export type ArchiveControllers = 'unmanaged' | 'default' | Principal[];

/** Small bounds: ~50 records on the ledger, up to `perArchive` per archive. */
export function smallArchiveArgs(opts: { perArchive?: number; controllers?: ArchiveControllers; archiveCycles?: bigint } = {}) {
  const c = opts.controllers ?? 'unmanaged';
  const archiveControllers = c === 'unmanaged' ? [] : c === 'default' ? [[]] : [[c]];
  return [{
    icrc1: [],
    icrc2: [],
    icrc3: [{
      maxActiveRecords: 50n,
      settleToRecords: 30n,
      maxRecordsInArchiveInstance: BigInt(opts.perArchive ?? 60),
      maxArchivePages: 62500n,
      archiveIndexType: { Stable: null },
      maxRecordsToArchive: 25n,
      // `Token.mo`'s default. An archive with little more than an upgrade's
      // cost cannot be upgraded once it has paid a couple of ICRC-85 shares.
      archiveCycles: opts.archiveCycles ?? 20_000_000_000_000n,
      archiveControllers,
      supportedBlocks: [],
    }],
    icrc4: [],
  }];
}

export function encodeTokenArgs(args: unknown[] | null): Uint8Array {
  return new Uint8Array(IDL.encode([tokenInitType()], [args ?? []]));
}

export const EOP_UPGRADE = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } as any;

// =============== Setup helpers ===============

export async function installLedger(
  pic: PocketIc,
  wasm: string,
  owner: Principal,
  args: unknown[] | null,
): Promise<{ id: Principal; actor: Actor<any> }> {
  const id = await pic.createCanister({ sender: owner, cycles: 500_000_000_000_000n });
  await pic.installCode({ canisterId: id, wasm: readFileSync(wasm), arg: encodeTokenArgs(args), sender: owner });
  for (let i = 0; i < 5; i++) await pic.tick();
  const actor = pic.createActor<any>(ledgerIdl, id);
  actor.setPrincipal(owner);
  return { id, actor };
}

export async function upgradeLedger(
  pic: PocketIc,
  id: Principal,
  wasm: string,
  owner: Principal,
  args: unknown[] | null,
): Promise<void> {
  await pic.upgradeCanister({
    canisterId: id,
    wasm: readFileSync(wasm),
    arg: encodeTokenArgs(args),
    sender: owner,
    upgradeModeOptions: EOP_UPGRADE,
  });
  for (let i = 0; i < 5; i++) await pic.tick();
}

/** A collector at `at` (default: the library's default collector id). */
export async function installCollector(pic: PocketIc, at: Principal = DEFAULT_COLLECTOR): Promise<Actor<any>> {
  const id = await pic.createCanister({ targetCanisterId: at, cycles: 10_000_000_000_000n });
  await pic.installCode({
    canisterId: id,
    wasm: readFileSync(wasmPath('COLLECTOR_WASM', 'dummy_collector')),
    arg: new Uint8Array(IDL.encode([], [])),
  });
  return pic.createActor<any>(collectorIdl, id);
}

export async function notifications(collector: Actor<any>): Promise<Notification[]> {
  return (await collector.get_notifications()) as Notification[];
}

/** Notification count per namespace, only from `from` when given. */
export async function countByNamespace(collector: Actor<any>, from?: Principal): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await notifications(collector)) {
    if (from && n.caller.toText() !== from.toText()) continue;
    out[n.namespace] = (out[n.namespace] ?? 0) + 1;
  }
  return out;
}

const RECIPIENT = createIdentity(99).getPrincipal();

/** Notification count per `namespace @ caller`, so a failure names the paying canister. */
export async function countByStream(collector: Actor<any>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await notifications(collector)) {
    const k = `${n.namespace} @ ${n.caller.toText()}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function advanceDays(pic: PocketIc, days: number, ticks = 10): Promise<void> {
  trace(`advance ${days}d`);
  await pic.advanceTime(days * DAY_MS);
  for (let i = 0; i < ticks; i++) { trace(`tick ${i}`); await pic.tick(); }
}

/**
 * Mint to `holder`, then transfer from `holder` until `done()` holds, ticking
 * so the ledger's archiving timer runs. Throws after `max` transfers.
 */
export async function transferUntil(
  pic: PocketIc,
  ledger: Actor<any>,
  owner: Principal,
  holder: Ed25519KeyIdentity,
  done: () => Promise<boolean>,
  max = 600,
  mint = true,
): Promise<number> {
  ledger.setPrincipal(owner);
  const minted = !mint ? { Ok: 0n } : await ledger.mint({
    to: { owner: holder.getPrincipal(), subaccount: [] },
    amount: 1_000_000_000_000n,
    memo: [],
    created_at_time: [],
  });
  if (!('Ok' in minted)) throw new Error(`mint failed: ${JSON.stringify(minted, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  ledger.setIdentity(holder);
  let n = 0;
  while (!(await done())) {
    if (n >= max) throw new Error(`condition not reached after ${max} transfers`);
    const r = await ledger.icrc1_transfer({
      from_subaccount: [],
      // Not the owner: the owner is the minting account, and a transfer to it is a burn.
      to: { owner: RECIPIENT, subaccount: [] },
      amount: BigInt(1000 + n),
      fee: [],
      memo: [],
      created_at_time: [],
    });
    if (!('Ok' in r)) throw new Error(`transfer ${n} failed: ${JSON.stringify(r, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    n++;
    trace(`transfer ${n} done, ticking`);
    await pic.tick();
    await pic.tick();
  }
  ledger.setPrincipal(owner);
  return n;
}

/** The ledger's archives. `icrc3_get_archives` also lists the ledger itself; it is dropped. */
export async function archives(ledger: Actor<any>, ledgerId: Principal): Promise<{ canister_id: Principal; start: bigint; end: bigint }[]> {
  const all: { canister_id: Principal; start: bigint; end: bigint }[] = await ledger.icrc3_get_archives({ from: [] });
  return all.filter((a) => a.canister_id.toText() !== ledgerId.toText());
}

/** Blocks `[start, start + length)` read straight from an archive, as JSON for comparison. */
export async function archiveBlocks(archive: Actor<any>, start: bigint, length: bigint): Promise<string> {
  const r = await archive.icrc3_get_blocks([{ start, length }]);
  return JSON.stringify(r.blocks, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}
