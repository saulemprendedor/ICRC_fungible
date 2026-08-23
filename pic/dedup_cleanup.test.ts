/**
 * Regression test for the `cleanUpRecents` delete-while-iterating bug.
 *
 * icrc1-mo 0.2.1 `ICRC1/lib.mo` removed entries from `state.recent_transactions`
 * (a `mo:core` Map) while iterating it with `Map.entries`. That corrupts the
 * B-tree iterator and traps with a Natural subtraction underflow inside
 * `core/src/Map.mo` once *several* entries expire in the same pass.
 *
 * `cleanUpRecents` runs synchronously at the end of every successful transfer
 * (`handleCleanUp`), so the trap rolls the transfer back: after a quiet period
 * longer than `transaction_window` (24h by default), EVERY transfer fails, and
 * it cannot self-heal — the rollback restores the very state that traps.
 *
 * The scenario below is exactly that: seed a batch of dedup entries, jump past
 * the transaction window so they all expire at once, then transfer.
 *
 *   - against upstream icrc1-mo 0.2.1  -> the transfer traps (test fails)
 *   - against vendor/icrc1-mo (patched) -> the transfer succeeds
 *
 * Build the wasm first:  bash pic/build-token-wasm.sh
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

// TOKEN_WASM env var lets you point the same test at an unpatched build to see it fail.
const TOKEN_WASM_PATH = process.env.TOKEN_WASM
  ? resolve(process.env.TOKEN_WASM)
  : resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');

/** Default `transaction_window` of icrc1-mo: 24h in nanoseconds. */
const TRANSACTION_WINDOW_NS = 86_400_000_000_000n;

/** How many dedup entries to seed. The trap needs a batch, not a single entry:
 *  a handful of deletes can slip through without tripping the B-tree. */
const SEED_TRANSFERS = 40;

/** How many quiet periods to simulate. */
const ROUNDS = 5;

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const TransferArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: Account,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
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

const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError });

// ---- Token init args (same shape the other pic tests use) ----
function buildTokenInitTypes() {
  const ArchiveIndexType = IDL.Variant({
    Stable: IDL.Null,
    StableTyped: IDL.Null,
    Managed: IDL.Null,
  });
  const BlockTypeInit = IDL.Record({ block_type: IDL.Text, url: IDL.Text });
  const Fee = IDL.Variant({ Environment: IDL.Null, Fixed: IDL.Nat, ICRC1: IDL.Null });

  const ICRC3InitArgs = IDL.Record({
    maxActiveRecords: IDL.Nat,
    settleToRecords: IDL.Nat,
    maxRecordsInArchiveInstance: IDL.Nat,
    maxArchivePages: IDL.Nat,
    archiveIndexType: ArchiveIndexType,
    maxRecordsToArchive: IDL.Nat,
    archiveCycles: IDL.Nat,
    archiveControllers: IDL.Opt(IDL.Opt(IDL.Vec(IDL.Principal))),
    supportedBlocks: IDL.Vec(BlockTypeInit),
  });

  const ICRC4InitArgs = IDL.Record({
    max_balances: IDL.Opt(IDL.Nat),
    max_transfers: IDL.Opt(IDL.Nat),
    fee: IDL.Opt(Fee),
  });

  return IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(IDL.Null),
    icrc2: IDL.Opt(IDL.Null),
    icrc3: ICRC3InitArgs,
    icrc4: IDL.Opt(ICRC4InitArgs),
    icrc85_collector: IDL.Opt(IDL.Principal),
  }));
}

function defaultTokenArgs() {
  return [{
    // icrc1 defaults: minting_account = installer, transaction_window = 24h
    icrc1: [],
    icrc2: [],
    icrc3: {
      maxActiveRecords: BigInt(3000),
      settleToRecords: BigInt(2000),
      maxRecordsInArchiveInstance: BigInt(500000),
      maxArchivePages: BigInt(62500),
      archiveIndexType: { Stable: null },
      maxRecordsToArchive: BigInt(8000),
      archiveCycles: BigInt(20_000_000_000_000),
      archiveControllers: [],
      supportedBlocks: [],
    },
    icrc4: [{ max_balances: [BigInt(100)], max_transfers: [BigInt(100)], fee: [] }],
    icrc85_collector: [],
  }];
}

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

