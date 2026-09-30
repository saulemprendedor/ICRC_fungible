/**
 * A mint through `icrc2_transfer_from` respects `max_supply`
 * (vendor/icrc2-mo, LOCAL PATCH "transfer_from mint cap").
 *
 * `icrc2_transfer_from` whose `from` is the minting account is a mint. icrc2-mo
 * 0.2.1 skips the balance check for it and credits the tokens without looking at
 * `max_supply`, so a capped ledger could be minted past its cap. The fork refuses
 * such a mint with the error `icrc1_transfer` gives:
 * `GenericError { error_code = 6; message = "Cannot mint more than <remaining> tokens" }`.
 *
 * The installer is the owner and the minting account, so it can set the cap and
 * mint through the three ICRC paths. The cap is set relative to the supply read
 * at the start (no burns: total supply = minted supply), so `remaining` is exact.
 *
 * Red against icrc2-mo 0.2.1, green against the fork:
 *   TOKEN_WASM=<upstream build> npx vitest run transfer_from_max_supply.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { readFileSync } from 'fs';
import { createIdentity, wasmPath } from './archive_harness';

const TOKEN_WASM = wasmPath('TOKEN_WASM', 'token');

const enc = (types: IDL.Type[], values: unknown[]) => new Uint8Array(IDL.encode(types, values));
const none = enc([], []);

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
type AccountT = { owner: Principal; subaccount: [] | [Uint8Array] };
const acct = (owner: Principal): AccountT => ({ owner, subaccount: [] });

const GenericError = IDL.Record({ error_code: IDL.Nat, message: IDL.Text });
const TransferArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: Account,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const TransferFromArgs = IDL.Record({
  spender_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from: Account,
  to: Account,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const ApproveArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  spender: Account,
  amount: IDL.Nat,
  expected_allowance: IDL.Opt(IDL.Nat),
  expires_at: IDL.Opt(IDL.Nat64),
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
// Subsets of the ledger's error variants: a reply decodes into the cases it carries,
// and a case these tests do not expect fails the decode, which is loud enough.
const TransferResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: IDL.Variant({ GenericError, InsufficientFunds: IDL.Record({ balance: IDL.Nat }) }),
});
const TransferFromResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: IDL.Variant({
    GenericError,
    InsufficientAllowance: IDL.Record({ allowance: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
  }),
});
const ApproveResult = IDL.Variant({
  Ok: IDL.Nat,
  Err: IDL.Variant({ GenericError, InsufficientFunds: IDL.Record({ balance: IDL.Nat }) }),
});
const BatchResult = IDL.Vec(IDL.Opt(TransferResult));
const InfoRequest = IDL.Variant({
  MaxSupply: IDL.Opt(IDL.Nat),
  Fee: IDL.Variant({ Fixed: IDL.Nat, Environment: IDL.Null }),
});
const Allowance = IDL.Record({ allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) });

type Result = { Ok: bigint } | { Err: { GenericError?: { error_code: bigint; message: string } } & Record<string, unknown> };

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
const sections = { icrc1: IDL.Opt(IDL.Null), icrc2: IDL.Opt(IDL.Null), icrc4: IDL.Opt(IDL.Null) };
const INSTALL_ARG = enc([IDL.Opt(IDL.Record({ ...sections, icrc3: IDL.Opt(ICRC3InitArgs) }))], [[]]);

const capError = (remaining: bigint) => ({
  GenericError: { error_code: 6n, message: `Cannot mint more than ${remaining} tokens` },
});

let server: PocketIcServer;
beforeAll(async () => { server = await PocketIcServer.start(); }, 120_000);
afterAll(async () => { await server.stop(); });

describe('a mint through icrc2_transfer_from respects max_supply', () => {
  const minter = createIdentity(1).getPrincipal(); // installer: owner and minting account
  const alice = createIdentity(5).getPrincipal();
  const spender = createIdentity(6).getPrincipal();
  let pic: PocketIc;
  let id: Principal;

  beforeEach(async () => {
    pic = await PocketIc.create(server.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
    id = await pic.createCanister({ sender: minter });
    await pic.addCycles(id, 100_000_000_000_000n);
    await pic.installCode({ canisterId: id, wasm: readFileSync(TOKEN_WASM), arg: INSTALL_ARG, sender: minter });
    await pic.tick(3);
  });
  afterEach(async () => { await pic.tearDown(); });

  const update = (method: string, arg: Uint8Array, sender: Principal) =>
    pic.updateCall({ canisterId: id, method, arg, sender });
  const query = (method: string, arg: Uint8Array = none) =>
    pic.queryCall({ canisterId: id, method, arg, sender: Principal.anonymous() });

  const supply = async () => IDL.decode([IDL.Nat], await query('icrc1_total_supply'))[0] as bigint;
  const fee = async () => IDL.decode([IDL.Nat], await query('icrc1_fee'))[0] as bigint;
  const balanceOf = async (p: Principal) =>
    IDL.decode([IDL.Nat], await query('icrc1_balance_of', enc([Account], [acct(p)])))[0] as bigint;
  const blocks = async () => {
    const reply = await query('icrc3_get_blocks', enc([IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }))], [[]]));
    return (IDL.decode([IDL.Record({ log_length: IDL.Nat })], reply)[0] as { log_length: bigint }).log_length;
  };
  const allowance = async (p: Principal) =>
    (IDL.decode([Allowance], await query('icrc2_allowance', enc([IDL.Record({ account: Account, spender: Account })], [{ account: acct(minter), spender: acct(p) }])))[0] as { allowance: bigint }).allowance;
  /** What a refused mint must leave as it was. */
  const state = async () => ({ supply: await supply(), alice: await balanceOf(alice), blocks: await blocks(), allowance: await allowance(spender) });

  const setMaxSupply = async (cap: bigint | null) => {
    await update('admin_update_icrc1', enc([IDL.Vec(InfoRequest)], [[{ MaxSupply: cap === null ? [] : [cap] }]]), minter);
  };
  /** Sets the cap `remaining` tokens above the minted supply. */
  const capAbove = async (remaining: bigint) => { await setMaxSupply((await supply()) + remaining); };

  const transferFrom = async (caller: Principal, amount: bigint): Promise<Result> =>
    IDL.decode([TransferFromResult], await update('icrc2_transfer_from', enc([TransferFromArgs], [{
      spender_subaccount: [], from: acct(minter), to: acct(alice), amount, fee: [], memo: [], created_at_time: [],
    }]), caller))[0] as Result;
  const icrc1Mint = async (amount: bigint): Promise<Result> =>
    IDL.decode([TransferResult], await update('icrc1_transfer', enc([TransferArgs], [{
      from_subaccount: [], to: acct(alice), amount, fee: [], memo: [], created_at_time: [],
    }]), minter))[0] as Result;
  const batchMint = async (amounts: bigint[]): Promise<Result[]> =>
    (IDL.decode([BatchResult], await update('icrc4_transfer_batch', enc([IDL.Vec(TransferArgs)], [amounts.map((amount) => ({
      from_subaccount: [], to: acct(alice), amount, fee: [], memo: [], created_at_time: [],
    }))]), minter))[0] as [Result][]).map((r) => r[0]);
  const approve = async (amount: bigint) => {
    const r = IDL.decode([ApproveResult], await update('icrc2_approve', enc([ApproveArgs], [{
      from_subaccount: [], spender: acct(spender), amount, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [],
    }]), minter))[0] as Result;
    expect(r, 'the minting account approves the spender').toHaveProperty('Ok');
  };

  it('mints exactly up to the cap, then refuses one more token and changes nothing', async () => {
    await capAbove(500n);
    const start = await supply();
    expect(await transferFrom(minter, 500n), 'a mint of exactly the remaining supply').toHaveProperty('Ok');
    expect(await supply()).toBe(start + 500n);

    const before = await state();
    expect(await transferFrom(minter, 1n), 'one token past the cap').toEqual({ Err: capError(0n) });
    expect(await state(), 'a refused mint moves nothing').toEqual(before);
  });

  it('refuses a mint of the remaining supply plus one, naming what is left', async () => {
    await capAbove(500n);
    const before = await state();
    expect(await transferFrom(minter, 501n)).toEqual({ Err: capError(500n) });
    expect(await state(), 'a refused mint moves nothing').toEqual(before);
  });

  it('caps an approved spender too, without consuming its allowance', async () => {
    // `icrc2_approve` charges its fee to the approver, and the minting account never holds a
    // balance (a transfer to it is a burn): with a fee this path is closed. Open it with fee 0.
    await update('admin_update_icrc1', enc([IDL.Vec(InfoRequest)], [[{ Fee: { Fixed: 0n } }]]), minter);
    expect(await fee()).toBe(0n);
    // `max_allowance` defaults to the total supply: mint some first.
    expect(await icrc1Mint(1_000_000n)).toHaveProperty('Ok');
    await approve(10_000n);
    await capAbove(500n);
    const before = await state();
    expect(before.allowance).toBe(10_000n);
    expect(await transferFrom(spender, 501n)).toEqual({ Err: capError(500n) });
    expect(await state(), 'the refusal leaves the allowance and the supply').toEqual(before);

    expect(await transferFrom(spender, 500n), 'at the cap').toHaveProperty('Ok');
    expect(await allowance(spender), 'the mint consumes the allowance').toBe(10_000n - 500n);
    expect(await balanceOf(alice)).toBe(before.alice + 500n);
  });

  it('does not cap a ledger without max_supply', async () => {
    await setMaxSupply(null);
    const start = await supply();
    expect(await transferFrom(minter, 10n ** 30n)).toHaveProperty('Ok');
    expect(await supply()).toBe(start + 10n ** 30n);
  });

  it('gives the error icrc1_transfer gives for the same mint', async () => {
    await capAbove(500n);
    const viaIcrc1 = await icrc1Mint(501n);
    const viaIcrc2 = await transferFrom(minter, 501n);
    expect(viaIcrc1).toEqual({ Err: capError(500n) });
    expect(viaIcrc2, 'same code, same message').toEqual(viaIcrc1);
  });

  it('matches icrc4_transfer_batch, which caps item by item', async () => {
    await capAbove(500n);
    const results = await batchMint([500n, 1n]);
    expect(results[0]).toHaveProperty('Ok');
    expect(results[1]).toEqual({ Err: capError(0n) });
    expect(await transferFrom(minter, 1n), 'transfer_from after the batch filled the cap').toEqual({ Err: capError(0n) });
  });

  it('refuses with remaining 0, not a trap, once the minted supply is past the cap', async () => {
    expect(await icrc1Mint(1_000n), 'a mint while uncapped').toHaveProperty('Ok');
    // A cap below what is already minted: icrc1_transfer traps on this state (known, unpatched).
    await setMaxSupply((await supply()) - 1n);
    const before = await state();
    expect(await transferFrom(minter, 1n)).toEqual({ Err: capError(0n) });
    expect(await state()).toEqual(before);

    // Known limit, not patched (vendor/README.md): icrc1's own cap check traps here.
    await expect(icrc1Mint(1n), 'icrc1_transfer traps in this state').rejects.toThrow(/subtraction underflow/i);
    expect(await state(), 'the trap mints nothing').toEqual(before);
  });
});
