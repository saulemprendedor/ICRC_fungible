/**
 * Message inspection (`system func inspect` of src/Token.mo).
 *
 * `inspect` is a cycles optimisation: it runs for ingress messages only, on one
 * replica, and decides whether the canister pays for a message at all. It has
 * three rules, and every one of them is pinned here:
 *
 *  1. Size first, per method. 5 120 bytes by default; more only for the two
 *     batch methods, the consent request that wraps a batch, and the owner's
 *     ledger-info update (a logo).
 *  2. A method whose body admits one principal is refused at ingress for anyone
 *     else. The owner is the CURRENT owner, not whoever installed the canister.
 *  3. Reads sent as update calls stay open to every caller, the anonymous
 *     principal included: wallets read balances through certified updates.
 *
 * How the assertions are built:
 *  - A refusal is asserted by matching the ingress-refusal shape, never "any
 *    throw": a body that traps also throws, and would pass a weaker check.
 *  - Every "costs < 1 M cycles" is paired with a positive control showing the
 *    fee an admitted message pays. Measured here: ~6.5 M base + ~2 000
 *    cycles/byte admitted, 0 refused.
 *  - Exact-size arguments are a valid Candid encoding with ONE EXTRA trailing
 *    `text` argument. The callee ignores extra arguments, and `inspect` only
 *    looks at the byte length. (Raw trailing bytes are NOT ignored.)
 *  - Nothing advances time between two balance reads, so no timer runs there.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
    icrc3: IDL.Opt(ICRC3InitArgs),
    icrc4: IDL.Opt(ICRC4InitArgs),
  }));

  return FullInitArgs;
}
const RAW_CALLER_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/raw_caller/raw_caller.wasm.gz');

const ApproveArgs = IDL.Record({
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
  expected_allowance: IDL.Opt(IDL.Nat),
  expires_at: IDL.Opt(IDL.Nat64),
  spender: Account,
});
const AllowanceArgs = IDL.Record({ account: Account, spender: Account });
const Allowance = IDL.Record({ allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) });
const MintArgs = IDL.Record({
  to: Account,
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const BurnArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
const LegacyBlocksArgs = IDL.Record({ start: IDL.Nat, length: IDL.Nat });
const SetFeeCollectorArgs = IDL.Record({
  fee_collector: IDL.Opt(Account),
  created_at_time: IDL.Nat64,
});
const ConsentMessageRequest = IDL.Record({
  method: IDL.Text,
  arg: IDL.Vec(IDL.Nat8),
  user_preferences: IDL.Record({
    metadata: IDL.Record({ language: IDL.Text, utc_offset_minutes: IDL.Opt(IDL.Int16) }),
    device_spec: IDL.Opt(IDL.Variant({ GenericDisplay: IDL.Null, FieldsDisplay: IDL.Null })),
  }),
});
// Only the variants these tests send; Candid matches a variant by its tag.
const Icrc1InfoRequest = IDL.Variant({ Logo: IDL.Text, Name: IDL.Text, Symbol: IDL.Text, MaxMemo: IDL.Nat });
const Icrc2InfoRequest = IDL.Variant({ MaxApprovals: IDL.Nat });
const Icrc4InfoRequest = IDL.Variant({ MaxBalances: IDL.Nat, MaxTransfers: IDL.Nat });

// =============== Constants mirrored from src/Token.mo ===============

const DEFAULT_ARG_CAP = 5_120;
const TRANSFER_ENTRY_BYTES = 149;
const BALANCE_ENTRY_BYTES = 65;
const BATCH_FRAMING_BYTES = 256;
const CONSENT_FRAMING_BYTES = 512;
const OWNER_INFO_ARG_CAP = 160_000;
/** The default `max_memo` of src/Token.mo. */
const MAX_MEMO = 80;

const transferBatchCap = (maxTransfers: number) =>
  Math.max(DEFAULT_ARG_CAP, maxTransfers * (TRANSFER_ENTRY_BYTES + MAX_MEMO) + BATCH_FRAMING_BYTES);
const balanceBatchCap = (maxBalances: number) =>
  Math.max(DEFAULT_ARG_CAP, maxBalances * BALANCE_ENTRY_BYTES + BATCH_FRAMING_BYTES);

// =============== Test Helpers ===============

/** The shape of a message `inspect` refused. A trap in a method body does not match it. */
const REFUSED = /inspect_message|canister_inspect_message/i;

