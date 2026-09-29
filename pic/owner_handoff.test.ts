/**
 * The owner hand-off, in two steps (src/Token.mo and src/token-mixin.mo).
 *
 * `admin_propose_owner(?p)` by the owner, then `accept_ownership()` by `p`.
 * Nothing moves until the proposed principal accepts, so a mistyped principal,
 * or one nobody holds the key of, cannot take the administration with it, and
 * the anonymous principal can never become the owner.
 *
 * The same rules are run against both actors. `Token.mo` has an ingress
 * filter and the mixin has none, so:
 *  - a refusal that the OWNER or the PENDING principal can trigger (proposing
 *    the anonymous principal, proposing itself) passes the filter and is a
 *    trap of the body: it is matched on its message and on NOT being the
 *    ingress refusal;
 *  - a refusal of anybody else is asserted twice: as ingress, where the filter
 *    or the body answers, and through a caller canister, which the filter
 *    never sees, where only the body can answer "Unauthorized".
 * State is read back with `get_owner` / `get_pending_owner` after every
 * refusal: a trap that still moved the owner would pass a weaker check.
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
const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);
const proposal = (p: Principal | null) => enc([IDL.Opt(IDL.Principal)], [p ? [p] : []]);
// A subset of ICRC1.UpdateLedgerInfoRequest: a variant decodes into a wider one.
const Icrc1InfoRequest = IDL.Variant({ Name: IDL.Text });

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
  /** The class argument for an install that takes every default. */
  installArg: Uint8Array;
}

