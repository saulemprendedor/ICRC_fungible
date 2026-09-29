/**
 * The owner hand-off of the actors that are not the ledger itself: the
 * examples (src/examples/*), the SNS variant (src/snstest.mo) and the ICRC-85
 * test fixture (pic/TokenWithICRC85.mo).
 *
 * They carry the same two steps as `src/Token.mo`: `admin_propose_owner(?p)` by
 * the owner, then `accept_ownership()` by `p`. None of them has an ingress
 * filter, so every refusal is a trap of the body, matched on its message.
 * State is read back with `get_owner` / `get_pending_owner` after every
 * refusal: a trap that still moved the owner would pass a weaker check.
 *
 * pic/owner_handoff.test.ts holds the full matrix for the ledger. This file
 * pins that each of these actors has the same rules, and that the one-step
 * method is gone from all of them.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const UNAUTHORIZED = /Unauthorized/;
const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);
const proposal = (p: Principal | null) => enc([IDL.Opt(IDL.Principal)], [p ? [p] : []]);

// `null` for an optional class argument: every section takes its default.
const defaults = enc([IDL.Opt(IDL.Null)], [[]]);

interface Variant {
  name: string;
  wasm: string;
  installArg: Uint8Array;
  /** A method of the actor that only the owner may call. */
  ownerMethod: [string, Uint8Array];
}

const noInfoRequests: [string, Uint8Array] = ['admin_update_icrc1', enc([IDL.Vec(IDL.Variant({ Name: IDL.Text }))], [[]])];
const noAllowlistRequests: [string, Uint8Array] = [
  'admin_update_allowlist',
  enc([IDL.Vec(IDL.Record({ principal: IDL.Principal, allow: IDL.Bool }))], [[]]),
];

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const Mint = IDL.Record({ to: Account, amount: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) });
const mintOne: [string, Uint8Array] = [
  'mint',
  enc([Mint], [{ to: { owner: createIdentity(3).getPrincipal(), subaccount: [] }, amount: 1n, memo: [], created_at_time: [] }]),
];

const VARIANTS: Variant[] = [
  { name: 'pic/TokenWithICRC85.mo', wasm: wasmPath('ICRC85_WASM', 'token_icrc85'), installArg: defaults, ownerMethod: mintOne },
  { name: 'src/examples/Lotto.mo', wasm: wasmPath('LOTTO_WASM', 'lotto'), installArg: defaults, ownerMethod: noInfoRequests },
  { name: 'src/examples/Allowlist.mo', wasm: wasmPath('ALLOWLIST_WASM', 'allowlist'), installArg: defaults, ownerMethod: noInfoRequests },
  { name: 'src/examples/AllowlistInterface.mo', wasm: wasmPath('ALLOWLIST_INTERFACE_WASM', 'allowlist_interface'), installArg: defaults, ownerMethod: noAllowlistRequests },
  {
    name: 'src/snstest.mo',
    wasm: wasmPath('SNS_WASM', 'sns'),
    installArg: enc([IDL.Variant({ Upgrade: IDL.Opt(IDL.Null) })], [{ Upgrade: [] }]),
    ownerMethod: noInfoRequests,
  },
];

// LottoInterface.mo has no owner method besides the hand-off itself.
const HANDOFF_ONLY: Omit<Variant, 'ownerMethod'> = {
  name: 'src/examples/LottoInterface.mo',
  wasm: wasmPath('LOTTO_INTERFACE_WASM', 'lotto_interface'),
  installArg: defaults,
};

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

class Canister {
  readonly installer = createIdentity(1).getPrincipal(); // installs, so it is the first owner
  readonly controller = createIdentity(2).getPrincipal(); // a controller that is not the owner
  readonly stranger = createIdentity(3).getPrincipal();
  readonly next = createIdentity(4).getPrincipal();
  readonly other = createIdentity(5).getPrincipal();
  readonly anonymous = Principal.anonymous();

  private constructor(readonly pic: PocketIc, readonly id: Principal, readonly variant: Omit<Variant, 'ownerMethod'>) {}

  static async create(variant: Omit<Variant, 'ownerMethod'>): Promise<Canister> {
    const pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    const who = new Canister(pic, Principal.anonymous(), variant);
    const id = await pic.createCanister({ sender: who.installer, controllers: [who.installer, who.controller] });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({ canisterId: id, wasm: readFileSync(variant.wasm), arg: variant.installArg, sender: who.installer });
    await pic.tick(3);
    return new Canister(pic, id, variant);
  }

  tearDown = () => this.pic.tearDown();

  send = (method: string, arg: Uint8Array, sender: Principal) =>
    this.pic.updateCall({ canisterId: this.id, method, arg, sender });

  owner = async () =>
    (IDL.decode([IDL.Principal], await this.pic.queryCall({ canisterId: this.id, method: 'get_owner', arg: none }))[0] as Principal).toText();

  pending = async () => {
    const reply = await this.pic.queryCall({ canisterId: this.id, method: 'get_pending_owner', arg: none });
    const [p] = IDL.decode([IDL.Opt(IDL.Principal)], reply)[0] as Principal[];
    return p ? p.toText() : null;
  };

  async expectState(owner: Principal, pending: Principal | null, why: string) {
    expect(await this.owner(), `owner, ${why}`).toBe(owner.toText());
    expect(await this.pending(), `pending owner, ${why}`).toBe(pending ? pending.toText() : null);
  }