describe('cleanUpRecents dedup cleanup', () => {
  let pic: PocketIc;
  let picServer: PocketIcServer;
  let tokenCanisterId: Principal;
  const admin = createIdentity(70); // minting account
  const alice = createIdentity(71);
  const bob = createIdentity(72);

  async function transfer(
    sender: Principal,
    to: Principal,
    amount: bigint,
    createdAtTime?: bigint,
  ): Promise<any> {
    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc1_transfer',
      arg: IDL.encode([TransferArgs], [{
        from_subaccount: [],
        to: { owner: to, subaccount: [] },
        amount,
        fee: [],
        memo: [],
        created_at_time: createdAtTime === undefined ? [] : [createdAtTime],
      }]),
      sender,
    });
    return IDL.decode([TransferResult], result)[0] as any;
  }

  beforeAll(async () => {
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(
        `Token WASM not found at ${TOKEN_WASM_PATH}. Run 'bash pic/build-token-wasm.sh' first.`,
      );
    }

    picServer = await PocketIcServer.start();
    pic = await PocketIc.create(picServer.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });

    tokenCanisterId = await pic.createCanister({ sender: admin.getPrincipal() });
    await pic.addCycles(tokenCanisterId, 100_000_000_000_000n);
    await pic.installCode({
      canisterId: tokenCanisterId,
      wasm: readFileSync(TOKEN_WASM_PATH),
      arg: IDL.encode([buildTokenInitTypes()], [defaultTokenArgs()]),
      sender: admin.getPrincipal(),
    });
    await pic.tick(10);

    // Fund alice from the minting account.
    const mint = await transfer(admin.getPrincipal(), alice.getPrincipal(), 1_000_000_000_000n);
    expect(mint).toHaveProperty('Ok');
  }, 120_000);

  afterAll(async () => {
    if (pic) await pic.tearDown();
    if (picServer) await picServer.stop();
  });

  it('keeps transferring after a whole batch of dedup entries expires at once', async () => {
    // `recent_transactions` is keyed by transaction HASH, so iteration order is
    // hash order, not insertion order. The cleanup loop stops at the first entry
    // that is still inside the window, so how many entries a single pass deletes
    // depends on where the fresh entries sort. Several quiet periods in a row
    // make sure at least one pass deletes a big enough batch to trip the B-tree.
    let amount = 100_000n;

    for (let round = 0; round < ROUNDS; round++) {
      // 1. Seed dedup entries. Distinct amounts => distinct tx hashes => distinct keys.
      for (let i = 0; i < SEED_TRANSFERS; i++) {
        amount += 1n;
        const res = await transfer(alice.getPrincipal(), bob.getPrincipal(), amount);
        expect(res, `round ${round} seed transfer ${i}`).toHaveProperty('Ok');
      }

      // 2. Quiet period longer than the transaction window: every entry seeded so
      //    far is now expired, so the next transfer's cleanup pass deletes a batch.
      await pic.advanceTime(2 * 24 * 60 * 60 * 1000); // 48h in ms
      await pic.tick(2);

      // 3. Against a correct library this is an ordinary transfer. Against
      //    upstream 0.2.1 the canister traps here with "Natural subtraction
      //    underflow" from core/src/Map.mo, and — because the trap rolls the
      //    deletions back — keeps trapping on every later transfer.
      amount += 1n;
      const afterQuietPeriod = await transfer(alice.getPrincipal(), bob.getPrincipal(), amount);
      expect(afterQuietPeriod, `round ${round} transfer after quiet period`).toHaveProperty('Ok');

      // 4. And it stays healthy — the bug is not self-healing.
      amount += 1n;
      const followUp = await transfer(alice.getPrincipal(), bob.getPrincipal(), amount);
      expect(followUp, `round ${round} follow-up transfer`).toHaveProperty('Ok');
    }
  }, 600_000);

  it('still deduplicates transfers inside the transaction window', async () => {
    const nowNs = BigInt(await pic.getTime()) * 1_000_000n;
    const first = await transfer(alice.getPrincipal(), bob.getPrincipal(), 777_000n, nowNs);
    expect(first).toHaveProperty('Ok');

    const replay = await transfer(alice.getPrincipal(), bob.getPrincipal(), 777_000n, nowNs);
    expect(replay).toHaveProperty('Err');
    expect(replay.Err).toHaveProperty('Duplicate');
  }, 120_000);
});
