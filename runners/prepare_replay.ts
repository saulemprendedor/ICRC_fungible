/**
 * Prepare Replay Data
 * 
 * Converts extracted JSON blocks into the format needed for Candid calls
 * to the replay_blocks function.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Block {
  id: number;
  block: Value;
}

type Value =
  | { Nat: string }
  | { Int: string }
  | { Text: string }
  | { Blob: string }
  | { Array: Value[] }
  | { Map: [string, Value][] };

interface ReplayBlock {
  id: bigint;
  btype: string;
  ts: bigint;
  tx: ReplayTx;
}

type ReplayTx =
  | { mint: { to: Account; amt: bigint; memo: Uint8Array | null } }
  | { burn: { from: Account; amt: bigint; memo: Uint8Array | null } }
  | {
      xfer: {
        from: Account;
        to: Account;
        amt: bigint;
        fee: bigint | null;
        memo: Uint8Array | null;
      };
    }
  | {
      approve: {
        from: Account;
        spender: Account;
        amt: bigint;
        fee: bigint | null;
        expires_at: bigint | null;
        memo: Uint8Array | null;
      };
    }
  | {
      xfer_from: {
        from: Account;
        to: Account;
        spender: Account;
        amt: bigint;
        fee: bigint | null;
        memo: Uint8Array | null;
      };
    };

interface Account {
  owner: string; // Principal as hex string (will be converted)
  subaccount: Uint8Array | null;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function getMapField(map: [string, Value][], key: string): Value | null {
  const entry = map.find(([k]) => k === key);
  return entry ? entry[1] : null;
}

function parseAccount(value: Value): Account | null {
  if ("Array" in value && value.Array.length >= 1) {
    const ownerBlob = value.Array[0];
    if ("Blob" in ownerBlob) {
      const owner = ownerBlob.Blob;
      let subaccount: Uint8Array | null = null;
      if (value.Array.length >= 2) {
        const subBlob = value.Array[1];
        if ("Blob" in subBlob && subBlob.Blob.length > 0) {
          subaccount = hexToBytes(subBlob.Blob);
          // Check if subaccount is all zeros (null subaccount)
          if (subaccount.every((b) => b === 0)) {
            subaccount = null;
          }
        }
      }
      return { owner, subaccount };
    }
  }
  return null;
}

function parseBlock(block: Block): ReplayBlock | null {
  if (!("Map" in block.block)) {
    console.error(`Block ${block.id}: Not a Map`);
    return null;
  }

  const blockMap = block.block.Map;

  // Get tx field
  const txField = getMapField(blockMap, "tx");
  if (!txField || !("Map" in txField)) {
    console.error(`Block ${block.id}: Missing tx field`);
    return null;
  }
  const txMap = txField.Map;

  // Get btype field
  const btypeField = getMapField(blockMap, "btype");
  let btype = "1xfer";
  if (btypeField && "Text" in btypeField) {
    btype = btypeField.Text;
  }

  // Get ts field (block level or tx level)
  let ts = BigInt(0);
  const tsBlockField = getMapField(blockMap, "ts");
  const tsTxField = getMapField(txMap, "ts");
  if (tsBlockField && "Nat" in tsBlockField) {
    ts = BigInt(tsBlockField.Nat);
  } else if (tsTxField && "Nat" in tsTxField) {
    ts = BigInt(tsTxField.Nat);
  }

  // Get op field
  const opField = getMapField(txMap, "op");
  if (!opField || !("Text" in opField)) {
    console.error(`Block ${block.id}: Missing op field`);
    return null;
  }
  const op = opField.Text;

  // Get amount
  const amtField = getMapField(txMap, "amt");
  const amt = amtField && "Nat" in amtField ? BigInt(amtField.Nat) : BigInt(0);

  // Get memo
  const memoField = getMapField(txMap, "memo");
  let memo: Uint8Array | null = null;
  if (memoField && "Blob" in memoField && memoField.Blob.length > 0) {
    memo = hexToBytes(memoField.Blob);
  }

  // Get fee
  const feeField = getMapField(txMap, "fee");
  let fee: bigint | null = null;
  if (feeField && "Nat" in feeField) {
    fee = BigInt(feeField.Nat);
  }

  // Get expires_at
  const expiresField = getMapField(txMap, "expires_at");
  let expires_at: bigint | null = null;
  if (expiresField && "Nat" in expiresField) {
    expires_at = BigInt(expiresField.Nat);
  }

  // Parse by operation type
  let tx: ReplayTx;

  switch (op) {
    case "mint": {
      const toField = getMapField(txMap, "to");
      if (!toField) {
        console.error(`Block ${block.id}: Missing 'to' field for mint`);
        return null;
      }
      const to = parseAccount(toField);
      if (!to) {
        console.error(`Block ${block.id}: Invalid 'to' account for mint`);
        return null;
      }
      tx = { mint: { to, amt, memo } };
      break;
    }

    case "burn": {
      const fromField = getMapField(txMap, "from");
      if (!fromField) {
        console.error(`Block ${block.id}: Missing 'from' field for burn`);
        return null;
      }
      const from = parseAccount(fromField);
      if (!from) {
        console.error(`Block ${block.id}: Invalid 'from' account for burn`);
        return null;
      }
      tx = { burn: { from, amt, memo } };
      break;
    }

    case "xfer": {
      const fromField = getMapField(txMap, "from");
      const toField = getMapField(txMap, "to");
      const spenderField = getMapField(txMap, "spender");

      if (!fromField || !toField) {
        console.error(`Block ${block.id}: Missing from/to field for xfer`);
        return null;
      }

      const from = parseAccount(fromField);
      const to = parseAccount(toField);

      if (!from || !to) {
        console.error(`Block ${block.id}: Invalid from/to account for xfer`);
        return null;
      }

      // Check if this is a transfer_from (has spender)
      if (spenderField) {
        const spender = parseAccount(spenderField);
        if (spender) {
          tx = { xfer_from: { from, to, spender, amt, fee, memo } };
          break;
        }
      }

      tx = { xfer: { from, to, amt, fee, memo } };
      break;
    }

    case "approve": {
      const fromField = getMapField(txMap, "from");
      const spenderField = getMapField(txMap, "spender");

      if (!fromField || !spenderField) {
        console.error(
          `Block ${block.id}: Missing from/spender field for approve`
        );
        return null;
      }

      const from = parseAccount(fromField);
      const spender = parseAccount(spenderField);

      if (!from || !spender) {
        console.error(
          `Block ${block.id}: Invalid from/spender account for approve`
        );
        return null;
      }

      tx = { approve: { from, spender, amt, fee, expires_at, memo } };
      break;
    }

    default:
      console.error(`Block ${block.id}: Unknown op type: ${op}`);
      return null;
  }

  return {
    id: BigInt(block.id),
    btype,
    ts,
    tx,
  };
}

function prepareLedger(ledgerName: string): void {
  const dataDir = path.join(__dirname, "..", "data");
  const blocksFile = path.join(dataDir, `${ledgerName}_blocks.json`);
  const outputFile = path.join(dataDir, `${ledgerName}_replay.json`);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Preparing ${ledgerName}`);
  console.log("=".repeat(60));

  if (!fs.existsSync(blocksFile)) {
    console.error(`❌ Blocks file not found: ${blocksFile}`);
    return;
  }

  console.log("📂 Loading blocks...");
  const rawBlocks: Block[] = JSON.parse(fs.readFileSync(blocksFile, "utf-8"));
  console.log(`   Loaded ${rawBlocks.length} blocks`);

  console.log("🔄 Converting blocks...");
  const replayBlocks: ReplayBlock[] = [];
  let errors = 0;

  for (const block of rawBlocks) {
    const parsed = parseBlock(block);
    if (parsed) {
      replayBlocks.push(parsed);
    } else {
      errors++;
    }
  }

  console.log(`   Converted ${replayBlocks.length} blocks`);
  if (errors > 0) {
    console.log(`   ⚠ ${errors} blocks had errors`);
  }

  // Convert to serializable format
  const serializable = replayBlocks.map((b) => ({
    id: b.id.toString(),
    btype: b.btype,
    ts: b.ts.toString(),
    tx: serializeTx(b.tx),
  }));

  console.log("💾 Saving replay data...");
  fs.writeFileSync(outputFile, JSON.stringify(serializable, null, 2));
  console.log(`   Saved: ${outputFile}`);

  // Also generate summary
  const summary = {
    ledger: ledgerName,
    totalBlocks: replayBlocks.length,
    blockTypes: {} as Record<string, number>,
    firstBlock: replayBlocks.length > 0 ? Number(replayBlocks[0].id) : -1,
    lastBlock:
      replayBlocks.length > 0
        ? Number(replayBlocks[replayBlocks.length - 1].id)
        : -1,
  };

  for (const block of replayBlocks) {
    summary.blockTypes[block.btype] =
      (summary.blockTypes[block.btype] || 0) + 1;
  }

  console.log("\n📊 Summary:");
  console.log(`   Total blocks: ${summary.totalBlocks}`);
  console.log(`   Block range: ${summary.firstBlock} - ${summary.lastBlock}`);
  console.log("   Block types:");
  for (const [type, count] of Object.entries(summary.blockTypes)) {
    console.log(`     - ${type}: ${count}`);
  }

  console.log("\n✅ Preparation complete!");
}

function serializeTx(tx: ReplayTx): object {
  if ("mint" in tx) {
    return {
      mint: {
        to: serializeAccount(tx.mint.to),
        amt: tx.mint.amt.toString(),
        memo: tx.mint.memo ? Buffer.from(tx.mint.memo).toString("hex") : null,
      },
    };
  } else if ("burn" in tx) {
    return {
      burn: {
        from: serializeAccount(tx.burn.from),
        amt: tx.burn.amt.toString(),
        memo: tx.burn.memo ? Buffer.from(tx.burn.memo).toString("hex") : null,
      },
    };
  } else if ("xfer" in tx) {
    return {
      xfer: {
        from: serializeAccount(tx.xfer.from),
        to: serializeAccount(tx.xfer.to),
        amt: tx.xfer.amt.toString(),
        fee: tx.xfer.fee?.toString() ?? null,
        memo: tx.xfer.memo ? Buffer.from(tx.xfer.memo).toString("hex") : null,
      },
    };
  } else if ("approve" in tx) {
    return {
      approve: {
        from: serializeAccount(tx.approve.from),
        spender: serializeAccount(tx.approve.spender),
        amt: tx.approve.amt.toString(),
        fee: tx.approve.fee?.toString() ?? null,
        expires_at: tx.approve.expires_at?.toString() ?? null,
        memo: tx.approve.memo
          ? Buffer.from(tx.approve.memo).toString("hex")
          : null,
      },
    };
  } else if ("xfer_from" in tx) {
    return {
      xfer_from: {
        from: serializeAccount(tx.xfer_from.from),
        to: serializeAccount(tx.xfer_from.to),
        spender: serializeAccount(tx.xfer_from.spender),
        amt: tx.xfer_from.amt.toString(),
        fee: tx.xfer_from.fee?.toString() ?? null,
        memo: tx.xfer_from.memo
          ? Buffer.from(tx.xfer_from.memo).toString("hex")
          : null,
      },
    };
  }
  return {};
}

function serializeAccount(account: Account): object {
  return {
    owner: account.owner,
    subaccount: account.subaccount
      ? Buffer.from(account.subaccount).toString("hex")
      : null,
  };
}

// Main
const args = process.argv.slice(2);
const target = args[0] || "all";

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║       Prepare Replay Data                                  ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log(`\nTarget: ${target}`);

if (target === "all" || target === "cycleshare") {
  prepareLedger("cycleshare");
}
if (target === "all" || target === "icdevs") {
  prepareLedger("icdevs");
}

console.log("\n" + "=".repeat(60));
console.log("🎉 All preparation complete!");
console.log("=".repeat(60));
