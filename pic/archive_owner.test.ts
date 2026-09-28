/**
 * Who administers the ICRC-3 archives (src/Token.mo), with real archives.
 *
 * `upgradeArchive`, `update_archive_controllers` and `getUpgradeError` follow the
 * mutable `owner`, never the class parameter `_owner`: `_owner` is whoever
 * performed the last install or upgrade, so gating on it would hand the
 * archives to anyone who upgrades the ledger. `update_archive_controllers`
 * REPLACES each archive's controllers with
 *
 *   archiveControllers = ?(?list)  →  list ∪ {ledger, owner}
 *   archiveControllers = ?null     →  {ledger, owner}
 *   archiveControllers = null      →  nothing; every archive reports #Err
 *
 * and returns one result per archive, awaiting each `update_settings`.
 *
 * How the assertions are built:
 *  - Controllers are read from the management canister (`pic.getControllers`),
 *    never from the method's own reply alone.
 *  - An ingress refusal is matched on its shape; a trap in the body is matched
 *    on "Unauthorized" AND on NOT being the ingress refusal, through a caller
 *    canister, which `inspect` never sees.
 *  - The archives are created by the ledger itself: a small `maxActiveRecords`
 *    and `maxRecordsInArchiveInstance`, enough mints, then time and ticks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

const TOKEN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');
const RAW_CALLER_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/raw_caller/raw_caller.wasm.gz');
const INTERLEAVE_CALLER_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/interleave_caller/interleave_caller.wasm.gz');

// =============== IDL Types ===============

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MintArgs = IDL.Record({
  to: Account,
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const ArchiveControllersResult = IDL.Record({
  canister_id: IDL.Principal,
  result: IDL.Variant({ Ok: IDL.Vec(IDL.Principal), Err: IDL.Text }),
});
const ArchiveInfo = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat });
const GetArchivesArgs = IDL.Record({ from: IDL.Opt(IDL.Principal) });

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
// Only the icrc3 section is set; the other sections take the defaults of src/Token.mo.
const TokenInitArgs = IDL.Opt(IDL.Record({
  icrc1: IDL.Opt(IDL.Null),
  icrc2: IDL.Opt(IDL.Null),
  icrc3: IDL.Opt(ICRC3InitArgs),
  icrc4: IDL.Opt(IDL.Null),
}));

type Result = { canister_id: Principal; result: { Ok: Principal[] } | { Err: string } };

// =============== Helpers ===============

const REFUSED = /inspect_message|canister_inspect_message/i;
const NOT_CONFIGURED = 'archive controllers are not configured';
const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

const sorted = (ps: Principal[]) => ps.map((p) => p.toText()).sort();

/** How the ledger's `archiveControllers` is configured, in Candid terms. */
type ArchiveConfig = { kind: 'list'; list: Principal[] } | { kind: 'ledgerAndOwner' } | { kind: 'unmanaged' };
const encodeConfig = (c: ArchiveConfig) =>
  c.kind === 'list' ? [[c.list]] : c.kind === 'ledgerAndOwner' ? [[]] : [];

// Measured in PocketIC: 2 archives after 40 mints with these limits.
const ARCHIVE_LIMITS = {
  maxActiveRecords: 10n,
  settleToRecords: 5n,
  maxRecordsInArchiveInstance: 15n,
  maxArchivePages: 62_500n,
  archiveIndexType: { Stable: null },
  maxRecordsToArchive: 10n,
  archiveCycles: 2_000_000_000_000n,
};
const MINTS = 40;
const LEDGER_CYCLES = 100_000_000_000_000n; // far above 2 × archiveCycles per archive

class Ledger {
  static server: PocketIcServer | undefined;

  readonly installer = createIdentity(1).getPrincipal(); // installs, so it is the first owner
  readonly controller = createIdentity(2).getPrincipal(); // a controller that is not the owner
  readonly newOwner = createIdentity(4).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();
  /** Named in `archiveControllers`, so it controls every archive; tests use it to tamper. */
  static readonly configured = createIdentity(6).getPrincipal();

  private constructor(readonly pic: PocketIc, readonly id: Principal) {}

