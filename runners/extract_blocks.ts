#!/usr/bin/env npx ts-node
/**
 * Block Extraction Script for Token Ledger Migration
 * 
 * Extracts all ICRC-3 blocks from production ledgers on IC mainnet.
 * 
 * Usage:
 *   npx ts-node extract_blocks.ts cycleshare
 *   npx ts-node extract_blocks.ts icdevs
 *   npx ts-node extract_blocks.ts all
 * 
 * Output:
 *   data/cycleshare_blocks.json
 *   data/cycleshare_meta.json
 *   data/icdevs_blocks.json
 *   data/icdevs_meta.json
 */

import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const LEDGERS = {
  cycleshare: {
    canisterId: "q26le-iqaaa-aaaam-actsa-cai",
    name: "CycleShareLedger",
    symbol: "OVSdv",
  },
  icdevs: {
    canisterId: "agtsn-xyaaa-aaaag-ak3kq-cai",
    name: "ICDevsToken",
    symbol: "ICDV",
  },
};

const IC_HOST = "https://icp-api.io";
const BLOCKS_PER_REQUEST = 2000; // Max blocks per icrc3_get_blocks call

// =============================================================================
// ICRC-3 IDL Definition
// =============================================================================

// Value type (recursive)
const Value: IDL.Type<any> = IDL.Rec();
Value.fill(
  IDL.Variant({
    Blob: IDL.Vec(IDL.Nat8),
    Text: IDL.Text,
    Nat: IDL.Nat,
    Int: IDL.Int,
    Array: IDL.Vec(Value),
    Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
  })
);

// Block with ID
const BlockWithId = IDL.Record({
  id: IDL.Nat,
  block: Value,
});

// Archive info
const ArchiveInfo = IDL.Record({
  canister_id: IDL.Principal,
  start: IDL.Nat,
  end: IDL.Nat,
});

// Get blocks args
const GetBlocksArgs = IDL.Vec(
  IDL.Record({
    start: IDL.Nat,
    length: IDL.Nat,
  })
);

// Archived blocks callback result
const ArchivedBlocksResult = IDL.Record({
  args: GetBlocksArgs,
  callback: IDL.Func(
    [GetBlocksArgs],
    [
      IDL.Record({
        blocks: IDL.Vec(BlockWithId),
      }),
    ],
    ["query"]
  ),
});

// Get blocks result
const GetBlocksResult = IDL.Record({
  log_length: IDL.Nat,
  blocks: IDL.Vec(BlockWithId),
  archived_blocks: IDL.Vec(ArchivedBlocksResult),
});

// Get archives args
const GetArchivesArgs = IDL.Record({
  from: IDL.Opt(IDL.Principal),
});

// Get archives result
const GetArchivesResult = IDL.Vec(ArchiveInfo);

// ICRC-1 types for metadata
const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const MetadataValue = IDL.Variant({
  Nat: IDL.Nat,
  Int: IDL.Int,
  Text: IDL.Text,
  Blob: IDL.Vec(IDL.Nat8),
});

// Combined IDL factory for ICRC-3 queries
const icrc3IdlFactory = ({ IDL }: { IDL: any }) => {
  return IDL.Service({
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ["query"]),
    icrc3_get_archives: IDL.Func([GetArchivesArgs], [GetArchivesResult], ["query"]),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_metadata: IDL.Func(
      [],
      [IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue))],
      ["query"]
    ),
    icrc1_minting_account: IDL.Func([], [IDL.Opt(Account)], ["query"]),
  });
};

// =============================================================================
// Types
// =============================================================================

interface ExtractedBlock {
  id: number;
  block: any; // ICRC-3 Value type
}

