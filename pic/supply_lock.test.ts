/**
 * The one-way supply lock (src/Token.mo and src/token-mixin.mo).
 *
 * `admin_lock_supply()` by the owner sets a flag that no method clears. From
 * then on `mint` traps for every caller, and `admin_update_icrc1` traps,
 * applying nothing, when its batch carries a `MintingAccount` or `MaxSupply`
 * request. Every other setting stays editable. `is_supply_locked()` answers
 * the flag to anyone.
 *
 * The bodies are the access control, so they are proven with an owner that is
 * a canister (`RawCaller`): its calls are inter-canister and `inspect` never
 * sees them. `Token.mo` also mirrors the lock in `inspect`; that is proven
 * with ingress calls and their cycle cost in the last block.
 *
 * Every refusal is followed by a read-back of what it must not have changed:
 * a trap that still moved something would pass a weaker check.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const RAW_CALLER_WASM = wasmPath('RAW_CALLER_WASM', 'raw_caller');

const REFUSED = /inspect_message|canister_inspect_message/i;
const UNAUTHORIZED = /Unauthorized/;
const LOCKED_MINT = /Supply is locked: mint is disabled/;
const LOCKED_UPDATE = /Supply is locked: MintingAccount and MaxSupply cannot change/;

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
type AccountT = { owner: Principal; subaccount: [] | [Uint8Array] };
const acct = (owner: Principal): AccountT => ({ owner, subaccount: [] });
const MintArgs = IDL.Record({
  to: Account,
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const TransferArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: Account,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const GenericError = IDL.Record({ error_code: IDL.Nat, message: IDL.Text });
const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ GenericError }) });
// A subset of ICRC1.UpdateLedgerInfoRequest: a variant encodes into a wider one.
const InfoRequest = IDL.Variant({
  Name: IDL.Text,
  Symbol: IDL.Text,
  Fee: IDL.Variant({ Fixed: IDL.Nat, Environment: IDL.Null }),
  MaxSupply: IDL.Opt(IDL.Nat),
  MintingAccount: Account,
});
type Req =
  | { Name: string } | { Symbol: string } | { Fee: { Fixed: bigint } }
  | { MaxSupply: [] | [bigint] } | { MintingAccount: AccountT };
const batch = (requests: Req[]) => enc([IDL.Vec(InfoRequest)], [requests]);
const mintArgs = (to: Principal, amount: bigint) =>
  enc([MintArgs], [{ to: acct(to), amount, memo: [], created_at_time: [] }]);
const transferArgs = (to: Principal, amount: bigint) =>
  enc([TransferArgs], [{ from_subaccount: [], to: acct(to), amount, fee: [], memo: [], created_at_time: [] }]);

const ICRC3InitArgs = IDL.Record({
  maxActiveRecords: IDL.Nat,
  settleToRecords: IDL.Nat,
  maxRecordsInArchiveInstance: IDL.Nat,
  maxArchivePages: IDL.Nat,
  archiveIndexType: IDL.Variant({ Stable: IDL.Null, StableTyped: IDL.Null, Managed: IDL.Null }),
  maxRecordsToArchive: IDL.Nat,
  archiveCycles: IDL.Nat,
  archiveControllers: IDL.Opt(IDL.Opt(IDL.Vec(IDL.Principal))),
  supportedBlocks: IDL.Vec(IDL.Record({ block_type: IDL.Text, url: IDL.Text })),
});
const ICRC3_ARGS = {
  maxActiveRecords: 3000n,
  settleToRecords: 2000n,
  maxRecordsInArchiveInstance: 500_000n,
  maxArchivePages: 62_500n,
  archiveIndexType: { Stable: null },
  maxRecordsToArchive: 8000n,
  archiveCycles: 20_000_000_000_000n,
  archiveControllers: [],
  supportedBlocks: [],
};

interface Variant {
  name: string;
  wasm: string;
  /** The same actor built from the release before the lock. */
  preLockWasm: string;
  /** Whether the actor has an ingress filter. */
  filtered: boolean;
  installArg: Uint8Array;
}