/** A lower bound on the fee of an admitted message of `bytes`: 90 % of 2 000/B. */
const feeFloor = (bytes: number) => BigInt(Math.floor(0.9 * 2_000 * bytes));

/** `types`/`values` plus one extra `text` argument, padded to exactly `n` bytes. */
function encodeExactly(types: IDL.Type[], values: unknown[], n: number): Uint8Array {
  const base = IDL.encode([...types, IDL.Text], [...values, '']).length;
  for (let k = Math.max(0, n - base - 4); k <= n - base; k++) {
    const e = new Uint8Array(IDL.encode([...types, IDL.Text], [...values, 'x'.repeat(k)]));
    if (e.length === n) return e;
  }
  throw new Error(`cannot pad to exactly ${n} bytes`);
}

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

const bytes = (n: number, fill = 1) => new Array(n).fill(fill);
const BIG = BigInt('9'.repeat(40)); // the largest Nat the field validation admits
const SUB = bytes(32, 255);
/** A principal of the maximum length, 29 bytes. */
const LONG_PRINCIPAL = Principal.fromUint8Array(new Uint8Array(29).fill(7));
const MAX_ACCOUNT = { owner: LONG_PRINCIPAL, subaccount: [SUB] };

/** The largest transfer a ledger with an 80-byte memo accepts: every optional field set. */
const maxTransfer = () => ({
  to: MAX_ACCOUNT,
  fee: [BIG],
  memo: [bytes(MAX_MEMO)],
  from_subaccount: [SUB],
  created_at_time: [2n ** 64n - 1n],
  amount: BIG,
});

const smallTransfer = (to: Principal, memo: number[] | null = null, amount = 1_000n) => ({
  to: { owner: to, subaccount: [] },
  fee: [],
  memo: memo ? [memo] : [],
  from_subaccount: [],
  created_at_time: [],
  amount,
});

const consentFor = (method: string, arg: Uint8Array) => ({
  method,
  arg: Array.from(arg),
  user_preferences: {
    metadata: { language: 'en', utc_offset_minutes: [] },
    device_spec: [{ GenericDisplay: null }],
  },
});

class Ledger {
  static server: PocketIcServer | undefined;

  readonly installer = createIdentity(1).getPrincipal(); // installs, so it is the first owner
  readonly controller = createIdentity(2).getPrincipal(); // a controller that is not the owner
  readonly stranger = createIdentity(3).getPrincipal();
  readonly newOwner = createIdentity(4).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();
  readonly anonymous = Principal.anonymous();

  private constructor(readonly pic: PocketIc, readonly id: Principal) {}

  static async create(limits: { maxTransfers: number; maxBalances: number }): Promise<Ledger> {
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(`Token WASM not found at ${TOKEN_WASM_PATH}. Run pic/build-token-wasm.sh first.`);
    }
    Ledger.server ??= await PocketIcServer.start();
    const pic = await PocketIc.create(Ledger.server.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });
    const who = new Ledger(pic, Principal.anonymous());
    const id = await pic.createCanister({
      sender: who.installer,
      controllers: [who.installer, who.controller],
    });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({
      canisterId: id,
      wasm: readFileSync(TOKEN_WASM_PATH),
      arg: IDL.encode([buildTokenInitTypes(IDL)], [[{
        icrc1: [], // the defaults of src/Token.mo: max_memo = 80
        icrc2: [],
        icrc3: [],
        icrc4: [{
          max_balances: [BigInt(limits.maxBalances)],
          max_transfers: [BigInt(limits.maxTransfers)],
          fee: [],
        }],
      }]]),
      sender: who.installer,
    });
    const ledger = new Ledger(pic, id);
    await pic.tick(3); // let the lazily initialised classes settle before anything is measured
    return ledger;
  }

  static async stopServer() {
    if (Ledger.server) await Ledger.server.stop();
    Ledger.server = undefined;
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  query = (method: string, arg: Uint8Array, sender: Principal = this.anonymous) =>
    this.pic.queryCall({ canisterId: this.id, method, arg, sender });

  balance = async () => BigInt(await this.pic.getCyclesBalance(this.id));

  /** Cycles the canister spent while `work` ran. */
  async spent(work: () => Promise<unknown>): Promise<bigint> {
    const before = await this.balance();
    await work();
    return before - (await this.balance());
  }

  async installRawCaller(): Promise<Principal> {
    const rawId = await this.pic.createCanister({ sender: this.installer });
    await this.pic.addCycles(rawId, 10_000_000_000_000n);
    await this.pic.installCode({
      canisterId: rawId,
      wasm: readFileSync(RAW_CALLER_WASM_PATH),
      arg: IDL.encode([], []),
      sender: this.installer,
    });
    return rawId;
  }

  /** The owner-gated methods, each with a small valid argument that changes nothing that matters. */
  ownerMethods(nextOwner: Principal): Array<[string, Uint8Array]> {
    return [
      ['mint', enc([MintArgs], [{ to: { owner: this.alice, subaccount: [] }, amount: 1_000_000n, memo: [], created_at_time: [] }])],
      ['admin_update_icrc1', enc([IDL.Vec(Icrc1InfoRequest)], [[]])],
      ['admin_update_icrc2', enc([IDL.Vec(Icrc2InfoRequest)], [[]])],
      ['admin_update_icrc4', enc([IDL.Vec(Icrc4InfoRequest)], [[]])],
      ['admin_set_index_canister', enc([IDL.Opt(IDL.Principal)], [[]])],
      ['set_icrc106_index_principal', enc([IDL.Opt(IDL.Principal)], [[]])],
      ['icrc107_set_fee_collector', enc([SetFeeCollectorArgs], [{ fee_collector: [], created_at_time: 1n }])],
      ['admin_update_owner', enc([IDL.Principal], [nextOwner])], // last: it hands the ledger to `nextOwner`
    ];
  }
}

