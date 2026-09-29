/**
 * What `upgradeArchive` reports (src/Token.mo), and the IC's limit of 10
 * controllers on the set the ledger writes to its archives.
 *
 * `upgradeArchive(bOverride)` returns one entry per archive. The run completes
 * only when every archive upgraded; after a failure `upgradeArchive(false)`
 * runs again. `getUpgradeError` answers the failures of the last run, joined
 * with "; ", or "" when it had none. One run at a time: a second call while
 * one is in flight traps.
 *
 * The failure is real: a controller named in `archiveControllers` freezes an
 * archive by raising its freezing threshold above its balance, and the IC
 * refuses to install code on a frozen canister. Stopping the archive would not
 * do: an upgrade installs on a stopped canister.
 *
 * The controller limit: the ledger adds itself and the owner to the configured
 * list, so an install with more than 8 other principals traps, and
 * `update_archive_controllers` reports a set past 10 without sending it. A
 * ledger past the limit comes from the build before the install check
 * (`token_pre_limit`), upgraded in place: the upgrade is not refused.
 *
 * Wasms: `bash pic/build-token-wasm.sh`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { ArchiveUpgradeResult, UpgradeResult, createIdentity, wasmPath } from './archive_harness';

const TOKEN_WASM = wasmPath('TOKEN_WASM', 'token');
const PRE_LIMIT_WASM = wasmPath('PRE_LIMIT_TOKEN_WASM', 'token_pre_limit');
const FINALLY_PROBE_WASM = wasmPath('FINALLY_PROBE_WASM', 'finally_probe');
const TWICE_CALLER_WASM = wasmPath('TWICE_CALLER_WASM', 'twice_caller');

// =============== IDL ===============

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
type ControllersResult = { canister_id: Principal; result: { Ok: Principal[] } | { Err: string } };
const ArchiveInfo = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat });
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
const TokenInitArgs = IDL.Opt(IDL.Record({
  icrc1: IDL.Opt(IDL.Null),
  icrc2: IDL.Opt(IDL.Null),
  icrc3: IDL.Opt(ICRC3InitArgs),
  icrc4: IDL.Opt(IDL.Null),
}));

// =============== Helpers ===============

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);
const sorted = (ps: Principal[]) => ps.map((p) => p.toText()).sort();
const LIMIT = /exceeds the IC limit of 10 controllers/;

// Measured in PocketIC (pic/archive_owner.test.ts): 2 archives after 40 mints.
const ARCHIVE_LIMITS = {
  maxActiveRecords: 10n,
  settleToRecords: 5n,
  maxRecordsInArchiveInstance: 15n,
  maxArchivePages: 62_500n,
  archiveIndexType: { Stable: null },
  maxRecordsToArchive: 10n,
  archiveCycles: 2_000_000_000_000n,
};
const LEDGER_CYCLES = 100_000_000_000_000n;
// Far above what an archive holds, so the archive freezes; and the default.
const FROZEN = 1n << 60n;
const DEFAULT_FREEZING_THRESHOLD = 2_592_000n;

const tokenArgs = (list: Principal[] | null) => enc([TokenInitArgs], [[{
  icrc1: [],
  icrc2: [],
  icrc3: [{ ...ARCHIVE_LIMITS, archiveControllers: list === null ? [[]] : [[list]], supportedBlocks: [] }],
  icrc4: [],
}]]);

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); });
afterAll(async () => { await server?.stop(); });

const newPic = () => PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });

class Ledger {
  readonly owner = createIdentity(1).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();
  /** Named in `archiveControllers`, so it controls every archive; tests use it to freeze one. */
  static readonly configured = createIdentity(6).getPrincipal();

  constructor(readonly pic: PocketIc, readonly id: Principal) {}

  /** A ledger canister with cycles and no code yet. */
  static async empty(pic: PocketIc): Promise<Ledger> {
    const owner = createIdentity(1).getPrincipal();
    const id = await pic.createCanister({ sender: owner });
    await pic.addCycles(id, LEDGER_CYCLES);
    return new Ledger(pic, id);
  }

  install = (wasm: string, arg: Uint8Array) =>
    this.pic.installCode({ canisterId: this.id, wasm: readFileSync(wasm), arg, sender: this.owner })
      .then(() => this.pic.tick(3));

  upgrade = (wasm: string, arg: Uint8Array) =>
    this.pic.upgradeCanister({
      canisterId: this.id, wasm: readFileSync(wasm), arg, sender: this.owner,
      upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] },
    }).then(() => this.pic.tick(3));

  send = (method: string, arg: Uint8Array, sender: Principal = this.owner) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  async growArchives(atLeast: number, mints = 40): Promise<Principal[]> {
    for (let i = 0; i < mints; i++) {
      await this.send('mint', enc([MintArgs], [{
        to: { owner: this.alice, subaccount: [] }, amount: 1_000_000n + BigInt(i), memo: [], created_at_time: [],
      }]));
    }
    for (let round = 0; round < 30; round++) {
      await this.pic.advanceTime(10_000);
      await this.pic.tick(5);
      const list = await this.archives();
      if (list.length >= atLeast) return list;
    }
    throw new Error(`the ledger did not create ${atLeast} archives`);
  }

  async archives(): Promise<Principal[]> {
    const reply = await this.pic.queryCall({
      canisterId: this.id, method: 'icrc3_get_archives', arg: enc([IDL.Record({ from: IDL.Opt(IDL.Principal) })], [{ from: [] }]),
    });
    const list = IDL.decode([IDL.Vec(ArchiveInfo)], reply)[0] as unknown as { canister_id: Principal }[];
    return list.map((a) => a.canister_id).filter((p) => p.toText() !== this.id.toText());
  }

  async upgradeArchive(bOverride: boolean): Promise<UpgradeResult[]> {
    const reply = await this.send('upgradeArchive', enc([IDL.Bool], [bOverride]));
    return IDL.decode([IDL.Vec(ArchiveUpgradeResult)], reply)[0] as unknown as UpgradeResult[];
  }

  async upgradeError(): Promise<string> {
    return IDL.decode([IDL.Text], await this.send('getUpgradeError', none))[0] as unknown as string;
  }

  async updateArchiveControllers(): Promise<ControllersResult[]> {
    const reply = await this.send('update_archive_controllers', none);
    return IDL.decode([IDL.Vec(ArchiveControllersResult)], reply)[0] as unknown as ControllersResult[];
  }

  controllersOf = async (canister: Principal) => sorted(await this.pic.getControllers(canister));

  setFreezing = (archive: Principal, freezingThreshold: bigint) =>
    this.pic.updateCanisterSettings({ canisterId: archive, freezingThreshold, sender: Ledger.configured });
}