  static async create(config: ArchiveConfig): Promise<Ledger> {
    for (const p of [TOKEN_WASM_PATH, RAW_CALLER_WASM_PATH, INTERLEAVE_CALLER_WASM_PATH]) {
      if (!existsSync(p)) throw new Error(`WASM not found at ${p}. Run pic/build-token-wasm.sh first.`);
    }
    Ledger.server ??= await PocketIcServer.start();
    const pic = await PocketIc.create(Ledger.server.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });
    const who = new Ledger(pic, Principal.anonymous());
    const id = await pic.createCanister({ sender: who.installer, controllers: [who.installer, who.controller] });
    await pic.addCycles(id, LEDGER_CYCLES);
    await pic.installCode({
      canisterId: id,
      wasm: readFileSync(TOKEN_WASM_PATH),
      arg: IDL.encode([TokenInitArgs], [[{
        icrc1: [],
        icrc2: [],
        icrc3: [{
          ...ARCHIVE_LIMITS,
          archiveControllers: encodeConfig(config),
          supportedBlocks: [],
        }],
        icrc4: [],
      }]]),
      sender: who.installer,
    });
    const ledger = new Ledger(pic, id);
    await pic.tick(3);
    return ledger;
  }

  static async stopServer() {
    if (Ledger.server) await Ledger.server.stop();
    Ledger.server = undefined;
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  /** Mints until the ledger has spun off `atLeast` archives. */
  async growArchives(atLeast: number): Promise<Principal[]> {
    for (let i = 0; i < MINTS; i++) {
      await this.send('mint', enc([MintArgs], [{
        to: { owner: this.alice, subaccount: [] }, amount: 1_000_000n + BigInt(i), memo: [], created_at_time: [],
      }]), this.installer);
    }
    for (let round = 0; round < 30; round++) {
      await this.pic.advanceTime(10_000);
      await this.pic.tick(5);
      const archives = await this.archives();
      if (archives.length >= atLeast) return archives;
    }
    throw new Error(`the ledger did not create ${atLeast} archives`);
  }

  /** The archive canisters, without the ledger's own entry. */
  async archives(): Promise<Principal[]> {
    const reply = await this.pic.queryCall({
      canisterId: this.id, method: 'icrc3_get_archives', arg: enc([GetArchivesArgs], [{ from: [] }]),
    });
    const list = IDL.decode([IDL.Vec(ArchiveInfo)], reply)[0] as unknown as { canister_id: Principal }[];
    return list.map((a) => a.canister_id).filter((p) => p.toText() !== this.id.toText());
  }

  async updateArchiveControllers(sender: Principal): Promise<Result[]> {
    const reply = await this.send('update_archive_controllers', none, sender);
    return IDL.decode([IDL.Vec(ArchiveControllersResult)], reply)[0] as unknown as Result[];
  }

  controllersOf = async (canister: Principal) => sorted(await this.pic.getControllers(canister));

  /** A same-wasm upgrade performed by `sender`, which re-binds `_owner` to it. */
  upgradeAs = (sender: Principal) =>
    this.pic.upgradeCanister({
      canisterId: this.id,
      wasm: readFileSync(TOKEN_WASM_PATH),
      arg: IDL.encode([TokenInitArgs], [[]]),
      sender,
      upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] },
    });

  async installCaller(wasmPath: string): Promise<Principal> {
    const id = await this.pic.createCanister({ sender: this.installer });
    await this.pic.addCycles(id, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: id, wasm: readFileSync(wasmPath), arg: enc([], []), sender: this.installer });
    return id;
  }

  installRawCaller = () => this.installCaller(RAW_CALLER_WASM_PATH);

  /** `method` of the ledger called by `rawId`, an inter-canister call that `inspect` never sees. */
  via = (rawId: Principal, method: string, arg: Uint8Array) =>
    this.pic.updateCall({
      canisterId: rawId,
      method: 'call',
      sender: this.installer,
      arg: IDL.encode([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [this.id, method, arg]),
    });
}

afterAll(async () => { await Ledger.stopServer(); });

// =============== Test Suite ===============