const logoRequest = (size: number) =>
  enc([IDL.Vec(Icrc1InfoRequest)], [[{ Logo: 'data:image/png;base64,' + 'A'.repeat(size - 22) }, { Name: 'Renamed' }]]);

// =============== Test Suite ===============

afterAll(async () => { await Ledger.stopServer(); });

describe('inspect: the default size limit', () => {
  let l: Ledger;
  beforeAll(async () => { l = await Ledger.create({ maxTransfers: 100, maxBalances: 100 }); }, 120_000);
  afterAll(async () => { await l.tearDown(); });

  it('admits exactly 5 120 bytes on an update and charges for them; refuses 5 121', async () => {
    const atCap = encodeExactly([TransferArgs], [smallTransfer(l.alice)], DEFAULT_ARG_CAP);
    const spent = await l.spent(async () => {
      const reply = await l.send('icrc1_transfer', atCap, l.stranger);
      // Admitted: the BODY answered, with its own typed error.
      expect((IDL.decode([TransferResult], reply)[0] as any).Err.InsufficientFunds).toBeDefined();
    });
    expect(spent).toBeGreaterThanOrEqual(feeFloor(DEFAULT_ARG_CAP)); // the positive control

    const overCap = encodeExactly([TransferArgs], [smallTransfer(l.alice)], DEFAULT_ARG_CAP + 1);
    await expect(l.send('icrc1_transfer', overCap, l.stranger)).rejects.toThrow(REFUSED);
  });

  it('holds a read sent as an update to the same limit', async () => {
    const account = { owner: l.alice, subaccount: [] };
    const reply = await l.send('icrc1_balance_of', encodeExactly([Account], [account], DEFAULT_ARG_CAP), l.anonymous);
    expect(IDL.decode([IDL.Nat], reply)[0]).toBe(0n);
    await expect(l.send('icrc1_balance_of', encodeExactly([Account], [account], DEFAULT_ARG_CAP + 1), l.anonymous))
      .rejects.toThrow(REFUSED);
  });

  it('64 KB of junk costs the canister nothing, whoever sends it', async () => {
    const junk = encodeExactly([TransferArgs], [smallTransfer(l.alice)], 65_536);
    const methods = ['icrc1_transfer', 'icrc2_approve', 'icrc1_balance_of', 'icrc1_name', 'burn', 'mint', 'deposit_cycles', 'admin_init'];
    const spent = await l.spent(async () => {
      for (const sender of [l.anonymous, l.stranger]) {
        for (const method of methods) {
          await expect(l.send(method, junk, sender), `${method} from ${sender.toText()}`).rejects.toThrow(REFUSED);
        }
      }
    });
    expect(spent).toBeLessThan(1_000_000n);
  });

  it('gives no allowance to the installer or to a controller', async () => {
    const big = encodeExactly([TransferArgs], [smallTransfer(l.alice)], 49_000); // under the limit this canister used to have
    const spent = await l.spent(async () => {
      for (const sender of [l.installer, l.controller]) {
        for (const method of ['icrc1_transfer', 'admin_init', 'admin_update_icrc2', 'icrc1_name']) {
          await expect(l.send(method, big, sender), `${method} from ${sender.toText()}`).rejects.toThrow(REFUSED);
        }
      }
    });
    expect(spent).toBeLessThan(1_000_000n);
  });
});