  async expectTrap(method: string, arg: Uint8Array, sender: Principal, message: RegExp, why: string) {
    const failure = await this.send(method, arg, sender).then(() => null, (e: Error) => e);
    expect(failure, why).not.toBeNull();
    expect(failure!.message, why).toMatch(message);
  }

  upgradeAs = async (sender: Principal) => {
    await this.pic.upgradeCanister({
      canisterId: this.id,
      wasm: readFileSync(this.variant.wasm),
      arg: this.variant.installArg,
      sender,
      upgradeModeOptions: { wasm_memory_persistence: [{ keep: null }], skip_pre_upgrade: [] },
    });
    await this.pic.tick(3);
  };
}

for (const variant of [...VARIANTS, HANDOFF_ONLY]) {
  describe(`owner hand-off, ${variant.name}`, () => {
    let c: Canister;
    beforeEach(async () => { c = await Canister.create(variant); }, 120_000);
    afterEach(async () => { await c.tearDown(); });

    it('hands the owner over in two steps, and only when the proposed principal accepts', async () => {
      await c.expectState(c.installer, null, 'after install');

      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await c.expectState(c.installer, c.next, 'after the proposal');

      // The proposal grants nothing, and nobody else can accept it.
      await c.expectTrap('admin_propose_owner', proposal(c.other), c.next, UNAUTHORIZED, 'the pending principal proposing');
      for (const sender of [c.stranger, c.controller, c.installer, c.anonymous]) {
        await c.expectTrap('accept_ownership', none, sender, UNAUTHORIZED, `${sender.toText()} accepting`);
      }
      await c.expectState(c.installer, c.next, 'after the refused calls');

      await c.send('accept_ownership', none, c.next);
      await c.expectState(c.next, null, 'after the acceptance');

      await c.expectTrap('admin_propose_owner', proposal(c.installer), c.installer, UNAUTHORIZED, 'the former owner proposing itself back');
      await c.expectTrap('accept_ownership', none, c.installer, UNAUTHORIZED, 'the former owner accepting');
      await c.expectState(c.next, null, 'after the former owner tried');
    });

    it('refuses a proposal from anybody but the owner', async () => {
      for (const sender of [c.stranger, c.controller, c.anonymous]) {
        await c.expectTrap('admin_propose_owner', proposal(sender), sender, UNAUTHORIZED, `${sender.toText()} proposing itself`);
        await c.expectTrap('admin_propose_owner', proposal(null), sender, UNAUTHORIZED, `${sender.toText()} cancelling`);
      }
      await c.expectState(c.installer, null, 'after the refused proposals');
    });

    it('refuses the anonymous principal and the current owner as a proposal, and keeps what was pending', async () => {
      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await c.expectTrap('admin_propose_owner', proposal(c.anonymous), c.installer, /anonymous principal cannot be the owner/, 'proposing the anonymous principal');
      await c.expectTrap('admin_propose_owner', proposal(c.installer), c.installer, /already the owner/, 'the owner proposing itself');
      await c.expectState(c.installer, c.next, 'after the refused proposals');
    });

    it('cancels with null and replaces with a new proposal', async () => {
      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await c.send('admin_propose_owner', proposal(null), c.installer);
      await c.expectState(c.installer, null, 'after the cancellation');
      await c.expectTrap('accept_ownership', none, c.next, UNAUTHORIZED, 'accepting a cancelled proposal');

      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await c.send('admin_propose_owner', proposal(c.other), c.installer);
      await c.expectTrap('accept_ownership', none, c.next, UNAUTHORIZED, 'the replaced principal accepting');
      await c.send('accept_ownership', none, c.other);
      await c.expectState(c.other, null, 'after the replacement accepted');
    });

    it('keeps the owner and the proposal when a controller that is not the owner upgrades', async () => {
      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await c.upgradeAs(c.controller);
      await c.expectState(c.installer, c.next, 'after the upgrade');
      await c.expectTrap('admin_propose_owner', proposal(c.controller), c.controller, UNAUTHORIZED, 'the upgrader proposing itself');
      await c.send('accept_ownership', none, c.next);
      await c.expectState(c.next, null, 'after the acceptance');
    });

    it('has no one-step method', async () => {
      await c.expectTrap('admin_update_owner', enc([IDL.Principal], [c.next]), c.installer, /no update method 'admin_update_owner'/, 'the removed method');
      await c.expectState(c.installer, null, 'after calling the removed method');
    });
  });
}

for (const variant of VARIANTS) {
  describe(`owner methods follow the hand-off, ${variant.name}`, () => {
    let c: Canister;
    beforeEach(async () => { c = await Canister.create(variant); }, 120_000);
    afterEach(async () => { await c.tearDown(); });

    it('admits the new owner and refuses the former one, the pending one and the anonymous caller', async () => {
      const [method, arg] = variant.ownerMethod;
      const refused = async (sender: Principal, why: string) => c.expectTrap(method, arg, sender, UNAUTHORIZED, why);
      // Positive control: the same call, from the owner, is answered.
      const admitted = async (sender: Principal, why: string) =>
        expect(c.send(method, arg, sender), why).resolves.toBeDefined();

      await admitted(c.installer, 'the owner');
      await refused(c.anonymous, 'the anonymous caller');
      await refused(c.stranger, 'a stranger');

      await c.send('admin_propose_owner', proposal(c.next), c.installer);
      await refused(c.next, 'the pending principal');

      await c.send('accept_ownership', none, c.next);
      await admitted(c.next, 'the new owner');
      await refused(c.installer, 'the former owner');
    });
  });
}
