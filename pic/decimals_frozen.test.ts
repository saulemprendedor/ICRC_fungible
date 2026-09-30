/**
 * The decimals never change after install (src/Token.mo and src/token-mixin.mo).
 *
 * The init args set them at install. From then on `admin_update_icrc1` traps,
 * applying nothing, when its batch carries a `Decimals` request, whatever its
 * value and whether the supply is locked or not. A `Metadata` request for
 * `icrc1:decimals` is admitted but changes nothing: the ledger rewrites that
 * entry from its state. An upgrade does not apply its init args to a working
 * ledger; in `token-mixin.mo` an upgrade that comes before the ICRC-1 state is
 * built still does, as the install would have.
 *
 * The bodies are the access control, so they are proven with an owner that is
 * a canister (`RawCaller`): its calls are inter-canister and `inspect` never
 * sees them. `Token.mo` also refuses the batch in `inspect`; that is proven
 * with ingress calls and their cycle cost in the last block.
 *
 * The ledgers are installed with 2 decimals, not the default 8, so that a
 * value that fell back to the default reads as a change.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const RAW_CALLER_WASM = wasmPath('RAW_CALLER_WASM', 'raw_caller');

const REFUSED = /inspect_message|canister_inspect_message/i;
const UNAUTHORIZED = /Unauthorized/;
const FROZEN = /Decimals cannot change after install/;
const KEEP = { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] } as const;

const INSTALLED = 2;

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
type AccountT = { owner: Principal; subaccount: [] | [Uint8Array] };
const acct = (owner: Principal): AccountT => ({ owner, subaccount: [] });

const Value = IDL.Rec();
Value.fill(IDL.Variant({
  Nat: IDL.Nat,
  Int: IDL.Int,
  Text: IDL.Text,
  Blob: IDL.Vec(IDL.Nat8),
  Array: IDL.Vec(Value),
  Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
}));
type ValueT = { Nat: bigint } | { Text: string } | Record<string, unknown>;

// A subset of ICRC1.UpdateLedgerInfoRequest: a variant encodes into a wider one.
const InfoRequest = IDL.Variant({
  Name: IDL.Text,
  Fee: IDL.Variant({ Fixed: IDL.Nat, Environment: IDL.Null }),
  Decimals: IDL.Nat8,
  Metadata: IDL.Tuple(IDL.Text, IDL.Opt(Value)),
});
type Req =
  | { Name: string } | { Fee: { Fixed: bigint } } | { Decimals: number }
  | { Metadata: [string, [] | [ValueT]] };
const batch = (requests: Req[]) => enc([IDL.Vec(InfoRequest)], [requests]);

// A subset of ICRC1.InitArgs: every field left out is optional there.
const ICRC1InitArgs = IDL.Record({
  name: IDL.Opt(IDL.Text),
  symbol: IDL.Opt(IDL.Text),
  decimals: IDL.Nat8,
  fee: IDL.Opt(IDL.Variant({ Fixed: IDL.Nat, Environment: IDL.Null })),
  minting_account: IDL.Opt(Account),
});
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
  /** Whether the actor has an ingress filter. */
  filtered: boolean;
  /** Whether the `icrc3` section of the init args is optional. */
  icrc3Optional: boolean;
}

const VARIANTS: Variant[] = [
  { name: 'Token.mo', wasm: wasmPath('TOKEN_WASM', 'token'), filtered: true, icrc3Optional: true },
  { name: 'token-mixin.mo', wasm: wasmPath('TOKEN_MIXIN_WASM', 'token-mixin'), filtered: false, icrc3Optional: false },
];
const TOKEN = VARIANTS[0];

/** Init args that set `decimals`; the installer stays the minting account. */
function initArgs(variant: Variant, decimals: number): Uint8Array {
  const type = IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(ICRC1InitArgs),
    icrc2: IDL.Opt(IDL.Null),
    icrc3: variant.icrc3Optional ? IDL.Opt(ICRC3InitArgs) : ICRC3InitArgs,
    icrc4: IDL.Opt(IDL.Null),
  }));
  const icrc1 = { name: ['Probe'], symbol: ['PRB'], decimals, fee: [{ Fixed: 10_000n }], minting_account: [] };
  return enc([type], [[{ icrc1: [icrc1], icrc2: [], icrc3: variant.icrc3Optional ? [ICRC3_ARGS] : ICRC3_ARGS, icrc4: [] }]]);
}

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

/** What a refusal must leave as it was. */
interface Snapshot {
  decimals: number;
  metadataDecimals: bigint | undefined;
  name: string;
  fee: bigint;
  locked: boolean;
}

class Ledger {
  readonly controller = createIdentity(2).getPrincipal();
  readonly stranger = createIdentity(3).getPrincipal();
  readonly installer = createIdentity(1).getPrincipal();
  readonly anonymous = Principal.anonymous();

  private constructor(readonly pic: PocketIc, readonly id: Principal, readonly variant: Variant) {}