describe('inspect: the named exceptions', () => {
  let l: Ledger;
  beforeAll(async () => { l = await Ledger.create({ maxTransfers: 100, maxBalances: 100 }); }, 120_000);
  afterAll(async () => { await l.tearDown(); });

  it('measures what the constants claim', () => {
    const one = enc([ICRC4TransferArgs], [[maxTransfer()]]).length;
    const two = enc([ICRC4TransferArgs], [[maxTransfer(), maxTransfer()]]).length;
    expect(two - one).toBe(TRANSFER_ENTRY_BYTES + MAX_MEMO);
    expect(enc([ICRC4TransferArgs], [Array(200).fill(maxTransfer())]).length).toBe(45_868);

    const a1 = enc([BalanceQueryArgs], [{ accounts: [MAX_ACCOUNT] }]).length;
    const a2 = enc([BalanceQueryArgs], [{ accounts: [MAX_ACCOUNT, MAX_ACCOUNT] }]).length;
    expect(a2 - a1).toBe(BALANCE_ENTRY_BYTES);
    expect(enc([BalanceQueryArgs], [{ accounts: Array(200).fill(MAX_ACCOUNT) }]).length).toBe(13_037);

    // Every method without an exception fits under the default, at its largest.
    expect(enc([TransferArgs], [maxTransfer()]).length).toBeLessThan(DEFAULT_ARG_CAP);
    expect(enc([GetBlocksArgs], [Array(100).fill({ start: BIG, length: BIG })]).length).toBeLessThan(DEFAULT_ARG_CAP);
  });

  it('icrc4_transfer_batch: the largest batch the ledger takes is admitted, one byte over the limit is not', async () => {
    const cap = transferBatchCap(100);
    const full = enc([ICRC4TransferArgs], [Array(100).fill(maxTransfer())]);
    expect(full.length).toBeLessThanOrEqual(cap);
    expect(full.length).toBeGreaterThan(DEFAULT_ARG_CAP); // it needs the exception

    const spent = await l.spent(async () => {
      await l.send('icrc4_transfer_batch', full, l.stranger); // the body ran and answered
    });
    expect(spent).toBeGreaterThanOrEqual(feeFloor(full.length));

    const batch = Array(100).fill(maxTransfer());
    await expect(l.send('icrc4_transfer_batch', encodeExactly([ICRC4TransferArgs], [batch], cap), l.stranger))
      .resolves.toBeDefined();
    await expect(l.send('icrc4_transfer_batch', encodeExactly([ICRC4TransferArgs], [batch], cap + 1), l.stranger))
      .rejects.toThrow(REFUSED);
  });

  it('icrc4_balance_of_batch: same, sent as an update by the anonymous principal', async () => {
    const cap = balanceBatchCap(100);
    const accounts = { accounts: Array(100).fill(MAX_ACCOUNT) };
    const full = enc([BalanceQueryArgs], [accounts]);
    expect(full.length).toBeGreaterThan(DEFAULT_ARG_CAP);
    await expect(l.send('icrc4_balance_of_batch', full, l.anonymous)).resolves.toBeDefined();
    await expect(l.send('icrc4_balance_of_batch', encodeExactly([BalanceQueryArgs], [accounts], cap), l.anonymous))
      .resolves.toBeDefined();
    await expect(l.send('icrc4_balance_of_batch', encodeExactly([BalanceQueryArgs], [accounts], cap + 1), l.anonymous))
      .rejects.toThrow(REFUSED);
  });

  it('icrc21_canister_call_consent_message: a request that wraps the largest batch is admitted', async () => {
    const cap = transferBatchCap(100) + CONSENT_FRAMING_BYTES;
    const batch = enc([ICRC4TransferArgs], [Array(100).fill(maxTransfer())]);
    const request = consentFor('icrc4_transfer_batch', batch);
    const full = enc([ConsentMessageRequest], [request]);
    expect(full.length).toBeGreaterThan(transferBatchCap(100) - BATCH_FRAMING_BYTES); // larger than the call it wraps
    expect(full.length).toBeLessThanOrEqual(cap);
    await expect(l.send('icrc21_canister_call_consent_message', full, l.stranger)).resolves.toBeDefined();
    await expect(l.send('icrc21_canister_call_consent_message', encodeExactly([ConsentMessageRequest], [request], cap), l.stranger))
      .resolves.toBeDefined();
    await expect(l.send('icrc21_canister_call_consent_message', encodeExactly([ConsentMessageRequest], [request], cap + 1), l.stranger))
      .rejects.toThrow(REFUSED);
  });

  it('the batch limits follow the ledger configuration', async () => {
    const batch200 = Array(200).fill(maxTransfer());
    const accounts200 = { accounts: Array(200).fill(MAX_ACCOUNT) };
    const full = enc([ICRC4TransferArgs], [batch200]);
    const fullBalances = enc([BalanceQueryArgs], [accounts200]);

    // Configured for 100: a 200-entry batch is over the byte limit.
    await expect(l.send('icrc4_transfer_batch', full, l.stranger)).rejects.toThrow(REFUSED);
    await expect(l.send('icrc4_balance_of_batch', fullBalances, l.stranger)).rejects.toThrow(REFUSED);

    await l.send('admin_update_icrc4', enc([IDL.Vec(Icrc4InfoRequest)], [[{ MaxTransfers: 200n }, { MaxBalances: 200n }]]), l.installer);

    // Configured for 200: the largest legitimate argument fits again, whatever the limit is set to.
    expect(full.length).toBeLessThanOrEqual(transferBatchCap(200));
    expect(fullBalances.length).toBeLessThanOrEqual(balanceBatchCap(200));
    await expect(l.send('icrc4_transfer_batch', full, l.stranger)).resolves.toBeDefined();
    await expect(l.send('icrc4_balance_of_batch', fullBalances, l.stranger)).resolves.toBeDefined();
    await expect(l.send('icrc4_transfer_batch', encodeExactly([ICRC4TransferArgs], [batch200], transferBatchCap(200) + 1), l.stranger))
      .rejects.toThrow(REFUSED);
    await expect(l.send('icrc4_balance_of_batch', encodeExactly([BalanceQueryArgs], [accounts200], balanceBatchCap(200) + 1), l.stranger))
      .rejects.toThrow(REFUSED);
  });

  it('admin_update_icrc1: a 110 KB logo from the owner is stored; nobody else gets the allowance', async () => {
    const logo = logoRequest(110_214);
    expect(logo.length).toBeGreaterThan(110_214);
    expect(logo.length).toBeLessThan(OWNER_INFO_ARG_CAP);

    const refused = await l.spent(async () => {
      for (const sender of [l.stranger, l.anonymous, l.controller]) {
        await expect(l.send('admin_update_icrc1', logo, sender), sender.toText()).rejects.toThrow(REFUSED);
      }
    });
    expect(refused).toBeLessThan(1_000_000n);
    expect(IDL.decode([IDL.Text], await l.query('icrc1_name', enc([], [])))[0]).not.toBe('Renamed');

    const admitted = await l.spent(async () => {
      const reply = await l.send('admin_update_icrc1', logo, l.installer);
      expect(IDL.decode([IDL.Vec(IDL.Bool)], reply)[0]).toEqual([true, true]);
    });
    expect(admitted).toBeGreaterThanOrEqual(feeFloor(logo.length));
    expect(IDL.decode([IDL.Text], await l.query('icrc1_name', enc([], [])))[0]).toBe('Renamed');

    const requests = [[{ Name: 'Renamed' }]];
    await expect(l.send('admin_update_icrc1', encodeExactly([IDL.Vec(Icrc1InfoRequest)], requests, OWNER_INFO_ARG_CAP), l.installer))
      .resolves.toBeDefined();
    await expect(l.send('admin_update_icrc1', encodeExactly([IDL.Vec(Icrc1InfoRequest)], requests, OWNER_INFO_ARG_CAP + 1), l.installer))
      .rejects.toThrow(REFUSED);
  });
});