const sections = { icrc1: IDL.Opt(IDL.Null), icrc2: IDL.Opt(IDL.Null), icrc4: IDL.Opt(IDL.Null) };
const VARIANTS: Variant[] = [
  {
    name: 'Token.mo',
    wasm: wasmPath('TOKEN_WASM', 'token'),
    filtered: true,
    installArg: enc([IDL.Opt(IDL.Record({ ...sections, icrc3: IDL.Opt(ICRC3InitArgs) }))], [[]]),
  },
  {
    name: 'token-mixin.mo',
    wasm: wasmPath('TOKEN_MIXIN_WASM', 'token-mixin'),
    filtered: false,
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
  readonly installer = createIdentity(1).getPrincipal(); // installs, so it is the first owner
  readonly controller = createIdentity(2).getPrincipal(); // a controller that is not the owner
  readonly stranger = createIdentity(3).getPrincipal();
  readonly next = createIdentity(4).getPrincipal();
  readonly other = createIdentity(5).getPrincipal();
  readonly anonymous = Principal.anonymous();

  private constructor(readonly pic: PocketIc, readonly id: Principal, readonly variant: Variant) {}

  static async create(variant: Variant, wasm = variant.wasm): Promise<Ledger> {
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    const who = new Ledger(pic, Principal.anonymous(), variant);
    const id = await pic.createCanister({ sender: who.installer, controllers: [who.installer, who.controller] });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({ canisterId: id, wasm: readFileSync(wasm), arg: variant.installArg, sender: who.installer });
    await pic.tick(3);
    return new Ledger(pic, id, variant);
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  owner = async () =>
    (IDL.decode([IDL.Principal], await this.pic.queryCall({ canisterId: this.id, method: 'get_owner', arg: none }))[0] as Principal).toText();

  /** `get_owner` called as an update: through the ingress filter, where there is one. */
  ownerByUpdate = async () =>
    (IDL.decode([IDL.Principal], await this.send('get_owner', none, this.stranger))[0] as Principal).toText();

  name = async () =>
    IDL.decode([IDL.Text], await this.pic.queryCall({ canisterId: this.id, method: 'icrc1_name', arg: none }))[0] as string;

  pending = async () => {
    const reply = await this.pic.queryCall({ canisterId: this.id, method: 'get_pending_owner', arg: none });
    const [p] = IDL.decode([IDL.Opt(IDL.Principal)], reply)[0] as Principal[];
    return p ? p.toText() : null;
  };

  /** Asserts that the owner and the pending principal are exactly these. */
  async expectState(owner: Principal, pending: Principal | null, why: string) {
    expect(await this.owner(), `owner, ${why}`).toBe(owner.toText());
    expect(await this.pending(), `pending owner, ${why}`).toBe(pending ? pending.toText() : null);
  }

  upgradeAs = async (sender: Principal, wasm = this.variant.wasm) => {
    await this.pic.upgradeCanister({
      canisterId: this.id,
      wasm: readFileSync(wasm),
      arg: this.variant.installArg,
      sender,
      upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] },
    });
    await this.pic.tick(3);
  };

  async installRawCaller(): Promise<Principal> {
    const id = await this.pic.createCanister({ sender: this.installer });
    await this.pic.addCycles(id, 10_000_000_000_000n);
    await this.pic.installCode({ canisterId: id, wasm: readFileSync(RAW_CALLER_WASM), arg: none, sender: this.installer });
    return id;
  }

  /** `method` of the ledger called by the canister `rawId`: no ingress filter runs. */
  via = (rawId: Principal, method: string, arg: Uint8Array) =>
    this.pic.updateCall({
      canisterId: rawId,
      method: 'call',
      sender: this.installer,
      arg: IDL.encode([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [this.id, method, arg]),
    });

  /**
   * An ingress call that must be refused: by the filter where there is one, by
   * the body otherwise. Either way it is a refusal of THIS caller, not a trap
   * about something else.
   */
  async expectRefused(method: string, arg: Uint8Array, sender: Principal, why: string) {
    const failure = await this.send(method, arg, sender).then(() => null, (e: Error) => e);
    expect(failure, why).not.toBeNull();
    expect(failure!.message, why).toMatch(this.variant.filtered ? REFUSED : UNAUTHORIZED);
  }

  /** A call the filter admits and the body traps on, with `message`. */
  async expectBodyTrap(call: Promise<unknown>, message: RegExp, why: string) {
    const failure = await call.then(() => null, (e: Error) => e);
    expect(failure, why).not.toBeNull();
    expect(failure!.message, why).not.toMatch(REFUSED);
    expect(failure!.message, why).toMatch(message);
  }
}

for (const variant of VARIANTS) {
  describe(`owner hand-off, ${variant.name}`, () => {
    let l: Ledger;
    beforeEach(async () => { l = await Ledger.create(variant); }, 120_000);
    afterEach(async () => { await l.tearDown(); });

    it('starts with the installer as the owner and nothing pending', async () => {
      await l.expectState(l.installer, null, 'after install');
    });

    it('moves the ownership in two steps, and a proposal alone moves nothing', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.expectState(l.installer, l.next, 'after the proposal');

      // The proposed principal holds no power yet; the owner holds all of it.
      const empty = enc([IDL.Vec(IDL.Null)], [[]]);
      await l.expectRefused('admin_update_icrc2', empty, l.next, 'the pending principal, before it accepts');
      await l.expectRefused('admin_propose_owner', proposal(l.other), l.next, 'the pending principal proposing');
      await expect(l.send('admin_update_icrc2', empty, l.installer)).resolves.toBeDefined();

      await l.send('accept_ownership', none, l.next);
      await l.expectState(l.next, null, 'after the acceptance');

      // The former owner is refused everywhere, the two hand-off methods included.
      await expect(l.send('admin_update_icrc2', empty, l.next)).resolves.toBeDefined();
      await l.expectRefused('admin_update_icrc2', empty, l.installer, 'the former owner');
      await l.expectRefused('admin_propose_owner', proposal(l.installer), l.installer, 'the former owner proposing itself back');
      await l.expectRefused('accept_ownership', none, l.installer, 'the former owner accepting');
      await l.expectState(l.next, null, 'after the former owner tried');
    });

    it('while a proposal is pending, the owner keeps admin_update_icrc1 and the proposed principal has none of it', async () => {
      const rename = (name: string) => enc([IDL.Vec(Icrc1InfoRequest)], [[{ Name: name }]]);
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      const before = await l.name();

      await l.expectRefused('admin_update_icrc1', rename('by the pending principal'), l.next, 'the pending principal, before it accepts');
      expect(await l.name(), 'after the pending principal tried').toBe(before);

      const reply = await l.send('admin_update_icrc1', rename('by the owner'), l.installer);
      expect(IDL.decode([IDL.Vec(IDL.Bool)], reply)[0]).toEqual([true]);
      expect(await l.name(), 'after the owner renamed').toBe('by the owner');

      // Past any filter: a pending principal that is a canister is trapped by the body.
      const pendingCanister = await l.installRawCaller();
      await l.send('admin_propose_owner', proposal(pendingCanister), l.installer);
      await l.expectBodyTrap(
        l.via(pendingCanister, 'admin_update_icrc1', rename('by the pending canister')), UNAUTHORIZED, 'the pending canister',
      );
      expect(await l.name(), 'after the pending canister tried').toBe('by the owner');
      await l.expectState(l.installer, pendingCanister, 'the owner did not move');
    });

    it('get_owner answers the same called as an update as it does as a query', async () => {
      const both = async (expected: Principal, why: string) => {
        expect(await l.owner(), `query, ${why}`).toBe(expected.toText());
        expect(await l.ownerByUpdate(), `update, ${why}`).toBe(expected.toText());
      };
      await both(l.installer, 'after install');
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await both(l.installer, 'with a proposal pending');
      await l.send('accept_ownership', none, l.next);
      await both(l.next, 'after the acceptance');
    });

    it('refuses the anonymous principal as a proposal', async () => {
      await l.expectBodyTrap(
        l.send('admin_propose_owner', proposal(l.anonymous), l.installer), /anonymous principal cannot be the owner/, 'nothing pending',
      );
      await l.expectState(l.installer, null, 'after proposing the anonymous principal');

      // Nor does it replace a proposal that stands.
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.expectBodyTrap(
        l.send('admin_propose_owner', proposal(l.anonymous), l.installer), /anonymous principal cannot be the owner/, 'with a proposal pending',
      );
      await l.expectState(l.installer, l.next, 'the earlier proposal stands');
      await l.expectRefused('accept_ownership', none, l.anonymous, 'the anonymous principal accepting');
      await l.expectState(l.installer, l.next, 'after the anonymous principal tried to accept');
    });

    it('refuses the owner as a proposal', async () => {
      await l.expectBodyTrap(
        l.send('admin_propose_owner', proposal(l.installer), l.installer), /already the owner/, 'nothing pending',
      );
      await l.expectState(l.installer, null, 'after the owner proposed itself');

      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.expectBodyTrap(
        l.send('admin_propose_owner', proposal(l.installer), l.installer), /already the owner/, 'with a proposal pending',
      );
      await l.expectState(l.installer, l.next, 'the earlier proposal stands');
    });

    it('lets nobody but the owner propose', async () => {
      for (const sender of [l.stranger, l.controller, l.anonymous]) {
        await l.expectRefused('admin_propose_owner', proposal(sender), sender, `${sender.toText()} proposing itself`);
        await l.expectRefused('admin_propose_owner', proposal(l.next), sender, `${sender.toText()} proposing`);
        await l.expectRefused('admin_propose_owner', proposal(null), sender, `${sender.toText()} cancelling`);
      }
      await l.expectState(l.installer, null, 'after strangers proposed');
    });

    it('lets nobody but the pending principal accept', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      for (const sender of [l.stranger, l.controller, l.anonymous, l.installer]) {
        await l.expectRefused('accept_ownership', none, sender, `${sender.toText()} accepting`);
      }
      await l.expectState(l.installer, l.next, 'after everyone else tried to accept');
    });

    it('has nothing to accept when nothing is pending', async () => {
      for (const sender of [l.stranger, l.controller, l.anonymous, l.installer, l.next]) {
        await l.expectRefused('accept_ownership', none, sender, `${sender.toText()} accepting nothing`);
      }
      await l.expectState(l.installer, null, 'after accepting nothing');
    });

    it('a cancelled proposal cannot be accepted', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.send('admin_propose_owner', proposal(null), l.installer);
      await l.expectState(l.installer, null, 'after the cancellation');
      await l.expectRefused('accept_ownership', none, l.next, 'accepting a cancelled proposal');
      await l.expectState(l.installer, null, 'after the refused acceptance');
    });

    it('a second proposal replaces the first', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.send('admin_propose_owner', proposal(l.other), l.installer);
      await l.expectState(l.installer, l.other, 'after the second proposal');
      await l.expectRefused('accept_ownership', none, l.next, 'the replaced principal accepting');
      await l.send('accept_ownership', none, l.other);
      await l.expectState(l.other, null, 'after the acceptance');
    });

    it('the acceptance clears the proposal: it cannot be replayed after a second hand-off', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.send('accept_ownership', none, l.next);
      await l.send('admin_propose_owner', proposal(l.other), l.next);
      await l.send('accept_ownership', none, l.other);
      // `next` was pending once. Were that proposal still standing, it could take the ledger back.
      await l.expectRefused('accept_ownership', none, l.next, 'a principal that was pending before');
      await l.expectState(l.other, null, 'after two hand-offs');
    });

    it('the bodies decide, past any filter', async () => {
      const outsider = await l.installRawCaller();
      await l.send('admin_propose_owner', proposal(l.next), l.installer);

      // A canister that is neither the owner nor the pending principal.
      await l.expectBodyTrap(l.via(outsider, 'admin_propose_owner', proposal(outsider)), UNAUTHORIZED, 'a canister proposing itself');
      await l.expectBodyTrap(l.via(outsider, 'admin_propose_owner', proposal(null)), UNAUTHORIZED, 'a canister cancelling');
      await l.expectBodyTrap(l.via(outsider, 'accept_ownership', none), UNAUTHORIZED, 'a canister accepting a proposal made to another');
      await l.expectState(l.installer, l.next, 'after the outsider tried');

      // A canister that IS the owner is held to the same argument rules.
      await l.send('admin_propose_owner', proposal(outsider), l.installer);
      await l.via(outsider, 'accept_ownership', none);
      await l.expectState(outsider, null, 'the caller canister owns the ledger');
      await l.expectBodyTrap(
        l.via(outsider, 'admin_propose_owner', proposal(l.anonymous)), /anonymous principal cannot be the owner/, 'the owner canister proposing the anonymous principal',
      );
      await l.expectBodyTrap(
        l.via(outsider, 'admin_propose_owner', proposal(outsider)), /already the owner/, 'the owner canister proposing itself',
      );
      await l.expectBodyTrap(l.via(outsider, 'accept_ownership', none), UNAUTHORIZED, 'the owner canister accepting nothing');
      await l.expectState(outsider, null, 'after the refused calls');
    });

    it('an upgrade keeps the owner and a pending hand-off, and grants the upgrader nothing', async () => {
      await l.send('admin_propose_owner', proposal(l.next), l.installer);
      await l.upgradeAs(l.controller);
      await l.expectState(l.installer, l.next, 'after an upgrade by a controller');

      await l.expectRefused('accept_ownership', none, l.controller, 'the upgrader accepting');
      await l.expectRefused('admin_propose_owner', proposal(l.controller), l.controller, 'the upgrader proposing itself');
      await l.expectState(l.installer, l.next, 'after the upgrader tried');

      await l.send('accept_ownership', none, l.next);
      await l.upgradeAs(l.controller);
      await l.expectState(l.next, null, 'after the acceptance and a second upgrade');
    });
  });
}