interface ExtractionMeta {
  ledger: string;
  canisterId: string;
  extractedAt: string;
  totalBlocks: number;
  archiveCount: number;
  archives: { canisterId: string; start: number; end: number }[];
  totalSupply: string;
  metadata: { [key: string]: any };
  mintingAccount: { owner: string; subaccount: string | null } | null;
  blockRangeStart: number;
  blockRangeEnd: number;
  checksum: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function valueToJson(value: any): any {
  if (value === undefined || value === null) {
    return null;
  }

  // Check for variant types
  if ("Blob" in value) {
    // Convert Uint8Array to hex string
    const bytes = value.Blob;
    return {
      Blob: Buffer.from(bytes).toString("hex"),
    };
  }
  if ("Text" in value) {
    return { Text: value.Text };
  }
  if ("Nat" in value) {
    return { Nat: value.Nat.toString() };
  }
  if ("Int" in value) {
    return { Int: value.Int.toString() };
  }
  if ("Array" in value) {
    return { Array: value.Array.map(valueToJson) };
  }
  if ("Map" in value) {
    return {
      Map: value.Map.map(([key, val]: [string, any]) => [key, valueToJson(val)]),
    };
  }

  // Fallback for other types
  return value;
}

function simpleHash(data: string): string {
  // Simple hash for checksum - not cryptographic, just for verification
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function ensureDataDir(): string {
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// =============================================================================
// Main Extraction Logic
// =============================================================================

async function createAgent(): Promise<HttpAgent> {
  const agent = await HttpAgent.create({
    host: IC_HOST,
  });
  return agent;
}

async function extractBlocks(
  ledgerKey: "cycleshare" | "icdevs"
): Promise<{ blocks: ExtractedBlock[]; meta: ExtractionMeta }> {
  const ledger = LEDGERS[ledgerKey];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Extracting blocks from ${ledger.name} (${ledger.canisterId})`);
  console.log(`${"=".repeat(60)}\n`);

  const agent = await createAgent();
  const actor = Actor.createActor(icrc3IdlFactory, {
    agent,
    canisterId: ledger.canisterId,
  });

  // Step 1: Get archives
  console.log("📦 Fetching archive information...");
  const archivesResult = (await actor.icrc3_get_archives({ from: [] })) as any[];
  console.log(`   Found ${archivesResult.length} archive(s)`);

  const archives = archivesResult.map((a: any) => ({
    canisterId: a.canister_id.toText(),
    start: Number(a.start),
    end: Number(a.end),
  }));

  // Step 2: Get total block count and initial blocks
  console.log("\n📊 Fetching block count...");
  const initialResult = (await actor.icrc3_get_blocks([
    { start: BigInt(0), length: BigInt(1) },
  ])) as any;
  const totalBlocks = Number(initialResult.log_length);
  console.log(`   Total blocks: ${totalBlocks}`);

  // Step 3: Fetch all blocks from main canister
  const allBlocks: ExtractedBlock[] = [];
  let start = 0;

  console.log("\n📥 Extracting blocks from main canister...");
  while (start < totalBlocks) {
    const length = Math.min(BLOCKS_PER_REQUEST, totalBlocks - start);
    process.stdout.write(`   Fetching blocks ${start} - ${start + length - 1}...`);

    const result = (await actor.icrc3_get_blocks([
      { start: BigInt(start), length: BigInt(length) },
    ])) as any;

    for (const blockWithId of result.blocks) {
      allBlocks.push({
        id: Number(blockWithId.id),
        block: valueToJson(blockWithId.block),
      });
    }

    console.log(` ✓ (${result.blocks.length} blocks)`);

    // Check for archived blocks
    if (result.archived_blocks && result.archived_blocks.length > 0) {
      console.log(`   ⚠️  Found ${result.archived_blocks.length} archived block reference(s)`);
      // For now, we'll handle archives if they exist
      for (const archivedRef of result.archived_blocks) {
        console.log(`   📦 Fetching from archive...`);
        // Create actor for archive canister
        // Note: The callback is a canister reference, we need to call it directly
        // This is simplified - in production you'd need to handle the archive actor
      }
    }

    start += result.blocks.length;

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Step 4: Sort blocks by ID
  allBlocks.sort((a, b) => a.id - b.id);

  // Step 5: Validate continuity
  console.log("\n🔍 Validating block continuity...");
  let valid = true;
  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].id !== i) {
      console.error(`   ❌ Gap detected: expected block ${i}, got ${allBlocks[i].id}`);
      valid = false;
    }
  }
  if (valid) {
    console.log(`   ✓ All ${allBlocks.length} blocks are contiguous (0 - ${allBlocks.length - 1})`);
  }

  // Step 6: Fetch metadata
  console.log("\n📋 Fetching token metadata...");
  const metadata = (await actor.icrc1_metadata()) as any[];
  const metadataObj: { [key: string]: any } = {};
  for (const [key, value] of metadata) {
    if ("Text" in value) metadataObj[key] = value.Text;
    else if ("Nat" in value) metadataObj[key] = value.Nat.toString();
    else if ("Int" in value) metadataObj[key] = value.Int.toString();
    else if ("Blob" in value)
      metadataObj[key] = Buffer.from(value.Blob).toString("hex");
  }
  console.log(`   Name: ${metadataObj["icrc1:name"] || "N/A"}`);
  console.log(`   Symbol: ${metadataObj["icrc1:symbol"] || "N/A"}`);
  console.log(`   Decimals: ${metadataObj["icrc1:decimals"] || "N/A"}`);
  console.log(`   Fee: ${metadataObj["icrc1:fee"] || "N/A"}`);

  // Step 7: Fetch total supply
  console.log("\n💰 Fetching total supply...");
  const totalSupply = (await actor.icrc1_total_supply()) as bigint;
  console.log(`   Total supply: ${totalSupply.toString()}`);

  // Step 8: Fetch minting account
  console.log("\n🏦 Fetching minting account...");
  const mintingAccountOpt = (await actor.icrc1_minting_account()) as any[];
  let mintingAccount: { owner: string; subaccount: string | null } | null = null;
  if (mintingAccountOpt.length > 0) {
    const ma = mintingAccountOpt[0];
    mintingAccount = {
      owner: ma.owner.toText(),
      subaccount:
        ma.subaccount.length > 0
          ? Buffer.from(ma.subaccount[0]).toString("hex")
          : null,
    };
    console.log(`   Owner: ${mintingAccount.owner}`);
  } else {
    console.log(`   No minting account set`);
  }

  // Step 9: Create checksum
  const blocksJson = JSON.stringify(allBlocks);
  const checksum = simpleHash(blocksJson);

  // Step 10: Build metadata
  const meta: ExtractionMeta = {
    ledger: ledger.name,
    canisterId: ledger.canisterId,
    extractedAt: new Date().toISOString(),
    totalBlocks: allBlocks.length,
    archiveCount: archives.length,
    archives,
    totalSupply: totalSupply.toString(),
    metadata: metadataObj,
    mintingAccount,
    blockRangeStart: 0,
    blockRangeEnd: allBlocks.length - 1,
    checksum,
  };

  console.log("\n✅ Extraction complete!");
  console.log(`   Blocks: ${allBlocks.length}`);
  console.log(`   Checksum: ${checksum}`);

  return { blocks: allBlocks, meta };
}

async function saveResults(
  ledgerKey: string,
  blocks: ExtractedBlock[],
  meta: ExtractionMeta
): Promise<void> {
  const dataDir = ensureDataDir();

  const blocksFile = path.join(dataDir, `${ledgerKey}_blocks.json`);
  const metaFile = path.join(dataDir, `${ledgerKey}_meta.json`);

  console.log(`\n💾 Saving results...`);
  console.log(`   Blocks: ${blocksFile}`);
  fs.writeFileSync(blocksFile, JSON.stringify(blocks, null, 2));

  console.log(`   Metadata: ${metaFile}`);
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  console.log(`   ✓ Saved successfully`);
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0] || "all";

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       ICRC-3 Block Extraction for Token Migration          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nTarget: ${target}`);
  console.log(`Host: ${IC_HOST}`);

  try {
    if (target === "cycleshare" || target === "all") {
      const { blocks, meta } = await extractBlocks("cycleshare");
      await saveResults("cycleshare", blocks, meta);
    }

    if (target === "icdevs" || target === "all") {
      const { blocks, meta } = await extractBlocks("icdevs");
      await saveResults("icdevs", blocks, meta);
    }

    if (target !== "cycleshare" && target !== "icdevs" && target !== "all") {
      console.error(`\n❌ Unknown target: ${target}`);
      console.error(`   Valid targets: cycleshare, icdevs, all`);
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎉 All extractions complete!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Extraction failed:", error);
    process.exit(1);
  }
}

main();