describe('inspect: caller class', () => {
  let l: Ledger;
  beforeEach(async () => { l = await Ledger.create({ maxTransfers: 100, maxBalances: 100 }); }, 120_000);
  afterEach(async () => { await l.tearDown(); });

  it('an owner method costs a stranger\'s target nothing, and the owner pays the fee', async () => {
    const methods = l.ownerMethods(l.stranger);
    const spent = await l.spent(async () => {
      for (const sender of [l.stranger, l.anonymous, l.controller]) {
        for (const [method, arg] of methods) {
          await expect(l.send(method, arg, sender), `${method} from ${sender.toText()}`).rejects.toThrow(REFUSED);
        }
      }
    });
    expect(spent).toBeLessThan(1_000_000n);

    // Positive control: same message, from the owner.
    const [method, arg] = methods[1];
    expect(await l.spent(() => l.send(method, arg, l.installer))).toBeGreaterThanOrEqual(5_000_000n);
  });

  it('after a hand-off the new owner administers and the installer does not', async () => {
    await l.send('admin_update_owner', enc([IDL.Principal], [l.newOwner]), l.installer);

    for (const [method, arg] of l.ownerMethods(l.newOwner)) {
      await expect(l.send(method, arg, l.installer), `${method} from the installer`).rejects.toThrow(REFUSED);
      await expect(l.send(method, arg, l.newOwner), `${method} from the new owner`).resolves.toBeDefined();
    }

    const logo = logoRequest(110_214);
    await expect(l.send('admin_update_icrc1', logo, l.installer)).rejects.toThrow(REFUSED);
    const reply = await l.send('admin_update_icrc1', logo, l.newOwner);
    expect(IDL.decode([IDL.Vec(IDL.Bool)], reply)[0]).toEqual([true, true]);
    expect(IDL.decode([IDL.Text], await l.query('icrc1_name', enc([], [])))[0]).toBe('Renamed');
  });

  it('the installer-gated methods mirror their bodies', async () => {
    const none = enc([], []);
    const override = enc([IDL.Bool], [false]);
    const spent = await l.spent(async () => {
      for (const sender of [l.controller, l.stranger, l.anonymous]) {
        await expect(l.send('upgradeArchive', override, sender)).rejects.toThrow(REFUSED);
        await expect(l.send('update_archive_controllers', none, sender)).rejects.toThrow(REFUSED);
        await expect(l.send('getUpgradeError', none, sender)).rejects.toThrow(REFUSED);
      }
      await expect(l.send('admin_init', none, l.stranger)).rejects.toThrow(REFUSED);
      await expect(l.send('admin_init', none, l.anonymous)).rejects.toThrow(REFUSED);
    });
    expect(spent).toBeLessThan(1_000_000n);

    await expect(l.send('admin_init', none, l.controller)).resolves.toBeDefined();
    await expect(l.send('admin_init', none, l.installer)).resolves.toBeDefined();
    await expect(l.send('update_archive_controllers', none, l.installer)).resolves.toBeDefined();
    await expect(l.send('getUpgradeError', none, l.installer)).resolves.toBeDefined();

    // The installer keeps these after a hand-off, because the bodies say so.
    await l.send('admin_update_owner', enc([IDL.Principal], [l.newOwner]), l.installer);
    await expect(l.send('update_archive_controllers', none, l.installer)).resolves.toBeDefined();
    await expect(l.send('update_archive_controllers', none, l.newOwner)).rejects.toThrow(REFUSED);
  });

  it('the methods anybody may call stay open', async () => {
    for (const sender of [l.stranger, l.anonymous]) {
      await expect(l.send('icrc1_transfer', enc([TransferArgs], [smallTransfer(l.alice)]), sender)).resolves.toBeDefined();
      await expect(l.send('deposit_cycles', enc([], []), sender)).resolves.toBeDefined();
    }
  });

  it('the body guards still decide, past the filter', async () => {
    const rawId = await l.installRawCaller();
    const via = (method: string, arg: Uint8Array) =>
      l.pic.updateCall({
        canisterId: rawId,
        method: 'call',
        sender: l.stranger,
        arg: IDL.encode([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [l.id, method, arg]),
      });

    for (const [method, arg] of l.ownerMethods(l.stranger)) {
      if (method === 'icrc107_set_fee_collector') {
        const reply = IDL.decode([IDL.Vec(IDL.Nat8)], await via(method, arg))[0] as Uint8Array;
        const Result = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ AccessDenied: IDL.Text }) });
        expect((IDL.decode([Result], new Uint8Array(reply))[0] as any).Err.AccessDenied).toBeDefined();
      } else {
        // A trap in the body: a rejected call, and NOT the ingress refusal.
        const failure = await via(method, arg).then(() => null, (e: Error) => e);
        expect(failure, method).not.toBeNull();
        expect(failure!.message, method).not.toMatch(REFUSED);
        expect(failure!.message, method).toMatch(/Unauthorized/);
      }
    }
    // Nothing changed hands: the installer is still the owner.
    await expect(l.send('admin_update_icrc2', enc([IDL.Vec(Icrc2InfoRequest)], [[]]), l.installer)).resolves.toBeDefined();
  });
});

