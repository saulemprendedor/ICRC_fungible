/**
 * The ledger refuses the anonymous principal where it would take root
 * (src/Token.mo and src/token-mixin.mo):
 *
 *  - at INSTALL, as the installer: the installer is the first owner, and it
 *    is a controller;
 *  - at INSTALL, as the owner of the minting account, the one of the init args
 *    or the default, `{ owner = installer }`: a transfer from the minting
 *    account is a mint, so anyone could mint;
 *  - in `admin_update_icrc1`, as the owner of a `MintingAccount`.
 *
 * An UPGRADE of a working ledger is never refused. The class parameter that
 * holds the installer is bound again to whoever sends each upgrade, and such
 * an upgrade does not apply its init args. The ledgers upgraded here are the
 * build from before the refusal (`token_pre_refusal`,
 * `token_mixin_pre_refusal`), which is also the only way left to a ledger
 * whose owner is anonymous.
 *
 * One upgrade does apply its init args: `token-mixin.mo` builds its ICRC-1
 * state on the first use after the install, so an upgrade that comes before
 * that (here, of a ledger installed while stopped) is where the minting
 * account is applied, and where it is checked.
 *
 * A refused install installs nothing: the module hash is read from the
 * management canister, not inferred from the failed call.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const RAW_CALLER_WASM = wasmPath('RAW_CALLER_WASM', 'raw_caller');

const REFUSED = /inspect_message|canister_inspect_message/i;
const ANONYMOUS_INSTALLER = /The anonymous principal cannot install the ledger/;
const ANONYMOUS_MINTER = /The anonymous principal cannot be the owner of the minting account/;
const KEEP = { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] } as const;

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
type AccountT = { owner: Principal; subaccount: [] | [Uint8Array] };
const acct = (owner: Principal): AccountT => ({ owner, subaccount: [] });
const SUBACCOUNT = new Uint8Array(32).fill(7);
const sub = (owner: Principal): AccountT => ({ owner, subaccount: [SUBACCOUNT] });
const show = (a: AccountT) => `${a.owner.toText()}${a.subaccount.length ? '+sub' : ''}`;

const MintArgs = IDL.Record({
  to: Account,
  amount: IDL.Nat,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
// A subset of ICRC1.UpdateLedgerInfoRequest: a variant encodes into a wider one.
const InfoRequest = IDL.Variant({ Name: IDL.Text, MintingAccount: Account });
type Req = { Name: string } | { MintingAccount: AccountT };
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

/** What the init args say about the minting account. */
type Minting = 'no args' | 'no account' | AccountT;

interface Variant {
  name: string;
  wasm: string;
  /** The same actor before it refused the anonymous principal. */
  preRefusalWasm: string;
  /** Whether the actor has an ingress filter. */
  filtered: boolean;
  /** Whether the actor's `icrc3` section is optional. */
  icrc3Optional: boolean;
}

const VARIANTS: Variant[] = [
  {
    name: 'Token.mo',
    wasm: wasmPath('TOKEN_WASM', 'token'),
    preRefusalWasm: wasmPath('TOKEN_PRE_REFUSAL_WASM', 'token_pre_refusal'),
    filtered: true,
    icrc3Optional: true,
  },
  {
    name: 'token-mixin.mo',
    wasm: wasmPath('TOKEN_MIXIN_WASM', 'token-mixin'),
    preRefusalWasm: wasmPath('TOKEN_MIXIN_PRE_REFUSAL_WASM', 'token_mixin_pre_refusal'),
    filtered: false,
    icrc3Optional: false,
  },
];