describe('owner hand-off: upgrading a ledger that had the one-step method', () => {
  const [token] = VARIANTS;
  let l: Ledger;
  beforeEach(async () => { l = await Ledger.create(token, wasmPath('TOKEN_ONE_STEP_WASM', 'token_one_step')); }, 120_000);
  afterEach(async () => { await l.tearDown(); });

  it('keeps the owner it had, starts with nothing pending, and loses the one-step method', async () => {
    // Positive control: this IS the older ledger. The one-step method answers.
    const handed = await l.send('admin_update_owner', enc([IDL.Principal], [l.other]), l.installer);
    expect(IDL.decode([IDL.Bool], handed)[0]).toBe(true);

    await l.upgradeAs(l.controller);
    await l.expectState(l.other, null, 'after the upgrade');

    // At ingress the filter has no arm for a method that does not exist. Past
    // the filter, from a canister, the system itself answers that there is none.
    for (const sender of [l.other, l.installer, l.controller]) {
      const failure = await l.send('admin_update_owner', enc([IDL.Principal], [l.next]), sender).then(() => null, (e: Error) => e);
      expect(failure, `admin_update_owner from ${sender.toText()}`).not.toBeNull();
      expect(failure!.message).toMatch(/implicitly refused/);
    }
    const outsider = await l.installRawCaller();
    const gone = await l.via(outsider, 'admin_update_owner', enc([IDL.Principal], [l.next])).then(() => null, (e: Error) => e);
    expect(gone).not.toBeNull();
    expect(gone!.message).toMatch(/no update method 'admin_update_owner'/);
    await l.expectState(l.other, null, 'after calling the removed method');

    await l.send('admin_propose_owner', proposal(l.next), l.other);
    await l.send('accept_ownership', none, l.next);
    await l.expectState(l.next, null, 'a hand-off on the upgraded ledger');
  });
});