describe('inspect: reads sent as update calls', () => {
  let l: Ledger;
  beforeAll(async () => { l = await Ledger.create({ maxTransfers: 100, maxBalances: 100 }); }, 120_000);
  afterAll(async () => { await l.tearDown(); });

  it('answers the anonymous principal and a fresh one, as a wallet\'s certified read needs', async () => {
    const account = { owner: l.alice, subaccount: [] };
    for (const sender of [l.anonymous, createIdentity(77).getPrincipal()]) {
      const balance = await l.send('icrc1_balance_of', enc([Account], [account]), sender);
      expect(IDL.decode([IDL.Nat], balance)[0]).toBe(0n);

      const allowance = await l.send('icrc2_allowance', enc([AllowanceArgs], [{ account, spender: account }]), sender);
      expect((IDL.decode([Allowance], allowance)[0] as any).allowance).toBe(0n);

      await expect(l.send('icrc3_get_blocks', enc([GetBlocksArgs], [[{ start: 0n, length: 10n }]]), sender)).resolves.toBeDefined();
      await expect(l.send('archives', enc([], []), sender)).resolves.toBeDefined();
      await expect(l.send('icrc1_name', enc([], []), sender)).resolves.toBeDefined();
      await expect(l.send('icrc1_metadata', enc([], []), sender)).resolves.toBeDefined();
    }
  });

  it('refuses the same reads above the default limit', async () => {
    const account = { owner: l.alice, subaccount: [] };
    const over = DEFAULT_ARG_CAP + 1;
    const spent = await l.spent(async () => {
      for (const sender of [l.anonymous, createIdentity(77).getPrincipal()]) {
        await expect(l.send('icrc1_balance_of', encodeExactly([Account], [account], over), sender)).rejects.toThrow(REFUSED);
        await expect(l.send('icrc2_allowance', encodeExactly([AllowanceArgs], [{ account, spender: account }], over), sender)).rejects.toThrow(REFUSED);
        await expect(l.send('icrc3_get_blocks', encodeExactly([GetBlocksArgs], [[{ start: 0n, length: 10n }]], over), sender)).rejects.toThrow(REFUSED);
      }
    });
    expect(spent).toBeLessThan(1_000_000n);
  });

  it('keeps validating the fields of a read', async () => {
    const oversized = { owner: l.alice, subaccount: [bytes(64)] };
    await expect(l.send('icrc1_balance_of', enc([Account], [oversized]), l.stranger)).rejects.toThrow(REFUSED);
    await expect(l.send('get_blocks', enc([LegacyBlocksArgs], [{ start: BigInt('9'.repeat(50)), length: 100n }]), l.stranger))
      .rejects.toThrow(REFUSED);
    await expect(l.send('icrc3_get_blocks', enc([GetBlocksArgs], [Array(101).fill({ start: 0n, length: 1n })]), l.stranger))
      .rejects.toThrow(REFUSED);
  });
});

