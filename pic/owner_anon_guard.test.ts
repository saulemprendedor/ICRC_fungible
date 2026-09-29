/**
 * The anonymous caller is refused by every owner-gated method, whatever
 * `owner` holds (src/Token.mo and src/token-mixin.mo).
 *
 * `owner` starts as whoever installed the ledger, so a ledger installed by the
 * anonymous principal has an anonymous `owner`. While `owner` is authenticated,
 * `caller == owner` already refuses the anonymous principal and the anonymous
 * check cannot be observed; these tests therefore install the ledger AS the
 * anonymous principal and send every owner method from it.
 *
 * Where the refusal comes from:
 *  - `Token.mo` has an ingress filter, so an anonymous update is refused by
 *    `inspect`. The anonymous principal can only send ingress, and an update
 *    method cannot be sent as a query, so the body of an update is reachable
 *    by the anonymous caller only when the filter lets it through. The body is
 *    proven by the state checks below, which hold whoever refuses: with the
 *    filter's arm opened, the body must still refuse and nothing may change.
 *  - `getUpgradeError` is a query, and `inspect` never runs for a query: the
 *    body answers.
 *  - `token-mixin.mo` has no filter: every refusal is its body's.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const RAW_CALLER_WASM = wasmPath('RAW_CALLER_WASM', 'raw_caller');

const REFUSED = /inspect_message|canister_inspect_message/i;
const UNAUTHORIZED = /Unauthorized|not authorized/;
const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MintArgs = IDL.Record({
  to: Account,
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const SetFeeCollectorArgs = IDL.Record({ fee_collector: IDL.Opt(Account), created_at_time: IDL.Nat64 });
const SetFeeCollectorResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: IDL.Variant({
    AccessDenied: IDL.Text,
    InvalidAccount: IDL.Text,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  }),
});
const GetFeeCollectorResult = IDL.Variant({
  Ok: IDL.Opt(Account),
  Err: IDL.Variant({ GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }),
});
const Icrc106GetResult = IDL.Variant({
  Ok: IDL.Principal,
  Err: IDL.Variant({
    GenericError: IDL.Record({ description: IDL.Text, error_code: IDL.Nat }),
    IndexPrincipalNotSet: IDL.Null,
  }),
});
const Icrc1InfoRequest = IDL.Variant({ Logo: IDL.Text, Name: IDL.Text, Symbol: IDL.Text, MaxMemo: IDL.Nat });
const Icrc2InfoRequest = IDL.Variant({ MaxApprovals: IDL.Nat });
const Icrc4InfoRequest = IDL.Variant({ MaxBalances: IDL.Nat, MaxTransfers: IDL.Nat });

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
  /** Whether the actor exposes the archive administration methods. */
  archives: boolean;
  installArg: Uint8Array;
}

const sections = { icrc1: IDL.Opt(IDL.Null), icrc2: IDL.Opt(IDL.Null), icrc4: IDL.Opt(IDL.Null) };
const VARIANTS: Variant[] = [
  {
    name: 'Token.mo',
    wasm: wasmPath('TOKEN_WASM', 'token'),
    filtered: true,
    archives: true,
    installArg: enc([IDL.Opt(IDL.Record({ ...sections, icrc3: IDL.Opt(ICRC3InitArgs) }))], [[]]),
  },
  {
    name: 'token-mixin.mo',
    wasm: wasmPath('TOKEN_MIXIN_WASM', 'token-mixin'),
    filtered: false,
    archives: false,
    // The mixin's `icrc3` section is not optional.
    installArg: enc(
      [IDL.Opt(IDL.Record({ ...sections, icrc3: ICRC3InitArgs }))],
      [[{ icrc1: [], icrc2: [], icrc3: ICRC3_ARGS, icrc4: [] }]],
    ),
  },
];

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

class Ledger {
  readonly anonymous = Principal.anonymous();
  readonly authenticated = createIdentity(1).getPrincipal(); // installs the authenticated ledger
  readonly controller = createIdentity(2).getPrincipal(); // a controller that is not the owner
  readonly stranger = createIdentity(3).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();

  private constructor(readonly pic: PocketIc, readonly id: Principal, readonly variant: Variant, readonly installer: Principal) {}