const errOf = (r: UpgradeResult) => ('Err' in r.result ? r.result.Err : null);
const byId = (results: UpgradeResult[], id: Principal) => {
  const r = results.find((x) => x.canister_id.toText() === id.toText());
  if (!r) throw new Error(`no entry for ${id.toText()}`);
  return r;
};

// =============== upgradeArchive ===============

describe('upgradeArchive reports each archive and completes only when all upgrade', () => {
  let pic: PocketIc;
  let l: Ledger;
  let archives: Principal[];

  beforeAll(async () => {
    pic = await newPic();
    l = await Ledger.empty(pic);
    await l.install(TOKEN_WASM, tokenArgs([Ledger.configured]));
    archives = await l.growArchives(2);
    expect(archives.length).toBe(2);
  }, 600_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('a frozen archive is reported, the other upgrades, and the run does not complete', async () => {
    const [frozen, healthy] = archives;
    await l.setFreezing(frozen, FROZEN);

    const results = await l.upgradeArchive(false);
    expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
    expect(errOf(byId(results, frozen))).toContain(frozen.toText());
    expect(byId(results, healthy).result).toEqual({ Ok: null });
    expect(await l.upgradeError()).toBe(errOf(byId(results, frozen)));

    // Not complete: the same call runs again, without the override.
    const again = await l.upgradeArchive(false);
    expect(errOf(byId(again, frozen))).toContain(frozen.toText());
    expect(byId(again, healthy).result).toEqual({ Ok: null });
  });

  it('every failure of the run is in the error, joined with "; "', async () => {
    for (const a of archives) await l.setFreezing(a, FROZEN);
    const results = await l.upgradeArchive(false);
    for (const r of results) expect(errOf(r), r.canister_id.toText()).toContain(r.canister_id.toText());
    const error = await l.upgradeError();
    expect(error).toBe(results.map((r) => errOf(r)).join('; '));
    for (const a of archives) expect(error).toContain(a.toText());
  });

  it('a later success clears the error and completes the upgrade', async () => {
    for (const a of archives) await l.setFreezing(a, DEFAULT_FREEZING_THRESHOLD);
    const results = await l.upgradeArchive(false);
    expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
    for (const r of results) expect(r.result, r.canister_id.toText()).toEqual({ Ok: null });
    expect(await l.upgradeError()).toBe('');

    await expect(l.upgradeArchive(false)).rejects.toThrow(/Upgrade already complete/);
    // The override still runs, so nothing was left in flight.
    const forced = await l.upgradeArchive(true);
    for (const r of forced) expect(r.result).toEqual({ Ok: null });
  });

  it('a refused call leaves the error of the last run', async () => {
    await l.setFreezing(archives[0], FROZEN);
    await l.upgradeArchive(true);
    const error = await l.upgradeError();
    expect(error).toContain(archives[0].toText());
    await expect(l.send('upgradeArchive', enc([IDL.Bool], [true]), l.alice)).rejects.toThrow();
    expect(await l.upgradeError()).toBe(error);
    await l.setFreezing(archives[0], DEFAULT_FREEZING_THRESHOLD);
  });

  it('a second call while one is in flight is refused, and the first one reports', async () => {
    const caller = await pic.createCanister({ sender: l.owner });
    await pic.addCycles(caller, 10_000_000_000_000n);
    await pic.installCode({ canisterId: caller, wasm: readFileSync(TWICE_CALLER_WASM), arg: none, sender: l.owner });
    await l.send('admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[caller]]));
    await pic.updateCall({ canisterId: caller, method: 'accept', arg: enc([IDL.Principal], [l.id]), sender: l.owner });

    const reply = await pic.updateCall({
      canisterId: caller, method: 'upgradeTwice', arg: enc([IDL.Principal, IDL.Bool], [l.id, true]), sender: l.owner,
    });
    const [first, second] = IDL.decode([IDL.Vec(IDL.Text)], reply)[0] as unknown as string[];
    expect(first).toBe(`ok ${archives.length}`);
    expect(second).toMatch(/^err .*Upgrade already in progress/);

    // Released: a later call runs.
    const again = await pic.updateCall({
      canisterId: caller, method: 'upgradeTwice', arg: enc([IDL.Principal, IDL.Bool], [l.id, true]), sender: l.owner,
    });
    expect((IDL.decode([IDL.Vec(IDL.Text)], again)[0] as unknown as string[])[0]).toBe(`ok ${archives.length}`);
  });
});

describe('upgradeArchive with no archive', () => {
  it('answers [] and completes', async () => {
    const pic = await newPic();
    try {
      const l = await Ledger.empty(pic);
      await l.install(TOKEN_WASM, tokenArgs([Ledger.configured]));
      expect(await l.upgradeArchive(false)).toEqual([]);
      expect(await l.upgradeError()).toBe('');
      await expect(l.upgradeArchive(false)).rejects.toThrow(/Upgrade already complete/);
    } finally {
      await pic.tearDown();
    }
  });
});

describe('a release in finally survives a trap in the callback (the pattern of upgradeArchive)', () => {
  it('the flag is released by finally, and stays set without it', async () => {
    const pic = await newPic();
    try {
      const id = await pic.createCanister();
      await pic.addCycles(id, 10_000_000_000_000n);
      await pic.installCode({ canisterId: id, wasm: readFileSync(FINALLY_PROBE_WASM), arg: none });
      const call = (method: string) => pic.updateCall({ canisterId: id, method, arg: none });
      const busy = async () => IDL.decode([IDL.Bool], await pic.queryCall({ canisterId: id, method: 'busy', arg: none }))[0];

      await expect(call('withFinally')).rejects.toThrow(/trap in the callback/);
      expect(await busy()).toBe(false);
      await expect(call('withFinally')).rejects.toThrow(/trap in the callback/);

      // Control: the same trap without `finally` leaves the flag set.
      await expect(call('withoutFinally')).rejects.toThrow(/trap in the callback/);
      expect(await busy()).toBe(true);
      await expect(call('withFinally')).rejects.toThrow(/already in progress/);
    } finally {
      await pic.tearDown();
    }
  });
});

// =============== The controller limit ===============

describe('the archive controller set fits the IC limit of 10 controllers', () => {
  const principals = (n: number, from = 20) => Array.from({ length: n }, (_, i) => createIdentity(from + i).getPrincipal());

  it('an install with 8 configured principals writes 10 controllers to its archive', async () => {
    const pic = await newPic();
    try {
      const l = await Ledger.empty(pic);
      const eight = [Ledger.configured, ...principals(7)];
      await l.install(TOKEN_WASM, tokenArgs(eight));
      const [archive] = await l.growArchives(1);
      const want = sorted([...eight, l.id, l.owner]);
      expect(want.length).toBe(10);
      // Written when the archive was created.
      expect(await l.controllersOf(archive)).toEqual(want);
      const results = await l.updateArchiveControllers();
      for (const r of results) expect(sorted((r.result as { Ok: Principal[] }).Ok)).toEqual(want);
      expect(await l.controllersOf(archive)).toEqual(want);
    } finally {
      await pic.tearDown();
    }
  }, 600_000);

  it('an install with 9 configured principals traps and installs nothing', async () => {
    const pic = await newPic();
    try {
      const l = await Ledger.empty(pic);
      await expect(l.install(TOKEN_WASM, tokenArgs(principals(9)))).rejects.toThrow(/IC limit of 10 controllers/);
      await expect(pic.queryCall({ canisterId: l.id, method: 'icrc1_name', arg: none })).rejects.toThrow();
    } finally {
      await pic.tearDown();
    }
  });

  it('the ledger itself and a repeated principal do not count', async () => {
    const pic = await newPic();
    try {
      const l = await Ledger.empty(pic);
      const eight = principals(8);
      await l.install(TOKEN_WASM, tokenArgs([l.id, ...eight, eight[0]]));
      expect(IDL.decode([IDL.Text], await pic.queryCall({ canisterId: l.id, method: 'icrc1_name', arg: none }))[0]).toBeTypeOf('string');
    } finally {
      await pic.tearDown();
    }
  });

  it('a ledger past the limit upgrades in place, and update_archive_controllers reports it without sending it', async () => {
    const pic = await newPic();
    try {
      const l = await Ledger.empty(pic);
      const nine = [Ledger.configured, ...principals(8)];
      await l.install(PRE_LIMIT_WASM, tokenArgs(nine));
      await l.growArchives(1);
      const archives = await l.archives();
      // The library's fire-and-forget: 11 controllers are refused, in silence,
      // and each archive keeps the ledger alone.
      for (const a of archives) expect(await l.controllersOf(a), a.toText()).toEqual(sorted([l.id]));

      // The stored list is not checked on upgrade, even with the same args.
      await l.upgrade(TOKEN_WASM, tokenArgs(nine));
      await l.upgrade(TOKEN_WASM, enc([TokenInitArgs], [[]]));

      const results = await l.updateArchiveControllers();
      expect(sorted(results.map((r) => r.canister_id))).toEqual(sorted(archives));
      for (const r of results) {
        expect('Err' in r.result, r.canister_id.toText()).toBe(true);
        expect((r.result as { Err: string }).Err).toMatch(LIMIT);
        expect((r.result as { Err: string }).Err).toMatch(/^11 controllers/);
      }
      for (const a of archives) expect(await l.controllersOf(a), a.toText()).toEqual(sorted([l.id]));
    } finally {
      await pic.tearDown();
    }
  }, 600_000);
});