function initArgs(variant: Variant, minting: Minting): Uint8Array {
  const icrc3Type = variant.icrc3Optional ? IDL.Opt(ICRC3InitArgs) : ICRC3InitArgs;
  const type = IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(ICRC1InitArgs),
    icrc2: IDL.Opt(IDL.Null),
    icrc3: icrc3Type,
    icrc4: IDL.Opt(IDL.Null),
  }));
  if (minting === 'no args') return enc([type], [[]]);
  const icrc1 = {
    name: ['Probe'], symbol: ['PRB'], decimals: 8, fee: [{ Fixed: 10_000n }],
    minting_account: minting === 'no account' ? [] : [minting],
  };
  return enc([type], [[{ icrc1: [icrc1], icrc2: [], icrc3: variant.icrc3Optional ? [ICRC3_ARGS] : ICRC3_ARGS, icrc4: [] }]]);
}

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

const failureOf = (call: Promise<unknown>) => call.then(() => null, (e: Error) => e);

class Bench {
  readonly anonymous = Principal.anonymous();
  readonly a = createIdentity(1).getPrincipal();
  readonly b = createIdentity(2).getPrincipal();
  readonly alice = createIdentity(5).getPrincipal();

  private constructor(readonly pic: PocketIc, readonly variant: Variant) {}

  static async create(variant: Variant): Promise<Bench> {
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    return new Bench(pic, variant);
  }

  tearDown = () => this.pic.tearDown();

  /** An empty canister controlled by `a`, `b` and the anonymous principal. */
  async emptyCanister(): Promise<Principal> {
    const id = await this.pic.createCanister({ sender: this.a, controllers: [this.a, this.b, this.anonymous] });
    await this.pic.addCycles(id, 100_000_000_000_000n);
    return id;
  }

  // The rounds after each call keep the next install of the same canister
  // under the subnet's install rate limit.
  install = async (id: Principal, sender: Principal, minting: Minting, wasm = this.variant.wasm) => {
    try {
      await this.pic.installCode({ canisterId: id, wasm: readFileSync(wasm), arg: initArgs(this.variant, minting), sender });
    } finally {
      await this.pic.tick(5);
    }
  };

  upgrade = async (id: Principal, sender: Principal, minting: Minting) => {
    try {
      await this.pic.upgradeCanister({
        canisterId: id, wasm: readFileSync(this.variant.wasm), arg: initArgs(this.variant, minting), sender, upgradeModeOptions: KEEP,
      });
    } finally {
      await this.pic.tick(5);
    }
  };

  /** The module hash, from the management canister: null when no code is installed. */
  async moduleHash(id: Principal): Promise<string | null> {
    const reply = await this.pic.updateCall({
      canisterId: Principal.fromText('aaaaa-aa'),
      method: 'canister_status',
      arg: enc([IDL.Record({ canister_id: IDL.Principal })], [{ canister_id: id }]),
      sender: this.a,
      targetSubnetId: (await this.pic.getCanisterSubnetId(id)) ?? undefined,
    });
    const [status] = IDL.decode([IDL.Record({ module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)) })], reply) as unknown as
      [{ module_hash: [] | [Uint8Array] }];
    return status.module_hash.length ? Buffer.from(status.module_hash[0]).toString('hex') : null;
  }

  query = (id: Principal, method: string, arg: Uint8Array = none) =>
    this.pic.queryCall({ canisterId: id, method, arg, sender: this.anonymous });
  send = (id: Principal, method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: id, method, arg, sender });

  owner = async (id: Principal) => (IDL.decode([IDL.Principal], await this.query(id, 'get_owner'))[0] as Principal).toText();
  minter = async (id: Principal) =>
    (IDL.decode([IDL.Opt(Account)], await this.query(id, 'icrc1_minting_account'))[0] as AccountT[]).map(show);
  supply = async (id: Principal) => IDL.decode([IDL.Nat], await this.query(id, 'icrc1_total_supply'))[0] as bigint;
  name = async (id: Principal) => IDL.decode([IDL.Text], await this.query(id, 'icrc1_name'))[0] as string;
  balance = async (id: Principal) => BigInt(await this.pic.getCyclesBalance(id));

  mint = (id: Principal, sender: Principal, amount: bigint) =>
    this.send(id, 'mint', enc([MintArgs], [{ to: acct(this.alice), amount, memo: [], created_at_time: [] }]), sender);

  /** A caller canister that owns the ledger `id`: what it sends passes no ingress filter. */
  async ownerCanister(id: Principal): Promise<Principal> {
    const raw = await this.pic.createCanister({ sender: this.b });
    await this.pic.addCycles(raw, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: raw, wasm: readFileSync(RAW_CALLER_WASM), arg: none, sender: this.b });
    await this.send(id, 'admin_propose_owner', enc([IDL.Opt(IDL.Principal)], [[raw]]), this.a);
    await this.via(raw, id, 'accept_ownership', none);
    expect(await this.owner(id)).toBe(raw.toText());
    return raw;
  }

  via = async (raw: Principal, id: Principal, method: string, arg: Uint8Array): Promise<Uint8Array> => {
    const reply = await this.pic.updateCall({
      canisterId: raw,
      method: 'call',
      sender: this.b,
      arg: enc([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [id, method, arg]),
    });
    return IDL.decode([IDL.Vec(IDL.Nat8)], reply)[0] as Uint8Array;
  };
}