const sections = { icrc1: IDL.Opt(IDL.Null), icrc2: IDL.Opt(IDL.Null), icrc4: IDL.Opt(IDL.Null) };
const VARIANTS: Variant[] = [
  {
    name: 'Token.mo',
    wasm: wasmPath('TOKEN_WASM', 'token'),
    preLockWasm: wasmPath('TOKEN_PRE_LOCK_WASM', 'token_pre_lock'),
    filtered: true,
    installArg: enc([IDL.Opt(IDL.Record({ ...sections, icrc3: IDL.Opt(ICRC3InitArgs) }))], [[]]),
  },
  {
    name: 'token-mixin.mo',
    wasm: wasmPath('TOKEN_MIXIN_WASM', 'token-mixin'),
    preLockWasm: wasmPath('TOKEN_MIXIN_PRE_LOCK_WASM', 'token_mixin_pre_lock'),
    filtered: false,
    // The mixin's `icrc3` section is not optional.
    installArg: enc(
      [IDL.Opt(IDL.Record({ ...sections, icrc3: ICRC3InitArgs }))],
      [[{ icrc1: [], icrc2: [], icrc3: ICRC3_ARGS, icrc4: [] }]],
    ),
  },
];
const TOKEN = VARIANTS[0];

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

/** What a refusal must leave as it was. */
interface Snapshot {
  locked: boolean;
  minter: string;
  supply: bigint;
  blocks: bigint;
  name: string;
  symbol: string;
  owner: string;
}

class Ledger {
  readonly controller = createIdentity(2).getPrincipal();
  readonly stranger = createIdentity(3).getPrincipal();
  readonly next = createIdentity(4).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();
  readonly anonymous = Principal.anonymous();

  private constructor(
    readonly pic: PocketIc,
    readonly id: Principal,
    readonly variant: Variant,
    readonly installer: Principal,
  ) {}