  /** A ledger installed by `installer`, which is then its owner and one of its two controllers. */
  static async create(variant: Variant, installer: Principal): Promise<Ledger> {
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    const controller = createIdentity(2).getPrincipal();
    const id = await pic.createCanister({ sender: installer, controllers: [installer, controller] });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({ canisterId: id, wasm: readFileSync(variant.wasm), arg: variant.installArg, sender: installer });
    await pic.tick(3);
    return new Ledger(pic, id, variant, installer);
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  query = (method: string, arg: Uint8Array = none, sender: Principal = this.anonymous) =>
    this.pic.queryCall({ canisterId: this.id, method, arg, sender });

  balance = async () => BigInt(await this.pic.getCyclesBalance(this.id));

  nowNanos = async () => BigInt(await this.pic.getTime()) * 1_000_000n;

  /**
   * Every owner-gated update of this variant, each with an argument that
   * changes something `state()` reads back, so a refusal that still ran the
   * method is caught. `getUpgradeError` and `admin_init` are tested apart.
   */
  async ownerUpdates(): Promise<Array<[string, Uint8Array]>> {
    const methods: Array<[string, Uint8Array]> = [
      ['mint', enc([MintArgs], [{ to: { owner: this.alice, subaccount: [] }, amount: 5n, memo: [], created_at_time: [] }])],
      ['admin_update_icrc1', enc([IDL.Vec(Icrc1InfoRequest)], [[{ Name: 'Renamed' }]])],
      ['admin_update_icrc2', enc([IDL.Vec(Icrc2InfoRequest)], [[{ MaxApprovals: 7n }]])],
      ['admin_update_icrc4', enc([IDL.Vec(Icrc4InfoRequest)], [[{ MaxTransfers: 7n }]])],
      ['admin_set_index_canister', enc([IDL.Opt(IDL.Principal)], [[this.alice]])],
      ['set_icrc106_index_principal', enc([IDL.Opt(IDL.Principal)], [[this.alice]])],
      ['icrc107_set_fee_collector', enc([SetFeeCollectorArgs], [{
        fee_collector: [{ owner: this.alice, subaccount: [] }],
        created_at_time: await this.nowNanos(),
      }])],
    ];
    if (this.variant.archives) {
      // With no archive yet they change nothing, but they must still be refused.
      methods.push(['upgradeArchive', enc([IDL.Bool], [true])]);
      methods.push(['update_archive_controllers', none]);
    }
    return methods;
  }

  /** What the owner methods above would change. */
  async state() {
    const dec = <T>(t: IDL.Type, b: Uint8Array) => IDL.decode([t], b)[0] as T;
    return {
      owner: dec<Principal>(IDL.Principal, await this.query('get_owner')).toText(),
      pending: dec<Principal[]>(IDL.Opt(IDL.Principal), await this.query('get_pending_owner')).map(String),
      supply: dec<bigint>(IDL.Nat, await this.query('icrc1_total_supply')),
      name: dec<string>(IDL.Text, await this.query('icrc1_name')),
      maxUpdateBatch: dec<bigint[]>(IDL.Opt(IDL.Nat), await this.query('icrc4_maximum_update_batch_size')),
      indexCanister: dec<Principal[]>(IDL.Opt(IDL.Principal), await this.query('get_index_canister')).map(String),
      icrc106: JSON.stringify(dec(Icrc106GetResult, await this.query('icrc106_get_index_principal')), (_, v) =>
        typeof v === 'bigint' ? v.toString() : v instanceof Principal ? v.toText() : v),
      feeCollector: JSON.stringify(dec(GetFeeCollectorResult, await this.query('icrc107_get_fee_collector')), (_, v) =>
        typeof v === 'bigint' ? v.toString() : v instanceof Principal ? v.toText() : v),
    };
  }

  async installRawCaller(): Promise<Principal> {
    const id = await this.pic.createCanister({ sender: this.controller });
    await this.pic.addCycles(id, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: id, wasm: readFileSync(RAW_CALLER_WASM), arg: none, sender: this.controller });
    return id;
  }