  /**
   * The installer is the first owner and the minting account. With `stopped`
   * the canister is stopped before the install and left stopped, so the
   * mixin's ICRC-1 state is not built yet.
   */
  static async create(variant: Variant, opts: { stopped?: boolean } = {}): Promise<Ledger> {
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    const installer = createIdentity(1).getPrincipal();
    const controller = createIdentity(2).getPrincipal();
    const id = await pic.createCanister({ sender: installer, controllers: [installer, controller] });
    await pic.addCycles(id, 100_000_000_000_000n);
    if (opts.stopped) await pic.stopCanister({ canisterId: id, sender: installer });
    await pic.installCode({ canisterId: id, wasm: readFileSync(variant.wasm), arg: initArgs(variant, INSTALLED), sender: installer });
    await pic.tick(3);
    return new Ledger(pic, id, variant);
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  query = (method: string, arg: Uint8Array = none) =>
    this.pic.queryCall({ canisterId: this.id, method, arg, sender: this.anonymous });

  decimals = async () => IDL.decode([IDL.Nat8], await this.query('icrc1_decimals'))[0] as number;
  metadataDecimals = async () => {
    const entries = IDL.decode([IDL.Vec(IDL.Tuple(IDL.Text, Value))], await this.query('icrc1_metadata'))[0] as [string, ValueT][];
    const found = entries.filter(([key]) => key === 'icrc1:decimals');
    expect(found.length, 'one icrc1:decimals entry').toBe(1);
    return (found[0][1] as { Nat: bigint }).Nat;
  };
  name = async () => IDL.decode([IDL.Text], await this.query('icrc1_name'))[0] as string;
  fee = async () => IDL.decode([IDL.Nat], await this.query('icrc1_fee'))[0] as bigint;
  locked = async () => IDL.decode([IDL.Bool], await this.query('is_supply_locked'))[0] as boolean;
  owner = async () => (IDL.decode([IDL.Principal], await this.query('get_owner'))[0] as Principal).toText();

  async snapshot(): Promise<Snapshot> {
    return {
      decimals: await this.decimals(),
      metadataDecimals: await this.metadataDecimals(),
      name: await this.name(),
      fee: await this.fee(),
      locked: await this.locked(),
    };
  }

  async expectUnchanged(before: Snapshot, why: string) {
    expect(await this.snapshot(), why).toEqual(before);
  }

  /** Upgrades with init args that carry other decimals. */
  upgradeWith = async (decimals: number) => {
    await this.pic.upgradeCanister({
      canisterId: this.id,
      wasm: readFileSync(this.variant.wasm),
      arg: initArgs(this.variant, decimals),
      sender: this.installer,
      upgradeModeOptions: KEEP,
    });
    await this.pic.tick(3);
  };

  start = async () => {
    await this.pic.startCanister({ canisterId: this.id, sender: this.installer });
    await this.pic.tick(3);
  };

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

  /** Hands the ledger to a fresh caller canister, whose calls `inspect` never sees. */
  async ownerCanister(): Promise<Principal> {
    const raw = await this.pic.createCanister({ sender: this.controller });
    await this.pic.addCycles(raw, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: raw, wasm: readFileSync(RAW_CALLER_WASM), arg: none, sender: this.controller });
    await this.send('admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[raw]]), this.installer);
    await this.via(raw, 'accept_ownership', none);
    expect(await this.owner()).toBe(raw.toText());
    return raw;
  }

  balance = async () => BigInt(await this.pic.getCyclesBalance(this.id));

  /** Cycles the canister spent while `work` ran. */
  async spent(work: () => Promise<unknown>): Promise<bigint> {
    const before = await this.balance();
    await work();
    return before - (await this.balance());
  }
}

/** A batch as the names of its requests, for the assertion messages. */
const show = (requests: Req[]) => requests.map((r) => Object.keys(r)[0]).join(',');

const bools = (reply: Uint8Array) => IDL.decode([IDL.Vec(IDL.Bool)], reply)[0] as boolean[];

async function expectBodyTrap(call: Promise<unknown>, message: RegExp, why: string) {
  const failure = await call.then(() => null, (e: Error) => e);
  expect(failure, why).not.toBeNull();
  expect(failure!.message, why).not.toMatch(REFUSED);
  expect(failure!.message, why).toMatch(message);
}

for (const variant of VARIANTS) {
  describe(`frozen decimals: the bodies, ${variant.name}`, () => {
    let l: Ledger;
    let raw: Principal;
    afterEach(async () => { await l.tearDown(); });
    const setUp = async () => {
      l = await Ledger.create(variant);
      raw = await l.ownerCanister();
    };
    const update = (requests: Req[]) => l.via(raw, 'admin_update_icrc1', batch(requests));

    it('the init args set the decimals, in icrc1_decimals and in the metadata', async () => {
      await setUp();
      expect(await l.decimals()).toBe(INSTALLED);
      expect(await l.metadataDecimals()).toBe(BigInt(INSTALLED));
    });

    it('refuses a Decimals request, another value or the same one, and changes nothing', async () => {
      await setUp();
      const before = await l.snapshot();
      for (const decimals of [3, INSTALLED, 8]) {
        await expectBodyTrap(update([{ Decimals: decimals }]), FROZEN, `Decimals ${decimals}`);
        await l.expectUnchanged(before, `after Decimals ${decimals}`);
      }
    });

    it('refuses it after the lock too, as a change of decimals', async () => {
      await setUp();
      await l.via(raw, 'admin_lock_supply', none);
      const before = await l.snapshot();
      expect(before.locked).toBe(true);
      await expectBodyTrap(update([{ Decimals: 3 }]), FROZEN, 'locked');
      await l.expectUnchanged(before, 'after the refusal');
    });

    it('refuses a mixed batch whole, wherever the Decimals request sits in it', async () => {
      await setUp();
      const before = await l.snapshot();
      for (const requests of [
        [{ Decimals: 3 }, { Name: 'x' }],
        [{ Name: 'x' }, { Decimals: 3 }],
        [{ Name: 'x' }, { Decimals: 3 }, { Fee: { Fixed: 1n } }],
      ] as Req[][]) {
        const why = show(requests);
        await expectBodyTrap(update(requests), FROZEN, why);
        await l.expectUnchanged(before, why);
      }
    });

    it('the control: every other setting stays editable, locked or not, and the empty batch passes', async () => {
      await setUp();
      expect(bools(await update([{ Name: 'x' }]))).toEqual([true]);
      expect(await l.name()).toBe('x');
      await l.via(raw, 'admin_lock_supply', none);
      expect(bools(await update([{ Name: 'y' }, { Fee: { Fixed: 1n } }]))).toEqual([true, true]);
      expect(await l.name()).toBe('y');
      expect(await l.fee()).toBe(1n);
      expect(bools(await update([]))).toEqual([]);
      expect(await l.decimals()).toBe(INSTALLED);
    });

    it('a stranger with a Decimals request still gets Unauthorized', async () => {
      l = await Ledger.create(variant);
      const before = await l.snapshot();
      const failure = await l.send('admin_update_icrc1', batch([{ Decimals: 3 }]), l.stranger).then(() => null, (e: Error) => e);
      expect(failure).not.toBeNull();
      expect(failure!.message).toMatch(variant.filtered ? REFUSED : UNAUTHORIZED);
      await l.expectUnchanged(before, 'after the refusal');
    });

    it('a Metadata request for icrc1:decimals is admitted and changes nothing', async () => {
      await setUp();
      const before = await l.snapshot();
      expect(bools(await update([{ Metadata: ['icrc1:decimals', [{ Nat: 3n }]] }]))).toEqual([true]);
      await l.expectUnchanged(before, 'after setting the entry');
      expect(bools(await update([{ Metadata: ['icrc1:decimals', []] }]))).toEqual([true]);
      await l.expectUnchanged(before, 'after removing the entry');
    });
  });

  describe(`frozen decimals: upgrades, ${variant.name}`, () => {
    let l: Ledger;
    afterEach(async () => { await l.tearDown(); });

    it('an upgrade of a working ledger does not apply the decimals of its init args', async () => {
      l = await Ledger.create(variant);
      const before = await l.snapshot();
      await l.upgradeWith(5);
      await l.expectUnchanged(before, 'after the upgrade');
    });

    if (!variant.filtered) {
      it('an upgrade that comes before the ICRC-1 state is built sets them, as the install would have', async () => {
        l = await Ledger.create(variant, { stopped: true });
        await l.upgradeWith(5);
        await l.start();
        expect(await l.decimals()).toBe(5);
        expect(await l.metadataDecimals()).toBe(5n);
        // From then on they are frozen like any other.
        await expect(l.send('admin_update_icrc1', batch([{ Decimals: 3 }]), l.installer)).rejects.toThrow(FROZEN);
        expect(await l.decimals()).toBe(5);
      });
    }
  });
}

describe('frozen decimals: the ingress filter (Token.mo)', () => {
  let l: Ledger;
  afterEach(async () => { await l.tearDown(); });

  it('refuses the owner\'s Decimals request at ingress, locked or not, and it costs nothing', async () => {
    l = await Ledger.create(TOKEN);
    // Control: the owner's other updates are admitted, and an admitted update is paid for.
    const admitted = await l.spent(() => l.send('admin_update_icrc1', batch([{ Name: 'x' }]), l.installer));
    expect(admitted).toBeGreaterThan(1_000_000n);
    const before = await l.snapshot();
    const spent = await l.spent(async () => {
      for (const requests of [
        [{ Decimals: 3 }],
        [{ Decimals: INSTALLED }],
        [{ Name: 'y' }, { Decimals: 3 }],
      ] as Req[][]) {
        await expect(l.send('admin_update_icrc1', batch(requests), l.installer), show(requests)).rejects.toThrow(REFUSED);
      }
    });
    expect(spent).toBeLessThan(1_000_000n);
    await l.expectUnchanged(before, 'after the refusals');

    await l.send('admin_lock_supply', none, l.installer);
    await expect(l.send('admin_update_icrc1', batch([{ Decimals: 3 }]), l.installer), 'locked').rejects.toThrow(REFUSED);
    expect(await l.decimals()).toBe(INSTALLED);
  });
});
