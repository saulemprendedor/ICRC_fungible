/**
 * An archive upgraded through the ledger's `upgradeArchive` keeps its bounds.
 *
 * `UpgradeArchive.upgradeArchive` upgrades each archive with placeholder
 * arguments (`maxRecords = 0; firstIndex = 0`). Upstream `icrc3-mo` 0.4.3 keeps
 * the archive's arguments in `transient var args = _args`, which is re-bound to
 * those placeholders on every upgrade, while the bounds it was created with
 * survive only in the stable `initial_args`. Every read of `args.maxRecords` or
 * `args.firstIndex` after the upgrade is then wrong: the block lookup of any
 * archive but the first, `remaining_capacity`, `get_stats` and the "is full"
 * check of `append_transactions`.
 *
 * The test builds two archives, the second one starting past block 0, upgrades
 * them, and checks that each still reports and serves exactly what it did before.
 *
 * TOKEN_WASM=<path> points it at any ledger build.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import {
  archiveBlocks, archiveIdl, archives, createIdentity, installLedger, smallArchiveArgs,
  transferUntil, wasmPath,
} from './archive_harness';

const TOKEN_WASM = wasmPath('TOKEN_WASM', 'token');

describe('upgradeArchive keeps each archive\'s bounds', () => {
  let picServer: PocketIcServer;
  let pic: PocketIc;

  beforeAll(async () => {
    picServer = await PocketIcServer.start();
    pic = await PocketIc.create(picServer.getUrl(), { application: [{ state: { type: SubnetStateType.New } }] });
  });

  afterAll(async () => {
    await pic?.tearDown();
    await picServer?.stop();
  });

  it('an upgraded archive past block 0 reports and serves the same blocks, and archiving continues', async () => {
    const owner = createIdentity(1).getPrincipal();
    const holder = createIdentity(2);
    const { id: ledgerId, actor: ledger } = await installLedger(pic, TOKEN_WASM, owner, smallArchiveArgs({ perArchive: 60 }));

    const archiveActor = (id: any) => pic.createActor<any>(archiveIdl, id);

    await transferUntil(pic, ledger, owner, holder, async () => {
      const list = await archives(ledger, ledgerId);
      if (list.length < 2) return false;
      return (await archiveActor(list[1].canister_id).total_transactions()) > 0n;
    });

    const list = await archives(ledger, ledgerId);
    const before = [];
    for (const a of list) {
      const archive = archiveActor(a.canister_id);
      const stats = await archive.get_stats();
      before.push({
        id: a.canister_id.toText(),
        stats,
        remaining: await archive.remaining_capacity(),
        blocks: await archiveBlocks(archive, stats.first_block_index, stats.total_records),
      });
    }
    expect(before[1].stats.first_block_index).toBeGreaterThan(0n);

    ledger.setPrincipal(owner);
    await ledger.upgradeArchive(false);
    for (let i = 0; i < 5; i++) await pic.tick();
    expect(await ledger.getUpgradeError()).toBe('');

    for (const b of before) {
      const archive = archiveActor(list.find((a) => a.canister_id.toText() === b.id)!.canister_id);
      const stats = await archive.get_stats();
      expect(stats.first_block_index, `first_block_index of ${b.id}`).toBe(b.stats.first_block_index);
      expect(stats.max_records, `max_records of ${b.id}`).toBe(b.stats.max_records);
      expect(await archive.remaining_capacity(), `remaining_capacity of ${b.id}`).toBe(b.remaining);
      expect(await archiveBlocks(archive, b.stats.first_block_index, b.stats.total_records), `blocks of ${b.id}`).toBe(b.blocks);
    }

    // Archiving continues into the upgraded archives: the archived records grow,
    // and every archive still serves each record it counts, contiguously.
    const archivedBefore = before.reduce((s, b) => s + b.stats.total_records, 0n);
    const archivedNow = async () => {
      let s = 0n;
      for (const a of await archives(ledger, ledgerId)) s += await archiveActor(a.canister_id).total_transactions();
      return s;
    };
    await transferUntil(pic, ledger, owner, holder, async () => (await archivedNow()) >= archivedBefore + 50n);

    let expectedFirst = 0n;
    for (const a of await archives(ledger, ledgerId)) {
      const archive = archiveActor(a.canister_id);
      const stats = await archive.get_stats();
      expect(stats.first_block_index, `archive ${a.canister_id.toText()} starts where the previous one ended`).toBe(expectedFirst);
      const blocks = JSON.parse(await archiveBlocks(archive, stats.first_block_index, stats.total_records));
      expect(blocks.length).toBe(Number(stats.total_records));
      blocks.forEach((b: { id: string }, i: number) => expect(BigInt(b.id)).toBe(stats.first_block_index + BigInt(i)));
      expectedFirst = stats.first_block_index + stats.total_records;
    }
  });
});