  /**
   * `method` of the ledger called by the canister `rawId`: no ingress filter
   * runs. Answers the ledger's own reply, unwrapped from the caller's `blob`.
   */
  via = async (rawId: Principal, method: string, arg: Uint8Array): Promise<Uint8Array> => {
    const reply = await this.pic.updateCall({
      canisterId: rawId,
      method: 'call',
      sender: this.controller,
      arg: IDL.encode([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [this.id, method, arg]),
    });
    return new Uint8Array(IDL.decode([IDL.Vec(IDL.Nat8)], reply)[0] as number[]);
  };
}

/** The error of a call that must fail, or null when it succeeded. */
const failureOf = (call: Promise<unknown>) => call.then(() => null, (e: Error) => e);

const ANY_REFUSAL = new RegExp(`${REFUSED.source}|${UNAUTHORIZED.source}`, 'i');

/**
 * Asserts that an owner method refused its caller: a refusal at ingress, a
 * trap of the body, or, for `icrc107_set_fee_collector`, the body's typed
 * `#Err(#AccessDenied)`. The call is sent once.
 */
async function expectOwnerRefusal(method: string, call: Promise<Uint8Array>, expected: RegExp, why: string) {
  const outcome = await call.then((reply) => ({ reply, error: null as Error | null }), (error: Error) => ({ reply: null, error }));
  if (method === 'icrc107_set_fee_collector' && outcome.error === null) {
    expect(IDL.decode([SetFeeCollectorResult], outcome.reply!)[0], why).toHaveProperty('Err.AccessDenied');
    return;
  }
  expect(outcome.error, why).not.toBeNull();
  expect(outcome.error!.message, why).toMatch(expected);
}

for (const variant of VARIANTS) {
  describe(`anonymous owner, ${variant.name}`, () => {
    let l: Ledger;
    beforeEach(async () => { l = await Ledger.create(variant, Principal.anonymous()); }, 120_000);
    afterEach(async () => { await l.tearDown(); });

    it('a ledger installed by the anonymous principal has the anonymous principal as its owner', async () => {
      expect((await l.state()).owner).toBe('2vxsx-fae');
    });

    // The security property, whoever enforces it: nothing the owner methods
    // would change has changed. With the filter's arm opened this still holds
    // on Token.mo, because the body refuses too.
    it('no owner method runs for the anonymous principal, and nothing changes', async () => {
      const before = await l.state();
      for (const [method, arg] of await l.ownerUpdates()) {
        await expectOwnerRefusal(method, l.send(method, arg, l.anonymous), variant.filtered ? ANY_REFUSAL : UNAUTHORIZED,
          `${method} from the anonymous owner`);
      }
      expect(await l.state(), 'after every refused owner method').toEqual(before);
    });

    // Any refusal will do here, so that with the filter's arm opened the body
    // still has to refuse; the filter's own refusal is pinned below.
    it('admin_init is refused to the anonymous principal although it is a controller', async () => {
      const failure = await failureOf(l.send('admin_init', none, l.anonymous));
      expect(failure).not.toBeNull();
      expect(failure!.message).toMatch(variant.filtered ? new RegExp(`${REFUSED.source}|unauthorized`, 'i') : UNAUTHORIZED);
    });

    it('a controller that is not anonymous still runs admin_init', async () => {
      await expect(l.send('admin_init', none, l.controller)).resolves.toBeDefined();
    });

    if (variant.filtered) {
      it('the filter refuses every owner method from the anonymous principal, at no cost to the ledger', async () => {
        const methods: Array<[string, Uint8Array]> = [...await l.ownerUpdates(), ['getUpgradeError', none], ['admin_init', none]];
        for (const [method, arg] of methods) {
          let failure: Error | null = null;
          const spent = await (async () => {
            const before = await l.balance();
            failure = await failureOf(l.send(method, arg, l.anonymous));
            return before - (await l.balance());
          })();
          expect(failure, method).not.toBeNull();
          expect(failure!.message, method).toMatch(REFUSED);
          expect(spent, `cycles spent on ${method}`).toBeLessThan(1_000_000n);
        }
      });

      it('a ~110 KB logo from the anonymous owner is refused at ingress', async () => {
        const logo = enc([IDL.Vec(Icrc1InfoRequest)], [[{ Logo: 'data:image/png;base64,' + 'A'.repeat(110_000) }]]);
        await expect(l.send('admin_update_icrc1', logo, l.anonymous)).rejects.toThrow(REFUSED);
      });
    }

    if (variant.archives) {
      it('getUpgradeError sent as a query, where no filter runs, is refused by the body', async () => {
        const failure = await failureOf(l.query('getUpgradeError', none, l.anonymous));
        expect(failure).not.toBeNull();
        expect(failure!.message).not.toMatch(REFUSED);
        expect(failure!.message).toMatch(UNAUTHORIZED);
      });
    }
  });

  describe(`authenticated owner, ${variant.name}`, () => {
    let l: Ledger;
    beforeEach(async () => { l = await Ledger.create(variant, createIdentity(1).getPrincipal()); }, 120_000);
    afterEach(async () => { await l.tearDown(); });

    it('the owner still runs every owner method', async () => {
      for (const [method, arg] of await l.ownerUpdates()) {
        const reply = await l.send(method, arg, l.authenticated);
        if (method === 'icrc107_set_fee_collector') {
          expect(IDL.decode([SetFeeCollectorResult], reply)[0], method).toHaveProperty('Ok');
        }
      }
      const after = await l.state();
      expect(after.supply).toBe(5n);
      expect(after.name).toBe('Renamed');
      expect(after.maxUpdateBatch).toEqual([7n]);
      expect(after.indexCanister).toEqual([l.alice.toText()]);
      expect(after.icrc106).toContain(l.alice.toText());
      expect(after.feeCollector).toContain(l.alice.toText());
      if (variant.archives) await expect(l.query('getUpgradeError', none, l.authenticated)).resolves.toBeDefined();
      await expect(l.send('admin_init', none, l.authenticated)).resolves.toBeDefined();
    });

    it('a stranger and a caller canister are refused as before, and nothing changes', async () => {
      const before = await l.state();
      const raw = await l.installRawCaller();
      for (const [method, arg] of await l.ownerUpdates()) {
        await expectOwnerRefusal(method, l.send(method, arg, l.stranger), variant.filtered ? REFUSED : UNAUTHORIZED, `${method}, stranger`);
        await expectOwnerRefusal(method, l.via(raw, method, arg), UNAUTHORIZED, `${method}, caller canister`);
      }
      expect(await l.state()).toEqual(before);
    });

    it('admin_init runs for the owner and a controller, and is refused to a stranger', async () => {
      await expect(l.send('admin_init', none, l.authenticated)).resolves.toBeDefined();
      await expect(l.send('admin_init', none, l.controller)).resolves.toBeDefined();
      const failure = await failureOf(l.send('admin_init', none, l.stranger));
      expect(failure).not.toBeNull();
      expect(failure!.message).toMatch(variant.filtered ? REFUSED : UNAUTHORIZED);
    });
  });
}

// ---- A new archive of a ledger whose owner is anonymous ----

const TransferArgs = IDL.Record({
  to: Account,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});
const ArchiveInfo = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat });
const GetArchivesArgs = IDL.Record({ from: IDL.Opt(IDL.Principal) });