for (const variant of VARIANTS) {
  describe(`install refusal, ${variant.name}`, () => {
    let t: Bench;
    afterEach(async () => { await t.tearDown(); });

    /** A refused install: the message, and no module left behind. */
    const expectRefusedInstall = async (sender: Principal, minting: Minting, message: RegExp, why: string) => {
      const id = await t.emptyCanister();
      const failure = await failureOf(t.install(id, sender, minting));
      expect(failure, why).not.toBeNull();
      expect(failure!.message, why).toMatch(message);
      expect(await t.moduleHash(id), `${why}: the module`).toBeNull();
    };

    it('the control: the module hash is read, and is there after an install', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      expect(await t.moduleHash(id)).toBeNull();
      await t.install(id, t.a, 'no args');
      expect(await t.moduleHash(id)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the anonymous principal cannot install, with the default minting account', async () => {
      t = await Bench.create(variant);
      await expectRefusedInstall(t.anonymous, 'no args', ANONYMOUS_INSTALLER, 'no init args');
      await expectRefusedInstall(t.anonymous, 'no account', ANONYMOUS_INSTALLER, 'init args with no minting account');
    });

    it('the anonymous principal cannot install, even with an authenticated minting account', async () => {
      t = await Bench.create(variant);
      await expectRefusedInstall(t.anonymous, acct(t.a), ANONYMOUS_INSTALLER, 'an authenticated minting account');
    });

    it('a minting account owned by the anonymous principal is refused', async () => {
      t = await Bench.create(variant);
      await expectRefusedInstall(t.a, acct(t.anonymous), ANONYMOUS_MINTER, 'no subaccount');
    });

    it('a subaccount of the anonymous principal is refused as a minting account', async () => {
      t = await Bench.create(variant);
      await expectRefusedInstall(t.a, sub(t.anonymous), ANONYMOUS_MINTER, 'a subaccount');
    });

    it('an ordinary install is unchanged', async () => {
      t = await Bench.create(variant);
      const cases: Array<[string, (id: Principal) => Minting, (id: Principal) => string]> = [
        ['no init args', () => 'no args', () => t.a.toText()],
        ['no minting account', () => 'no account', () => t.a.toText()],
        ['an authenticated minting account', () => acct(t.b), () => t.b.toText()],
        ['a subaccount of an authenticated principal', () => sub(t.b), () => `${t.b.toText()}+sub`],
        ['the ledger itself', (id) => acct(id), (id) => id.toText()],
      ];
      for (const [why, minting, minter] of cases) {
        const id = await t.emptyCanister();
        await t.install(id, t.a, minting(id));
        expect(await t.owner(id), why).toBe(t.a.toText());
        expect(await t.minter(id), why).toEqual([minter(id)]);
      }
    });

    it('a reinstall by the anonymous principal is refused and keeps the ledger', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.a, 'no args');
      await t.mint(id, t.a, 1_000n);
      const hash = await t.moduleHash(id);
      const failure = await failureOf(t.pic.reinstallCode({
        canisterId: id, wasm: readFileSync(variant.wasm), arg: initArgs(variant, 'no args'), sender: t.anonymous,
      }));
      expect(failure).not.toBeNull();
      expect(failure!.message).toMatch(ANONYMOUS_INSTALLER);
      expect(await t.moduleHash(id)).toBe(hash);
      expect(await t.owner(id)).toBe(t.a.toText());
      expect(await t.supply(id)).toBe(1_000n);
    });
  });

  describe(`an upgrade never runs the install check, ${variant.name}`, () => {
    let t: Bench;
    afterEach(async () => { await t.tearDown(); });

    it('a ledger installed by one principal is upgraded by another', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.a, 'no args', variant.preRefusalWasm);
      await t.mint(id, t.a, 1_000n);
      const before = await t.moduleHash(id);
      await t.upgrade(id, t.b, 'no args');
      expect(await t.moduleHash(id), 'the module after the upgrade').not.toBe(before);
      expect(await t.owner(id)).toBe(t.a.toText());
      expect(await t.minter(id)).toEqual([t.a.toText()]);
      expect(await t.supply(id)).toBe(1_000n);
      // Init args that an install would refuse: the upgrade does not apply
      // them, so it is not refused for them and the account stays.
      await t.upgrade(id, t.b, acct(t.anonymous));
      expect(await t.owner(id), 'after the second upgrade').toBe(t.a.toText());
      expect(await t.minter(id), 'after the second upgrade').toEqual([t.a.toText()]);
      expect(await t.supply(id), 'after the second upgrade').toBe(1_000n);
    });

    it('a ledger whose owner is anonymous is upgraded, whoever sends it and whatever its args', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.anonymous, 'no args', variant.preRefusalWasm);
      const preRefusal = await t.moduleHash(id);
      const upgrades: Array<[string, Principal, Minting]> = [
        ['an authenticated controller', t.b, 'no args'],
        ['the anonymous controller', t.anonymous, 'no args'],
        ['an authenticated controller, with an anonymous minting account in its args', t.b, acct(t.anonymous)],
      ];
      // The hash of the current build, read from a ledger installed with it.
      // Only the first upgrade changes the module, so for the others the hash
      // says which build is installed, and it is the call not being rejected
      // that says the upgrade was not refused.
      const probe = await t.emptyCanister();
      await t.install(probe, t.a, 'no args');
      const current = await t.moduleHash(probe);
      expect(current, 'the current build').not.toBe(preRefusal);
      for (const [why, sender, minting] of upgrades) {
        await expect(t.upgrade(id, sender, minting), why).resolves.toBeUndefined();
        expect(await t.moduleHash(id), why).toBe(current);
        expect(await t.owner(id), why).toBe('2vxsx-fae');
        expect(await t.minter(id), why).toEqual(['2vxsx-fae']);
      }
    });
  });

  if (!variant.filtered) {
    describe(`the minting account is checked where it is applied, ${variant.name}`, () => {
      let t: Bench;
      afterEach(async () => { await t.tearDown(); });

      // A stopped canister runs no timer and takes no call, so its ICRC-1
      // state is not built until it is started.
      const installedWhileStopped = async () => {
        const id = await t.emptyCanister();
        await t.pic.stopCanister({ canisterId: id, sender: t.a });
        await t.install(id, t.a, 'no args');
        return id;
      };
      const start = async (id: Principal) => {
        await t.pic.startCanister({ canisterId: id, sender: t.a });
        await t.pic.tick(5);
      };

      it('an upgrade that comes before the state is built is refused for an anonymous account', async () => {
        t = await Bench.create(variant);
        const id = await installedWhileStopped();
        const before = await t.moduleHash(id);
        for (const account of [acct(t.anonymous), sub(t.anonymous)]) {
          const failure = await failureOf(t.upgrade(id, t.b, account));
          expect(failure, show(account)).not.toBeNull();
          expect(failure!.message, show(account)).toMatch(ANONYMOUS_MINTER);
          expect(await t.moduleHash(id), show(account)).toBe(before);
        }
        await start(id);
        expect(await t.owner(id)).toBe(t.a.toText());
        expect(await t.minter(id)).toEqual([t.a.toText()]);
      });

      it('the control: that upgrade does apply its init args', async () => {
        t = await Bench.create(variant);
        const id = await installedWhileStopped();
        await t.upgrade(id, t.b, acct(t.b));
        await start(id);
        expect(await t.owner(id)).toBe(t.a.toText());
        expect(await t.minter(id)).toEqual([t.b.toText()]);
      });
    });
  }

  describe(`admin_update_icrc1 refuses an anonymous minting account, ${variant.name}`, () => {
    let t: Bench;
    afterEach(async () => { await t.tearDown(); });

    it('the body refuses the whole batch, wherever the account sits in it', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.a, 'no args');
      const raw = await t.ownerCanister(id);
      const name = await t.name(id);
      const batches: Array<[string, Req[]]> = [
        ['alone', [{ MintingAccount: acct(t.anonymous) }]],
        ['after a rename', [{ Name: 'Renamed' }, { MintingAccount: acct(t.anonymous) }]],
        ['a subaccount, after a rename', [{ Name: 'Renamed' }, { MintingAccount: sub(t.anonymous) }]],
        ['after an authenticated account', [{ MintingAccount: acct(t.b) }, { MintingAccount: acct(t.anonymous) }]],
      ];
      for (const [why, requests] of batches) {
        const failure = await failureOf(t.via(raw, id, 'admin_update_icrc1', batch(requests)));
        expect(failure, why).not.toBeNull();
        expect(failure!.message, why).toMatch(ANONYMOUS_MINTER);
        expect(await t.minter(id), why).toEqual([t.a.toText()]);
        expect(await t.name(id), why).toBe(name);
      }
    });

    it('an authenticated minting account, and the ledger itself, are still applied', async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.a, 'no args');
      for (const account of [acct(t.b), sub(t.b), acct(id)]) {
        const reply = await t.send(id, 'admin_update_icrc1', batch([{ MintingAccount: account }]), t.a);
        expect(IDL.decode([IDL.Vec(IDL.Bool)], reply)[0]).toEqual([true]);
        expect(await t.minter(id)).toEqual([show(account)]);
      }
    });

    it(`the owner's ingress message is refused ${variant.filtered ? 'by the filter, at no cost to the ledger' : 'by the body'}`, async () => {
      t = await Bench.create(variant);
      const id = await t.emptyCanister();
      await t.install(id, t.a, 'no args');
      await t.pic.tick(3);
      const before = await t.balance(id);
      const failure = await failureOf(t.send(id, 'admin_update_icrc1',
        batch([{ Name: 'Renamed' }, { MintingAccount: acct(t.anonymous) }]), t.a));
      const spent = before - (await t.balance(id));
      expect(failure).not.toBeNull();
      expect(failure!.message).toMatch(variant.filtered ? REFUSED : ANONYMOUS_MINTER);
      if (variant.filtered) expect(spent, 'cycles spent').toBeLessThan(1_000_000n);
      expect(await t.minter(id)).toEqual([t.a.toText()]);
      expect(await t.name(id)).not.toBe('Renamed');
      // The same owner, a batch without the account: admitted and applied.
      await t.send(id, 'admin_update_icrc1', batch([{ Name: 'Renamed' }]), t.a);
      expect(await t.name(id)).toBe('Renamed');
    });
  });
}