describe('archive administration, archiveControllers = ?(?[configured])', () => {
  let l: Ledger;
  let archives: Principal[];
  const expected = (owner: Principal) => sorted([Ledger.configured, l.id, owner]);

  beforeAll(async () => {
    l = await Ledger.create({ kind: 'list', list: [Ledger.configured] });
    archives = await l.growArchives(2);
  }, 300_000);
  afterAll(async () => { await l.tearDown(); });

  it('the owner writes configured ∪ {ledger, owner} to every archive, and reports it per archive', async () => {
    const results = await l.updateArchiveControllers(l.installer);
    expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
    for (const r of results) {
      expect('Ok' in r.result, r.canister_id.toText()).toBe(true);
      expect(sorted((r.result as { Ok: Principal[] }).Ok)).toEqual(expected(l.installer));
      expect(await l.controllersOf(r.canister_id)).toEqual(expected(l.installer));
    }
    // A client built on the old `() -> ()` signature still decodes the reply.
    expect(() => IDL.decode([], new Uint8Array(IDL.encode([IDL.Vec(ArchiveControllersResult)], [results])))).not.toThrow();
  });

  it('the owner reads the upgrade error and runs upgradeArchive', async () => {
    await expect(l.send('getUpgradeError', none, l.installer)).resolves.toBeDefined();
    await expect(l.send('upgradeArchive', enc([IDL.Bool], [true]), l.installer)).resolves.toBeDefined();
    const error = IDL.decode([IDL.Text], await l.send('getUpgradeError', none, l.installer))[0];
    expect(error).toBe('');
  });

  it('an upgrade by another controller grants it nothing and leaves the archives alone', async () => {
    const before = await Promise.all(archives.map((a) => l.controllersOf(a)));
    await l.upgradeAs(l.controller);
    await l.pic.tick(3);

    await expect(l.send('update_archive_controllers', none, l.controller)).rejects.toThrow(REFUSED);
    await expect(l.send('upgradeArchive', enc([IDL.Bool], [true]), l.controller)).rejects.toThrow(REFUSED);
    await expect(l.send('getUpgradeError', none, l.controller)).rejects.toThrow(REFUSED);
    expect(await Promise.all(archives.map((a) => l.controllersOf(a)))).toEqual(before);
    for (const a of archives) expect(await l.controllersOf(a)).not.toContain(l.controller.toText());

    // The owner did not move with the upgrade, and still writes itself, not the upgrader.
    for (const r of await l.updateArchiveControllers(l.installer)) {
      expect(sorted((r.result as { Ok: Principal[] }).Ok)).toEqual(expected(l.installer));
    }
  });

  it('a rejected update is reported for its archive, and the others still run', async () => {
    const [broken, ...rest] = archives;
    // The configured controller takes the ledger off one archive.
    await l.pic.updateCanisterSettings({
      canisterId: broken, controllers: [Ledger.configured, l.installer], sender: Ledger.configured,
    });

    const results = await l.updateArchiveControllers(l.installer);
    const byId = new Map(results.map((r) => [r.canister_id.toText(), r.result]));
    expect(results).toHaveLength(archives.length);
    expect('Err' in byId.get(broken.toText())!).toBe(true);
    expect(await l.controllersOf(broken)).toEqual(sorted([Ledger.configured, l.installer]));
    for (const a of rest) {
      expect('Ok' in byId.get(a.toText())!, a.toText()).toBe(true);
      expect(await l.controllersOf(a)).toEqual(expected(l.installer));
    }

    // Put the ledger back for the tests that follow.
    await l.pic.updateCanisterSettings({ canisterId: broken, controllers: [Ledger.configured, l.id, l.installer], sender: Ledger.configured });
  });

  it('the list replaces the archive\'s controllers: an extra controller is dropped', async () => {
    const [a] = archives;
    await l.pic.updateCanisterSettings({
      canisterId: a, controllers: [Ledger.configured, l.id, l.installer, l.alice], sender: Ledger.configured,
    });
    await l.updateArchiveControllers(l.installer);
    expect(await l.controllersOf(a)).toEqual(expected(l.installer));
  });

  it('after a hand-off, the former owner is refused and the new owner drops it from every archive', async () => {
    await l.send('admin_update_owner', enc([IDL.Principal], [l.newOwner]), l.installer);

    await expect(l.send('update_archive_controllers', none, l.installer)).rejects.toThrow(REFUSED);
    await expect(l.send('upgradeArchive', enc([IDL.Bool], [true]), l.installer)).rejects.toThrow(REFUSED);
    await expect(l.send('getUpgradeError', none, l.installer)).rejects.toThrow(REFUSED);

    for (const r of await l.updateArchiveControllers(l.newOwner)) {
      expect(sorted((r.result as { Ok: Principal[] }).Ok)).toEqual(expected(l.newOwner));
      expect(await l.controllersOf(r.canister_id)).toEqual(expected(l.newOwner));
      expect(await l.controllersOf(r.canister_id)).not.toContain(l.installer.toText());
    }
  });
});