describe('anonymous owner, Token.mo: a new archive', () => {
  // Small limits, so a few dozen blocks spin off an archive (as in archive_owner.test.ts).
  const ARCHIVE_LIMITS = {
    maxActiveRecords: 10n,
    settleToRecords: 5n,
    maxRecordsInArchiveInstance: 15n,
    maxArchivePages: 62_500n,
    archiveIndexType: { Stable: null },
    maxRecordsToArchive: 10n,
    archiveCycles: 2_000_000_000_000n,
    supportedBlocks: [],
  };

  it('does not get the anonymous owner as a controller', async () => {
    const configured = createIdentity(6).getPrincipal();
    const variant: Variant = {
      ...VARIANTS[0],
      installArg: enc([IDL.Opt(IDL.Record({ ...sections, icrc3: IDL.Opt(ICRC3InitArgs) }))],
        [[{ icrc1: [], icrc2: [], icrc4: [], icrc3: [{ ...ARCHIVE_LIMITS, archiveControllers: [[[configured]]] }] }]]),
    };
    const l = await Ledger.create(variant, Principal.anonymous());
    try {
      expect((await l.state()).owner).toBe('2vxsx-fae');
      // `mint` refuses the anonymous owner, but the anonymous principal is also the
      // default minting account, and a transfer from it is a mint (CHANGELOG: what
      // the guard leaves open). That is what fills the log here.
      for (let i = 0; i < 40; i++) {
        await l.send('icrc1_transfer', enc([TransferArgs], [{
          to: { owner: l.alice, subaccount: [] }, fee: [], memo: [], from_subaccount: [],
          created_at_time: [], amount: 1_000_000n + BigInt(i),
        }]), l.anonymous);
      }
      let archives: Principal[] = [];
      for (let round = 0; round < 30 && archives.length === 0; round++) {
        await l.pic.advanceTime(10_000);
        await l.pic.tick(5);
        const reply = await l.query('icrc3_get_archives', enc([GetArchivesArgs], [{ from: [] }]));
        archives = (IDL.decode([IDL.Vec(ArchiveInfo)], reply)[0] as unknown as { canister_id: Principal }[])
          .map((a) => a.canister_id).filter((p) => p.toText() !== l.id.toText());
      }
      expect(archives.length, 'archives created').toBeGreaterThan(0);
      for (const a of archives) {
        const controllers = (await l.pic.getControllers(a)).map((p) => p.toText()).sort();
        expect(controllers, a.toText()).toEqual([configured.toText(), l.id.toText()].sort());
      }
    } finally {
      await l.tearDown();
    }
  });
});