  /** The installer is the first owner and, by default, the minting account. */
  static async create(variant: Variant, opts: { wasm?: string; installer?: Principal } = {}): Promise<Ledger> {
    const installer = opts.installer ?? createIdentity(1).getPrincipal();
    const controller = createIdentity(2).getPrincipal();
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    const id = await pic.createCanister({ sender: installer, controllers: [installer, controller] });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({ canisterId: id, wasm: readFileSync(opts.wasm ?? variant.wasm), arg: variant.installArg, sender: installer });
    await pic.tick(3);
    return new Ledger(pic, id, variant, installer);
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  query = (method: string, arg: Uint8Array = none, sender: Principal = this.anonymous) =>
    this.pic.queryCall({ canisterId: this.id, method, arg, sender });

  locked = async () => IDL.decode([IDL.Bool], await this.query('is_supply_locked'))[0] as boolean;
  /** `is_supply_locked` as an anonymous update: through the ingress filter, where there is one. */
  lockedByUpdate = async () => IDL.decode([IDL.Bool], await this.send('is_supply_locked', none, this.anonymous))[0] as boolean;
  minter = async () => {
    const [a] = IDL.decode([IDL.Opt(Account)], await this.query('icrc1_minting_account'))[0] as AccountT[];
    return `${a.owner.toText()}${a.subaccount.length ? '+sub' : ''}`;
  };
  supply = async () => IDL.decode([IDL.Nat], await this.query('icrc1_total_supply'))[0] as bigint;
  balanceOf = async (p: Principal) => IDL.decode([IDL.Nat], await this.query('icrc1_balance_of', enc([Account], [acct(p)])))[0] as bigint;
  text = async (method: string) => IDL.decode([IDL.Text], await this.query(method))[0] as string;
  fee = async () => IDL.decode([IDL.Nat], await this.query('icrc1_fee'))[0] as bigint;
  owner = async () => (IDL.decode([IDL.Principal], await this.query('get_owner'))[0] as Principal).toText();
  blocks = async () => {
    const reply = await this.query('icrc3_get_blocks', enc([IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }))], [[]]));
    return (IDL.decode([IDL.Record({ log_length: IDL.Nat })], reply)[0] as { log_length: bigint }).log_length;
  };

  async snapshot(): Promise<Snapshot> {
    return {
      locked: await this.locked(),
      minter: await this.minter(),
      supply: await this.supply(),
      blocks: await this.blocks(),
      name: await this.text('icrc1_name'),
      symbol: await this.text('icrc1_symbol'),
      owner: await this.owner(),
    };
  }

  async expectUnchanged(before: Snapshot, why: string) {
    expect(await this.snapshot(), why).toEqual(before);
  }

  upgradeTo = async (wasm: string) => {
    await this.pic.upgradeCanister({
      canisterId: this.id,
      wasm: readFileSync(wasm),
      arg: this.variant.installArg,
      sender: this.installer,
      upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] },
    });
    await this.pic.tick(3);
  };

  async installRawCaller(): Promise<Principal> {
    const id = await this.pic.createCanister({ sender: this.controller });
    await this.pic.addCycles(id, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: id, wasm: readFileSync(RAW_CALLER_WASM), arg: none, sender: this.controller });
    return id;
  }

  /** `method` of the ledger called by the canister `rawId`: no ingress filter runs. The reply, unwrapped. */
  via = async (rawId: Principal, method: string, arg: Uint8Array): Promise<Uint8Array> => {
    const reply = await this.pic.updateCall({
      canisterId: rawId,
      method: 'call',
      sender: this.controller,
      arg: enc([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [this.id, method, arg]),
    });
    return IDL.decode([IDL.Vec(IDL.Nat8)], reply)[0] as Uint8Array;
  };

  /**
   * Hands the ledger to a fresh caller canister and makes it the minting
   * account too, so that it can mint before the lock.
   */
  async ownerCanister(): Promise<Principal> {
    const raw = await this.installRawCaller();
    await this.send('admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[raw]]), this.installer);
    await this.via(raw, 'accept_ownership', none);
    await this.via(raw, 'admin_update_icrc1', batch([{ MintingAccount: acct(raw) }]));
    expect(await this.owner()).toBe(raw.toText());
    expect(await this.minter()).toBe(raw.toText());
    return raw;
  }

  /** An ingress call that must be refused: by the filter where there is one, by the body otherwise. */
  async expectRefused(method: string, arg: Uint8Array, sender: Principal, body: RegExp, why: string) {
    const failure = await this.send(method, arg, sender).then(() => null, (e: Error) => e);
    expect(failure, why).not.toBeNull();
    expect(failure!.message, why).toMatch(this.variant.filtered ? REFUSED : body);
  }

  /** A call that `inspect` did not see or admitted, and the body trapped on, with `message`. */
  async expectBodyTrap(call: Promise<unknown>, message: RegExp, why: string) {
    const failure = await call.then(() => null, (e: Error) => e);
    expect(failure, why).not.toBeNull();
    expect(failure!.message, why).not.toMatch(REFUSED);
    expect(failure!.message, why).toMatch(message);
  }

  balance = async () => BigInt(await this.pic.getCyclesBalance(this.id));

  /** Cycles the canister spent while `work` ran. */
  async spent(work: () => Promise<unknown>): Promise<bigint> {
    const before = await this.balance();
    await work();
    return before - (await this.balance());
  }
}

const decodeTransfer = (reply: Uint8Array) =>
  IDL.decode([TransferResult], reply)[0] as { Ok: bigint } | { Err: { GenericError: { error_code: bigint; message: string } } };

for (const variant of VARIANTS) {
  describe(`supply lock: the bodies, ${variant.name}`, () => {
    let l: Ledger;
    let raw: Principal;
    beforeEach(async () => {
      l = await Ledger.create(variant);
      raw = await l.ownerCanister();
    }, 180_000);
    afterEach(async () => { await l.tearDown(); });

    it('starts unlocked, and the owner mints and moves the supply settings until it locks', async () => {
      expect(await l.locked()).toBe(false);
      expect('Ok' in decodeTransfer(await l.via(raw, 'mint', mintArgs(l.alice, 1_000_000n)))).toBe(true);
      expect(await l.balanceOf(l.alice)).toBe(1_000_000n);
      const reply = IDL.decode([IDL.Vec(IDL.Bool)], await l.via(raw, 'admin_update_icrc1',
        batch([{ MaxSupply: [10n ** 20n] }, { MintingAccount: acct(raw) }])))[0];
      expect(reply).toEqual([true, true]);
    });

    it('the owner locks; a second lock changes nothing', async () => {
      await l.via(raw, 'mint', mintArgs(l.alice, 1_000_000n));
      await l.via(raw, 'admin_lock_supply', none);
      expect(await l.locked()).toBe(true);
      const before = await l.snapshot();
      await l.via(raw, 'admin_lock_supply', none);
      await l.expectUnchanged(before, 'after the second lock');
      expect(await l.locked()).toBe(true);
    });

    it('after the lock the owner, which is also the minting account, cannot mint', async () => {
      await l.via(raw, 'admin_lock_supply', none);
      const before = await l.snapshot();
      await l.expectBodyTrap(l.via(raw, 'mint', mintArgs(l.alice, 1_000_000n)), LOCKED_MINT, 'the owner minting');
      await l.expectUnchanged(before, 'after the refused mint');
      expect(await l.balanceOf(l.alice)).toBe(0n);
    });

    it('a stranger still gets Unauthorized from mint, locked or not', async () => {
      const outsider = await l.installRawCaller();
      await l.expectBodyTrap(l.via(outsider, 'mint', mintArgs(l.alice, 1n)), UNAUTHORIZED, 'a stranger before the lock');
      await l.via(raw, 'admin_lock_supply', none);
      await l.expectBodyTrap(l.via(outsider, 'mint', mintArgs(l.alice, 1n)), UNAUTHORIZED, 'a stranger after the lock');
    });

    it('refuses a batch with the minting account or the maximum supply whole, whatever the value', async () => {
      await l.via(raw, 'admin_lock_supply', none);
      const before = await l.snapshot();
      const refused: [string, Req[]][] = [
        ['a rename next to a minting account', [{ Name: 'renamed' }, { MintingAccount: acct(l.stranger) }]],
        ['the current minting account again', [{ MintingAccount: acct(raw) }]],
        ['no maximum supply', [{ MaxSupply: [] }]],
        ['a higher maximum supply', [{ MaxSupply: [10n ** 30n] }]],
        ['a lower maximum supply', [{ MaxSupply: [1n] }]],
        ['the maximum supply last in the batch', [{ Symbol: 'NEW' }, { Name: 'renamed' }, { MaxSupply: [5n] }]],
      ];
      for (const [why, requests] of refused) {
        await l.expectBodyTrap(l.via(raw, 'admin_update_icrc1', batch(requests)), LOCKED_UPDATE, why);
        await l.expectUnchanged(before, `after ${why}`);
      }
    });

    it('keeps every other setting editable after the lock', async () => {
      await l.via(raw, 'admin_lock_supply', none);
      const reply = IDL.decode([IDL.Vec(IDL.Bool)], await l.via(raw, 'admin_update_icrc1',
        batch([{ Name: 'Renamed' }, { Symbol: 'RNM' }, { Fee: { Fixed: 12_345n } }])))[0];
      expect(reply).toEqual([true, true, true]);
      expect(await l.text('icrc1_name')).toBe('Renamed');
      expect(await l.text('icrc1_symbol')).toBe('RNM');
      expect(await l.fee()).toBe(12_345n);
      expect(await l.locked()).toBe(true);
    });

    it('a stranger and a pending owner cannot lock', async () => {
      const outsider = await l.installRawCaller();
      await l.expectBodyTrap(l.via(outsider, 'admin_lock_supply', none), UNAUTHORIZED, 'a canister that is not the owner');
      await l.expectRefused('admin_lock_supply', none, l.stranger, UNAUTHORIZED, 'a stranger at ingress');
      await l.via(raw, 'admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[l.next]]));
      await l.expectRefused('admin_lock_supply', none, l.next, UNAUTHORIZED, 'the pending owner');
      expect(await l.locked()).toBe(false);
    });

    it('the lock survives a hand-off, and binds the new owner', async () => {
      await l.via(raw, 'admin_lock_supply', none);
      await l.via(raw, 'admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[l.next]]));
      await l.send('accept_ownership', none, l.next);
      expect(await l.owner()).toBe(l.next.toText());
      expect(await l.locked()).toBe(true);
      const before = await l.snapshot();
      await l.expectRefused('mint', mintArgs(l.alice, 1n), l.next, LOCKED_MINT, 'the new owner minting');
      await l.expectRefused('admin_update_icrc1', batch([{ MintingAccount: acct(l.next) }]), l.next, LOCKED_UPDATE,
        'the new owner taking the minting account');
      await l.expectUnchanged(before, 'after the new owner was refused');
    });

    it('does not close a transfer from a minting account somebody holds (the documented limit)', async () => {
      // The cap is set before the lock, and is what the transfer below is held to.
      await l.via(raw, 'admin_update_icrc1', batch([{ MaxSupply: [1_000n] }]));
      await l.via(raw, 'admin_lock_supply', none);
      const over = decodeTransfer(await l.via(raw, 'icrc1_transfer', transferArgs(l.alice, 2_000n)));
      expect('Err' in over && over.Err.GenericError.error_code, 'over the frozen cap').toBe(6n);
      const within = decodeTransfer(await l.via(raw, 'icrc1_transfer', transferArgs(l.alice, 500n)));
      expect('Ok' in within, 'a transfer from the minting account still mints').toBe(true);
      expect(await l.supply()).toBe(500n);
      expect(await l.balanceOf(l.alice)).toBe(500n);
    });
  });

  describe(`supply lock: the anonymous owner, ${variant.name}`, () => {
    let l: Ledger;
    beforeEach(async () => { l = await Ledger.create(variant, { installer: Principal.anonymous() }); }, 120_000);
    afterEach(async () => { await l.tearDown(); });

    it('a ledger installed by the anonymous principal cannot be locked by it', async () => {
      expect(await l.owner()).toBe(Principal.anonymous().toText());
      await l.expectRefused('admin_lock_supply', none, l.anonymous, UNAUTHORIZED, 'the anonymous owner');
      expect(await l.locked()).toBe(false);
    });
  });

  describe(`supply lock: upgrades, ${variant.name}`, () => {
    let l: Ledger;
    afterEach(async () => { await l.tearDown(); });

    it('an upgrade from the release before the lock keeps the state and starts unlocked', async () => {
      l = await Ledger.create(variant, { wasm: variant.preLockWasm });
      // The installer is the owner and the minting account.
      await l.send('mint', mintArgs(l.alice, 5_000_000n), l.installer);
      const before = await l.snapshot().catch(() => null); // the old build has no is_supply_locked
      expect(before).toBeNull();
      const state = { minter: await l.minter(), supply: await l.supply(), blocks: await l.blocks(),
        owner: await l.owner(), alice: await l.balanceOf(l.alice) };
      expect(state.supply).toBe(5_000_000n);
      await l.upgradeTo(variant.wasm);
      expect(await l.locked()).toBe(false);
      expect({ minter: await l.minter(), supply: await l.supply(), blocks: await l.blocks(),
        owner: await l.owner(), alice: await l.balanceOf(l.alice) }).toEqual(state);
    });

    it('an upgrade does not reset the lock', async () => {
      l = await Ledger.create(variant);
      await l.send('admin_lock_supply', none, l.installer);
      const before = await l.snapshot();
      await l.upgradeTo(variant.wasm);
      await l.expectUnchanged(before, 'after the upgrade');
      expect(await l.locked()).toBe(true);
      await l.expectRefused('mint', mintArgs(l.alice, 1n), l.installer, LOCKED_MINT, 'the owner minting after the upgrade');
    });
  });
}

describe('supply lock: the ingress filter (Token.mo)', () => {
  let l: Ledger;
  beforeEach(async () => { l = await Ledger.create(TOKEN); }, 120_000);
  afterEach(async () => { await l.tearDown(); });

  it('reads the lock for the anonymous principal as a query and as an update', async () => {
    expect(await l.locked()).toBe(false);
    expect(await l.lockedByUpdate()).toBe(false);
    await l.send('admin_lock_supply', none, l.installer);
    expect(await l.locked()).toBe(true);
    expect(await l.lockedByUpdate()).toBe(true);
  });

  it('admits the owner\'s lock, locked or not, and refuses anybody else\'s', async () => {
    for (const sender of [l.stranger, l.anonymous, l.controller]) {
      await expect(l.send('admin_lock_supply', none, sender), sender.toText()).rejects.toThrow(REFUSED);
    }
    await l.send('admin_lock_supply', none, l.installer);
    await l.send('admin_lock_supply', none, l.installer);
    expect(await l.locked()).toBe(true);
  });

  it('refuses a mint and a supply update at ingress once locked, and costs nothing', async () => {
    // Control: before the lock the owner's mint is admitted, and an admitted update is paid for.
    const admitted = await l.spent(() => l.send('mint', mintArgs(l.alice, 1_000n), l.installer));
    expect(admitted).toBeGreaterThan(1_000_000n);
    await l.send('admin_lock_supply', none, l.installer);
    const before = await l.snapshot();
    const spent = await l.spent(async () => {
      await expect(l.send('mint', mintArgs(l.alice, 1_000n), l.installer), 'mint').rejects.toThrow(REFUSED);
      for (const requests of [
        [{ MintingAccount: acct(l.installer) }],
        [{ MaxSupply: [] }],
        [{ Name: 'x' }, { MaxSupply: [10n] }],
      ] as Req[][]) {
        await expect(l.send('admin_update_icrc1', batch(requests), l.installer), JSON.stringify(Object.keys(requests.at(-1)!)))
          .rejects.toThrow(REFUSED);
      }
    });
    expect(spent).toBeLessThan(1_000_000n);
    await l.expectUnchanged(before, 'after the refusals');
  });

  it('admits a metadata update once locked, and the empty batch the deploy runners probe with', async () => {
    await l.send('admin_lock_supply', none, l.installer);
    const reply = IDL.decode([IDL.Vec(IDL.Bool)], await l.send('admin_update_icrc1', batch([{ Name: 'x' }]), l.installer))[0];
    expect(reply).toEqual([true]);
    expect(await l.text('icrc1_name')).toBe('x');
    expect(IDL.decode([IDL.Vec(IDL.Bool)], await l.send('admin_update_icrc1', batch([]), l.installer))[0]).toEqual([]);
    await expect(l.send('admin_update_icrc1', batch([]), l.stranger)).rejects.toThrow(REFUSED);
  });
});