describe('archive administration: the body decides past the filter', () => {
  let l: Ledger;
  beforeAll(async () => { l = await Ledger.create({ kind: 'list', list: [Ledger.configured] }); }, 120_000);
  afterAll(async () => { await l.tearDown(); });

  it('a caller canister that was the owner is trapped by the body after it hands off', async () => {
    const rawId = await l.installRawCaller();
    await l.send('admin_update_owner', enc([IDL.Principal], [rawId]), l.installer);

    // As the owner, the caller canister gets through, with no archive yet.
    const reply = IDL.decode([IDL.Vec(IDL.Nat8)], await l.via(rawId, 'update_archive_controllers', none))[0] as Uint8Array;
    expect(IDL.decode([IDL.Vec(ArchiveControllersResult)], new Uint8Array(reply))[0]).toEqual([]);

    await l.via(rawId, 'admin_update_owner', enc([IDL.Principal], [l.newOwner]));
    for (const [method, arg] of [
      ['update_archive_controllers', none],
      ['upgradeArchive', enc([IDL.Bool], [true])],
      ['getUpgradeError', none],
    ] as const) {
      const failure = await l.via(rawId, method, arg).then(() => null, (e: Error) => e);
      expect(failure, method).not.toBeNull();
      expect(failure!.message, method).not.toMatch(REFUSED);
      expect(failure!.message, method).toMatch(/Unauthorized/);
    }
    await expect(l.updateArchiveControllers(l.newOwner)).resolves.toEqual([]);
  });
});

describe('archive administration, archiveControllers = ?null', () => {
  let l: Ledger;
  let archives: Principal[];
  beforeAll(async () => {
    l = await Ledger.create({ kind: 'ledgerAndOwner' });
    archives = await l.growArchives(1);
  }, 300_000);
  afterAll(async () => { await l.tearDown(); });

  it('writes exactly {ledger, owner}', async () => {
    for (const r of await l.updateArchiveControllers(l.installer)) {
      expect(sorted((r.result as { Ok: Principal[] }).Ok)).toEqual(sorted([l.id, l.installer]));
    }
    for (const a of archives) expect(await l.controllersOf(a)).toEqual(sorted([l.id, l.installer]));
  });
});

describe('archive administration, archiveControllers = null (unmanaged)', () => {
  let l: Ledger;
  let archives: Principal[];
  beforeAll(async () => {
    l = await Ledger.create({ kind: 'unmanaged' });
    archives = await l.growArchives(1);
  }, 300_000);
  afterAll(async () => { await l.tearDown(); });

  it('sends nothing and reports every archive as not configured', async () => {
    const before = await Promise.all(archives.map((a) => l.controllersOf(a)));
    const results = await l.updateArchiveControllers(l.installer);
    expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
    for (const r of results) expect(r.result).toEqual({ Err: NOT_CONFIGURED });
    expect(await Promise.all(archives.map((a) => l.controllersOf(a)))).toEqual(before);
    for (const c of before) expect(c).not.toContain(l.installer.toText());
  });
});

describe('archive administration: one call writes one owner', () => {
  let l: Ledger;
  let archives: Principal[];
  beforeAll(async () => {
    l = await Ledger.create({ kind: 'list', list: [Ledger.configured] });
    archives = await l.growArchives(2);
  }, 300_000);
  afterAll(async () => { await l.tearDown(); });

  // The owner is read once, before the first `await`. A hand-off that runs while
  // the call is suspended must not reach the archives it has not written yet.
  // The hand-off is enqueued behind the update by a caller canister, so the
  // ledger runs it at the update's first `await` (between the first
  // `update_settings` and the second); re-reading `owner` per archive writes the
  // new owner from the second archive on, which this test catches.
  it('a hand-off during the call leaves every archive of that call with the owner that sent it', async () => {
    expect(archives.length).toBeGreaterThanOrEqual(2);
    const callerId = await l.installCaller(INTERLEAVE_CALLER_WASM_PATH);
    await l.send('admin_update_owner', enc([IDL.Principal], [callerId]), l.installer);

    const reply = await l.pic.updateCall({
      canisterId: callerId,
      method: 'update_then_hand_off',
      sender: l.installer,
      arg: IDL.encode([IDL.Principal, IDL.Principal], [l.id, l.newOwner]),
    });
    const results = IDL.decode([IDL.Vec(ArchiveControllersResult)], reply)[0] as unknown as Result[];

    expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
    const want = sorted([Ledger.configured, l.id, callerId]);
    for (const r of results) {
      expect(sorted((r.result as { Ok: Principal[] }).Ok), r.canister_id.toText()).toEqual(want);
      expect(await l.controllersOf(r.canister_id), r.canister_id.toText()).toEqual(want);
    }
    // The hand-off did land: the new owner now administers, the caller does not.
    await expect(l.updateArchiveControllers(l.newOwner)).resolves.toHaveLength(archives.length);
  });
});
