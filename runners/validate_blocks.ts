#!/usr/bin/env npx ts-node
/**
 * Block Validation and Account Mapping Script
 * 
 * Tasks:
 * 1. Validate block integrity (Task 1.2)
 *    - Verify block indices are contiguous
 *    - Verify transaction types are recognized
 * 
 * 2. Map account holders (Task 0.2)
 *    - Extract all unique accounts from transactions
 *    - Categorize by transaction type
 * 
 * Usage:
 *   npx tsx validate_blocks.ts cycleshare
 *   npx tsx validate_blocks.ts icdevs
 *   npx tsx validate_blocks.ts all
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Types
// =============================================================================

interface ExtractedBlock {
  id: number;
  block: any;
}

interface ValidationResult {
  valid: boolean;
  blockCount: number;
  errors: string[];
  warnings: string[];
  transactionTypes: { [key: string]: number };
}

interface AccountInfo {
  owner: string;
  subaccount: string | null;
  seenIn: string[];
  firstSeen: number;
  lastSeen: number;
  transactionCount: number;
}

interface AccountMappingResult {
  totalAccounts: number;
  accounts: { [key: string]: AccountInfo };
  mintRecipients: string[];
  burnSenders: string[];
  transferParticipants: string[];
  approvalParticipants: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

function getMapField(mapValue: any, key: string): any {
  if (!mapValue || !mapValue.Map) return null;
  for (const [k, v] of mapValue.Map) {
    if (k === key) return v;
  }
  return null;
}

function getTextField(value: any): string | null {
  if (value && value.Text !== undefined) return value.Text;
  return null;
}

function getNatField(value: any): bigint | null {
  if (value && value.Nat !== undefined) return BigInt(value.Nat);
  return null;
}

function getBlobField(value: any): string | null {
  if (value && value.Blob !== undefined) return value.Blob;
  return null;
}

function getAccountFromArray(arr: any): { owner: string; subaccount: string | null } | null {
  if (!arr || !arr.Array || arr.Array.length < 1) return null;
  
  const ownerBlob = getBlobField(arr.Array[0]);
  if (!ownerBlob) return null;
  
  let subaccount: string | null = null;
  if (arr.Array.length > 1) {
    subaccount = getBlobField(arr.Array[1]);
  }
  
  return { owner: ownerBlob, subaccount };
}

function accountToKey(account: { owner: string; subaccount: string | null }): string {
  if (account.subaccount && account.subaccount !== "0000000000000000000000000000000000000000000000000000000000000000") {
    return `${account.owner}:${account.subaccount}`;
  }
  return account.owner;
}

// =============================================================================
// Validation Logic
// =============================================================================

function validateBlocks(blocks: ExtractedBlock[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const transactionTypes: { [key: string]: number } = {};

  // Check block count
  if (blocks.length === 0) {
    errors.push("No blocks found");
    return { valid: false, blockCount: 0, errors, warnings, transactionTypes };
  }

  // Validate each block
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Check index continuity
    if (block.id !== i) {
      errors.push(`Block index mismatch: expected ${i}, got ${block.id}`);
    }

    // Get transaction
    const tx = getMapField(block.block, "tx");
    if (!tx) {
      errors.push(`Block ${i}: Missing 'tx' field`);
      continue;
    }

    // Get operation type
    const op = getTextField(getMapField(tx, "op"));
    if (!op) {
      errors.push(`Block ${i}: Missing 'op' field in transaction`);
      continue;
    }

    // Count transaction types
    const btype = getTextField(getMapField(block.block, "btype")) || op;
    transactionTypes[btype] = (transactionTypes[btype] || 0) + 1;

    // Validate operation-specific fields
    switch (op) {
      case "mint":
        if (!getMapField(tx, "to")) {
          errors.push(`Block ${i} (mint): Missing 'to' field`);
        }
        if (!getMapField(tx, "amt")) {
          errors.push(`Block ${i} (mint): Missing 'amt' field`);
        }
        break;

      case "burn":
        if (!getMapField(tx, "from")) {
          errors.push(`Block ${i} (burn): Missing 'from' field`);
        }
        if (!getMapField(tx, "amt")) {
          errors.push(`Block ${i} (burn): Missing 'amt' field`);
        }
        break;

      case "xfer":
        if (!getMapField(tx, "from")) {
          errors.push(`Block ${i} (xfer): Missing 'from' field`);
        }
        if (!getMapField(tx, "to")) {
          errors.push(`Block ${i} (xfer): Missing 'to' field`);
        }
        if (!getMapField(tx, "amt")) {
          errors.push(`Block ${i} (xfer): Missing 'amt' field`);
        }
        break;

      case "approve":
        if (!getMapField(tx, "from")) {
          errors.push(`Block ${i} (approve): Missing 'from' field`);
        }
        if (!getMapField(tx, "spender")) {
          errors.push(`Block ${i} (approve): Missing 'spender' field`);
        }
        break;

      default:
        warnings.push(`Block ${i}: Unknown operation type '${op}'`);
    }

    // Check timestamp
    if (!getMapField(tx, "ts")) {
      warnings.push(`Block ${i}: Missing 'ts' (timestamp) field`);
    }

    // Check phash for blocks after 0
    if (i > 0) {
      const phash = getMapField(block.block, "phash");
      if (!phash) {
        errors.push(`Block ${i}: Missing 'phash' field`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    blockCount: blocks.length,
    errors,
    warnings,
    transactionTypes,
  };
}

// =============================================================================
// Account Mapping Logic
// =============================================================================

function mapAccounts(blocks: ExtractedBlock[]): AccountMappingResult {
  const accounts: { [key: string]: AccountInfo } = {};
  const mintRecipients = new Set<string>();
  const burnSenders = new Set<string>();
  const transferParticipants = new Set<string>();
  const approvalParticipants = new Set<string>();

  function recordAccount(
    account: { owner: string; subaccount: string | null },
    blockId: number,
    role: string
  ): void {
    const key = accountToKey(account);
    
    if (!accounts[key]) {
      accounts[key] = {
        owner: account.owner,
        subaccount: account.subaccount,
        seenIn: [],
        firstSeen: blockId,
        lastSeen: blockId,
        transactionCount: 0,
      };
    }
    
    if (!accounts[key].seenIn.includes(role)) {
      accounts[key].seenIn.push(role);
    }
    accounts[key].lastSeen = Math.max(accounts[key].lastSeen, blockId);
    accounts[key].transactionCount++;
  }

  for (const block of blocks) {
    const tx = getMapField(block.block, "tx");
    if (!tx) continue;

    const op = getTextField(getMapField(tx, "op"));
    if (!op) continue;

    switch (op) {
      case "mint": {
        const to = getAccountFromArray(getMapField(tx, "to"));
        if (to) {
          recordAccount(to, block.id, "mint_recipient");
          mintRecipients.add(accountToKey(to));
        }
        break;
      }

      case "burn": {
        const from = getAccountFromArray(getMapField(tx, "from"));
        if (from) {
          recordAccount(from, block.id, "burn_sender");
          burnSenders.add(accountToKey(from));
        }
        break;
      }

      case "xfer": {
        const from = getAccountFromArray(getMapField(tx, "from"));
        const to = getAccountFromArray(getMapField(tx, "to"));
        const spender = getAccountFromArray(getMapField(tx, "spender"));
        
        if (from) {
          recordAccount(from, block.id, "transfer_sender");
          transferParticipants.add(accountToKey(from));
        }
        if (to) {
          recordAccount(to, block.id, "transfer_recipient");
          transferParticipants.add(accountToKey(to));
        }
        if (spender) {
          recordAccount(spender, block.id, "transfer_spender");
          transferParticipants.add(accountToKey(spender));
        }
        break;
      }

      case "approve": {
        const from = getAccountFromArray(getMapField(tx, "from"));
        const spender = getAccountFromArray(getMapField(tx, "spender"));
        
        if (from) {
          recordAccount(from, block.id, "approval_owner");
          approvalParticipants.add(accountToKey(from));
        }
        if (spender) {
          recordAccount(spender, block.id, "approval_spender");
          approvalParticipants.add(accountToKey(spender));
        }
        break;
      }
    }
  }

  return {
    totalAccounts: Object.keys(accounts).length,
    accounts,
    mintRecipients: Array.from(mintRecipients),
    burnSenders: Array.from(burnSenders),
    transferParticipants: Array.from(transferParticipants),
    approvalParticipants: Array.from(approvalParticipants),
  };
}

// =============================================================================
// Main Functions
// =============================================================================

function loadBlocks(ledgerKey: string): ExtractedBlock[] {
  const dataDir = path.join(__dirname, "..", "data");
  const blocksFile = path.join(dataDir, `${ledgerKey}_blocks.json`);
  
  if (!fs.existsSync(blocksFile)) {
    throw new Error(`Blocks file not found: ${blocksFile}`);
  }
  
  const content = fs.readFileSync(blocksFile, "utf-8");
  return JSON.parse(content);
}

function saveResults(ledgerKey: string, validation: ValidationResult, accounts: AccountMappingResult): void {
  const dataDir = path.join(__dirname, "..", "data");
  
  const validationFile = path.join(dataDir, `${ledgerKey}_validation.json`);
  fs.writeFileSync(validationFile, JSON.stringify(validation, null, 2));
  console.log(`   Validation: ${validationFile}`);
  
  const accountsFile = path.join(dataDir, `${ledgerKey}_accounts.json`);
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
  console.log(`   Accounts: ${accountsFile}`);
}

async function processLedger(ledgerKey: string): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing ${ledgerKey}`);
  console.log(`${"=".repeat(60)}\n`);

  // Load blocks
  console.log("📂 Loading blocks...");
  const blocks = loadBlocks(ledgerKey);
  console.log(`   Loaded ${blocks.length} blocks`);

  // Validate
  console.log("\n🔍 Validating block integrity...");
  const validation = validateBlocks(blocks);
  
  if (validation.valid) {
    console.log(`   ✓ All ${validation.blockCount} blocks are valid`);
  } else {
    console.log(`   ✗ Found ${validation.errors.length} errors`);
    for (const error of validation.errors.slice(0, 10)) {
      console.log(`     - ${error}`);
    }
    if (validation.errors.length > 10) {
      console.log(`     ... and ${validation.errors.length - 10} more errors`);
    }
  }
  
  if (validation.warnings.length > 0) {
    console.log(`   ⚠ Found ${validation.warnings.length} warnings`);
    for (const warning of validation.warnings.slice(0, 5)) {
      console.log(`     - ${warning}`);
    }
  }

  console.log("\n📊 Transaction types:");
  for (const [type, count] of Object.entries(validation.transactionTypes)) {
    console.log(`   - ${type}: ${count}`);
  }

  // Map accounts
  console.log("\n👥 Mapping accounts...");
  const accounts = mapAccounts(blocks);
  console.log(`   Total unique accounts: ${accounts.totalAccounts}`);
  console.log(`   Mint recipients: ${accounts.mintRecipients.length}`);
  console.log(`   Burn senders: ${accounts.burnSenders.length}`);
  console.log(`   Transfer participants: ${accounts.transferParticipants.length}`);
  console.log(`   Approval participants: ${accounts.approvalParticipants.length}`);

  // Save results
  console.log("\n💾 Saving results...");
  saveResults(ledgerKey, validation, accounts);

  console.log("\n✅ Processing complete!");
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0] || "all";

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Block Validation & Account Mapping                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nTarget: ${target}`);

  try {
    if (target === "cycleshare" || target === "all") {
      await processLedger("cycleshare");
    }

    if (target === "icdevs" || target === "all") {
      await processLedger("icdevs");
    }

    if (target !== "cycleshare" && target !== "icdevs" && target !== "all") {
      console.error(`\n❌ Unknown target: ${target}`);
      console.error(`   Valid targets: cycleshare, icdevs, all`);
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎉 All processing complete!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Processing failed:", error);
    process.exit(1);
  }
}

main();