describe('inspect: field validation of updates', () => {
  let l: Ledger;
  beforeAll(async () => {
    l = await Ledger.create({ maxTransfers: 100, maxBalances: 100 });
    await l.send('mint', enc([MintArgs], [{ to: { owner: l.alice, subaccount: [] }, amount: 10_000_000_000n, memo: [], created_at_time: [] }]), l.installer);
  }, 120_000);
  afterAll(async () => { await l.tearDown(); });

  it('admits a memo of the configured 80 bytes, and the transfer lands', async () => {
    const reply = await l.send('icrc1_transfer', enc([TransferArgs], [smallTransfer(l.stranger, bytes(80), 100_000n)]), l.alice);
    expect((IDL.decode([TransferResult], reply)[0] as any).Ok).toBeDefined();
    const balance = await l.query('icrc1_balance_of', enc([Account], [{ owner: l.stranger, subaccount: [] }]));
    expect(IDL.decode([IDL.Nat], balance)[0]).toBe(100_000n);
  });

  it('refuses a memo of 81 bytes on every method that carries one', async () => {
    const memo = [bytes(81)];
    const spender = { owner: l.stranger, subaccount: [] };
    const approve = (m: number[][]) => ({
      fee: [], memo: m, from_subaccount: [], created_at_time: [], amount: 1_000n,
      expected_allowance: [], expires_at: [], spender,
    });
    const burn = (m: number[][]) => ({ from_subaccount: [], amount: 100_000n, memo: m, created_at_time: [] });
    const mint = (m: number[][]) => ({ to: spender, amount: 1_000n, memo: m, created_at_time: [] });

    await expect(l.send('icrc1_transfer', enc([TransferArgs], [smallTransfer(l.stranger, bytes(81))]), l.alice)).rejects.toThrow(REFUSED);
    await expect(l.send('icrc2_approve', enc([ApproveArgs], [approve(memo)]), l.alice)).rejects.toThrow(REFUSED);
    await expect(l.send('burn', enc([BurnArgs], [burn(memo)]), l.alice)).rejects.toThrow(REFUSED);
    await expect(l.send('mint', enc([MintArgs], [mint(memo)]), l.installer)).rejects.toThrow(REFUSED);
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [[smallTransfer(l.stranger, bytes(81))]]), l.alice)).rejects.toThrow(REFUSED);

    // The same calls with 80 bytes pass the filter.
    const ok = [bytes(80)];
    await expect(l.send('icrc2_approve', enc([ApproveArgs], [approve(ok)]), l.alice)).resolves.toBeDefined();
    await expect(l.send('burn', enc([BurnArgs], [burn(ok)]), l.alice)).resolves.toBeDefined();
    await expect(l.send('mint', enc([MintArgs], [mint(ok)]), l.installer)).resolves.toBeDefined();
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [[smallTransfer(l.stranger, bytes(80))]]), l.alice)).resolves.toBeDefined();
  });

  it('refuses an oversized subaccount and an absurd amount', async () => {
    const toOversized = { ...smallTransfer(l.stranger), to: { owner: l.stranger, subaccount: [bytes(64)] } };
    await expect(l.send('icrc1_transfer', enc([TransferArgs], [toOversized]), l.alice)).rejects.toThrow(REFUSED);
    const absurd = smallTransfer(l.stranger, null, BigInt('9'.repeat(50)));
    await expect(l.send('icrc1_transfer', enc([TransferArgs], [absurd]), l.alice)).rejects.toThrow(REFUSED);
  });

  it('refuses an absurd amount or fee inside a batch', async () => {
    const absurd = BigInt('9'.repeat(41));
    const amount = [smallTransfer(l.stranger), smallTransfer(l.stranger, null, absurd)];
    const fee = [{ ...smallTransfer(l.stranger), fee: [absurd] }];
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [amount]), l.alice)).rejects.toThrow(REFUSED);
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [fee]), l.alice)).rejects.toThrow(REFUSED);
    const oversized = [{ ...smallTransfer(l.stranger), from_subaccount: [bytes(33)] }];
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [oversized]), l.alice)).rejects.toThrow(REFUSED);
    await expect(l.send('icrc4_transfer_batch', enc([ICRC4TransferArgs], [[]]), l.alice)).rejects.toThrow(REFUSED);
  });

  it('refuses a batch with more entries than the ledger takes, however small', async () => {
    const batch = Array(101).fill(smallTransfer(l.stranger));
    const encoded = enc([ICRC4TransferArgs], [batch]);
    expect(encoded.length).toBeLessThan(transferBatchCap(100)); // the size check lets it through
    await expect(l.send('icrc4_transfer_batch', encoded, l.alice)).rejects.toThrow(REFUSED);
    const accounts = { accounts: Array(101).fill({ owner: l.stranger, subaccount: [] }) };
    await expect(l.send('icrc4_balance_of_batch', enc([BalanceQueryArgs], [accounts]), l.alice)).rejects.toThrow(REFUSED);
  });
});
