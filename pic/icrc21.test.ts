/**
 * ICRC-21 PIC Tests
 * 
 * Tests the ICRC-21 (Canister Call Consent Messages) implementation:
 * 1. GenericDisplay consent message for icrc1_transfer
 * 2. FieldsDisplay consent message for icrc1_transfer
 * 3. GenericDisplay consent message for icrc2_approve
 * 4. FieldsDisplay consent message for icrc2_transfer_from
 * 5. GenericDisplay consent message for icrc4_transfer_batch
 * 6. GenericDisplay consent message for icrc107_set_fee_collector
 * 7. Unsupported method returns UnsupportedCanisterCall error
 * 8. Invalid arg blob returns UnsupportedCanisterCall error
 * 9. Unsupported language returns GenericError
 * 10. Default device_spec (absent) falls back to GenericDisplay
 * 11. Anonymous caller can call consent message endpoint
 * 12. ICRC-21 is in supported standards
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer, SubnetStateType } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Ed25519KeyIdentity } from '@dfinity/identity';

const TOKEN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');

// =============== IDL Types for ICRC-21 ===============

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

// -- ICRC-21 types --

const ConsentMessageMetadata = IDL.Record({
  language: IDL.Text,
  utc_offset_minutes: IDL.Opt(IDL.Int16),
});

const ConsentMessageSpec = IDL.Record({
  metadata: ConsentMessageMetadata,
  device_spec: IDL.Opt(IDL.Variant({
    GenericDisplay: IDL.Null,
    FieldsDisplay: IDL.Null,
  })),
});

const ConsentMessageRequest = IDL.Record({
  method: IDL.Text,
  arg: IDL.Vec(IDL.Nat8),
  user_preferences: ConsentMessageSpec,
});

const DisplayValue = IDL.Variant({
  TokenAmount: IDL.Record({ decimals: IDL.Nat8, amount: IDL.Nat64, symbol: IDL.Text }),
  TimestampSeconds: IDL.Record({ amount: IDL.Nat64 }),
  DurationSeconds: IDL.Record({ amount: IDL.Nat64 }),
  Text: IDL.Record({ content: IDL.Text }),
});

const ConsentMessage = IDL.Variant({
  GenericDisplayMessage: IDL.Text,
  FieldsDisplayMessage: IDL.Record({
    intent: IDL.Text,
    fields: IDL.Vec(IDL.Tuple(IDL.Text, DisplayValue)),
  }),
});

const ErrorInfo = IDL.Record({
  description: IDL.Text,
});

const ConsentInfo = IDL.Record({
  consent_message: ConsentMessage,
  metadata: ConsentMessageMetadata,
});

const Icrc21Error = IDL.Variant({
  UnsupportedCanisterCall: ErrorInfo,
  ConsentMessageUnavailable: ErrorInfo,
  InsufficientPayment: ErrorInfo,
  GenericError: IDL.Record({ error_code: IDL.Nat, description: IDL.Text }),
});

const ConsentMessageResponse = IDL.Variant({
  Ok: ConsentInfo,
  Err: Icrc21Error,
});

const StandardType = IDL.Record({
  name: IDL.Text,
  url: IDL.Text,
});

// =============== Arg encoding types ===============
// These must match the candid types expected by each method.

const TransferArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
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

const TransferFromArgs = IDL.Record({
  spender_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from: Account,
  to: Account,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});

const BatchTransferArgs = IDL.Vec(TransferArgs);

const SetFeeCollectorArgs = IDL.Record({
  fee_collector: IDL.Opt(Account),
  created_at_time: IDL.Nat64,
});

// =============== Token Init ===============

function buildTokenInitTypes(IDL: typeof import('@icp-sdk/core/candid').IDL) {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const Fee = IDL.Variant({
    Environment: IDL.Null,
    Fixed: IDL.Nat,
    ICRC1: IDL.Null,
  });

  const MaxAllowance = IDL.Variant({
    TotalSupply: IDL.Null,
    Fixed: IDL.Nat,
  });

  const ArchiveIndexType = IDL.Variant({
    Stable: IDL.Null,
    StableTyped: IDL.Null,
    Managed: IDL.Null,
  });

  const BlockTypeInit = IDL.Record({
    block_type: IDL.Text,
    url: IDL.Text,
  });

  const Value = IDL.Rec();
  Value.fill(
    IDL.Variant({
      Int: IDL.Int,
      Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
      Nat: IDL.Nat,
      Blob: IDL.Vec(IDL.Nat8),
      Text: IDL.Text,
      Array: IDL.Vec(Value),
    })
  );

  const Transaction = IDL.Record({
    burn: IDL.Opt(IDL.Record({
      from: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
    kind: IDL.Text,
    mint: IDL.Opt(IDL.Record({
      to: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
    timestamp: IDL.Nat64,
    index: IDL.Nat,
    transfer: IDL.Opt(IDL.Record({
      to: Account,
      fee: IDL.Opt(IDL.Nat),
      from: Account,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
      amount: IDL.Nat,
    })),
  });

  const AdvancedSettings = IDL.Record({
    existing_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    burned_tokens: IDL.Nat,
    fee_collector_emitted: IDL.Bool,
    minted_tokens: IDL.Nat,
    local_transactions: IDL.Vec(Transaction),
    fee_collector_block: IDL.Nat,
  });

  const ICRC1InitArgs = IDL.Record({
    name: IDL.Opt(IDL.Text),
    symbol: IDL.Opt(IDL.Text),
    logo: IDL.Opt(IDL.Text),
    decimals: IDL.Nat8,
    fee: IDL.Opt(Fee),
    minting_account: IDL.Opt(Account),
    max_supply: IDL.Opt(IDL.Nat),
    min_burn_amount: IDL.Opt(IDL.Nat),
    max_memo: IDL.Opt(IDL.Nat),
    advanced_settings: IDL.Opt(AdvancedSettings),
    metadata: IDL.Opt(Value),
    fee_collector: IDL.Opt(Account),
    transaction_window: IDL.Opt(IDL.Nat64),
    permitted_drift: IDL.Opt(IDL.Nat64),
    max_accounts: IDL.Opt(IDL.Nat),
    settle_to_accounts: IDL.Opt(IDL.Nat),
  });

  const ICRC2InitArgs = IDL.Record({
    max_approvals_per_account: IDL.Opt(IDL.Nat),
    max_allowance: IDL.Opt(MaxAllowance),
    fee: IDL.Opt(Fee),
    advanced_settings: IDL.Opt(IDL.Null),
    max_approvals: IDL.Opt(IDL.Nat),
    settle_to_approvals: IDL.Opt(IDL.Nat),
  });

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

  const FullInitArgs = IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(ICRC1InitArgs),
    icrc2: IDL.Opt(ICRC2InitArgs),
    icrc3: ICRC3InitArgs,
    icrc4: IDL.Opt(ICRC4InitArgs),
    icrc85_collector: IDL.Opt(IDL.Principal),
  }));

  return FullInitArgs;
}

// =============== Helpers ===============

function createIdentity(seed: number): Ed25519KeyIdentity {
  const seedArray = new Uint8Array(32);
  seedArray[0] = seed;
  return Ed25519KeyIdentity.generate(seedArray);
}

function defaultTokenArgs() {
  return [{
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
    icrc4: [{
      max_balances: [BigInt(100)],
      max_transfers: [BigInt(100)],
      fee: [],
    }],
    icrc85_collector: [],
  }];
}

/** Encode a candid value to a Uint8Array (arg blob) */
function encodeArg(type: IDL.Type, value: any): number[] {
  const encoded = IDL.encode([type], [value]);
  return Array.from(new Uint8Array(encoded));
}

// =============== Test Suite ===============

describe('ICRC-21 Consent Message Tests', () => {
  let pic: PocketIc;
  let picServer: PocketIcServer;
  let tokenCanisterId: Principal;
  const admin = createIdentity(30);
  const alice = createIdentity(31);

  beforeAll(async () => {
    if (!existsSync(TOKEN_WASM_PATH)) {
      throw new Error(`Token WASM not found at ${TOKEN_WASM_PATH}. Run 'dfx build token' first.`);
    }

    picServer = await PocketIcServer.start();
    pic = await PocketIc.create(picServer.getUrl(), {
      application: [{ state: { type: SubnetStateType.New } }],
    });

    const tokenWasm = readFileSync(TOKEN_WASM_PATH);
    const TokenInitType = buildTokenInitTypes(IDL);

    tokenCanisterId = await pic.createCanister({
      sender: admin.getPrincipal(),
    });
    await pic.addCycles(tokenCanisterId, 100_000_000_000_000n);

    await pic.installCode({
      canisterId: tokenCanisterId,
      wasm: tokenWasm,
      arg: IDL.encode([TokenInitType], [defaultTokenArgs()]),
      sender: admin.getPrincipal(),
    });

    await pic.tick(10);
  }, 60_000);

  afterAll(async () => {
    if (pic) await pic.tearDown();
    if (picServer) await picServer.stop();
  });

  // Helper to call icrc21_canister_call_consent_message
  async function requestConsent(
    method: string,
    argBlob: number[],
    opts?: {
      sender?: Principal;
      deviceSpec?: { GenericDisplay: null } | { FieldsDisplay: null } | null;
      language?: string;
    },
  ) {
    const sender = opts?.sender ?? admin.getPrincipal();
    const language = opts?.language ?? 'en';
    const deviceSpec = opts?.deviceSpec === undefined ? [{ GenericDisplay: null }] : (opts?.deviceSpec === null ? [] : [opts.deviceSpec]);

    const result = await pic.updateCall({
      canisterId: tokenCanisterId,
      method: 'icrc21_canister_call_consent_message',
      arg: IDL.encode([ConsentMessageRequest], [{
        method,
        arg: argBlob,
        user_preferences: {
          metadata: {
            language,
            utc_offset_minutes: [],
          },
          device_spec: deviceSpec,
        },
      }]),
      sender,
    });

    return IDL.decode([ConsentMessageResponse], result)[0] as any;
  }

  // ---- Test 1: GenericDisplay consent for icrc1_transfer ----
  it('should return GenericDisplay consent for icrc1_transfer', async () => {
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(100_000_000), // 1.0 TTT (8 decimals)
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('icrc1_transfer', argBlob);

    expect(result).toHaveProperty('Ok');
    const consentInfo = result.Ok;
    expect(consentInfo.metadata.language).toBe('en');
    expect(consentInfo.consent_message).toHaveProperty('GenericDisplayMessage');
    const msg = consentInfo.consent_message.GenericDisplayMessage;
    expect(msg).toContain('Transfer');
    expect(msg).toContain('TTT');
    expect(msg).toContain('1');
    expect(msg).toContain('Fee');
  });

  // ---- Test 2: FieldsDisplay consent for icrc1_transfer ----
  it('should return FieldsDisplay consent for icrc1_transfer', async () => {
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(250_000_000), // 2.5 TTT
      fee: [],
      memo: [[1, 2, 3]],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('icrc1_transfer', argBlob, {
      deviceSpec: { FieldsDisplay: null },
    });

    expect(result).toHaveProperty('Ok');
    const consentInfo = result.Ok;
    expect(consentInfo.consent_message).toHaveProperty('FieldsDisplayMessage');
    const fields = consentInfo.consent_message.FieldsDisplayMessage;
    expect(fields.intent).toContain('2.5');
    expect(fields.intent).toContain('TTT');
    // Should have 4 fields: Amount, To, Fee, Memo
    expect(fields.fields.length).toBe(4);
    // First field should be Amount
    expect(fields.fields[0][0]).toBe('Amount');
    expect(fields.fields[0][1]).toHaveProperty('TokenAmount');
  });

  // ---- Test 3: GenericDisplay consent for icrc2_approve ----
  it('should return GenericDisplay consent for icrc2_approve', async () => {
    const approveArgs = {
      from_subaccount: [],
      spender: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(500_000_000), // 5.0 TTT
      expected_allowance: [],
      expires_at: [],
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(ApproveArgs, approveArgs);
    const result = await requestConsent('icrc2_approve', argBlob);

    expect(result).toHaveProperty('Ok');
    const msg = result.Ok.consent_message.GenericDisplayMessage;
    expect(msg).toContain('Approve');
    expect(msg).toContain('Allowance');
    expect(msg).toContain('5');
    expect(msg).toContain('TTT');
    expect(msg).toContain('Spender');
  });

  // ---- Test 4: FieldsDisplay consent for icrc2_transfer_from ----
  it('should return FieldsDisplay consent for icrc2_transfer_from', async () => {
    const xferFromArgs = {
      spender_subaccount: [],
      from: { owner: admin.getPrincipal(), subaccount: [] },
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(300_000_000), // 3.0 TTT
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferFromArgs, xferFromArgs);
    const result = await requestConsent('icrc2_transfer_from', argBlob, {
      deviceSpec: { FieldsDisplay: null },
    });

    expect(result).toHaveProperty('Ok');
    const fields = result.Ok.consent_message.FieldsDisplayMessage;
    expect(fields.intent).toContain('Transfer');
    expect(fields.intent).toContain('3');
    // Should have: Amount, From, To, Fee
    expect(fields.fields.length).toBe(4);
    expect(fields.fields[0][0]).toBe('Amount');
    expect(fields.fields[1][0]).toBe('From');
    expect(fields.fields[2][0]).toBe('To');
    expect(fields.fields[3][0]).toBe('Fee');
  });

  // ---- Test 5: GenericDisplay consent for icrc4_transfer_batch ----
  it('should return GenericDisplay consent for icrc4_transfer_batch', async () => {
    const batchArgs = [
      {
        from_subaccount: [],
        to: { owner: alice.getPrincipal(), subaccount: [] },
        amount: BigInt(100_000_000),
        fee: [],
        memo: [],
        created_at_time: [],
      },
      {
        from_subaccount: [],
        to: { owner: admin.getPrincipal(), subaccount: [] },
        amount: BigInt(200_000_000),
        fee: [],
        memo: [],
        created_at_time: [],
      },
    ];
    const argBlob = encodeArg(BatchTransferArgs, batchArgs);
    const result = await requestConsent('icrc4_transfer_batch', argBlob);

    expect(result).toHaveProperty('Ok');
    const msg = result.Ok.consent_message.GenericDisplayMessage;
    expect(msg).toContain('Batch');
    expect(msg).toContain('2'); // 2 transfers
    expect(msg).toContain('3'); // 3.0 total (1+2)
    expect(msg).toContain('TTT');
  });

  // ---- Test 6: GenericDisplay consent for icrc107_set_fee_collector ----
  it('should return GenericDisplay consent for icrc107_set_fee_collector', async () => {
    const feeColArgs = {
      fee_collector: [{ owner: alice.getPrincipal(), subaccount: [] }],
      created_at_time: BigInt(Date.now()) * 1_000_000n,
    };
    const argBlob = encodeArg(SetFeeCollectorArgs, feeColArgs);
    const result = await requestConsent('icrc107_set_fee_collector', argBlob);

    expect(result).toHaveProperty('Ok');
    const msg = result.Ok.consent_message.GenericDisplayMessage;
    expect(msg).toContain('Fee Collector');
    expect(msg).toContain(alice.getPrincipal().toText());
  });

  // ---- Test 7: Unsupported method returns error ----
  it('should return UnsupportedCanisterCall for unknown method', async () => {
    // Pass a valid candid blob (encoded empty record) so the candid header check passes
    // and we reach the method routing
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(100_000_000),
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('nonexistent_method', argBlob);

    expect(result).toHaveProperty('Err');
    expect(result.Err).toHaveProperty('UnsupportedCanisterCall');
    expect(result.Err.UnsupportedCanisterCall.description).toContain('nonexistent_method');
  });

  // ---- Test 8: Invalid arg blob returns error ----
  it('should return error for invalid arg blob', async () => {
    const result = await requestConsent('icrc1_transfer', [0, 1, 2, 3]);

    expect(result).toHaveProperty('Err');
    expect(result.Err).toHaveProperty('UnsupportedCanisterCall');
    expect(result.Err.UnsupportedCanisterCall.description).toContain('decode');
  });

  // ---- Test 9: Unsupported language returns GenericError ----
  it('should return GenericError for unsupported language', async () => {
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(100_000_000),
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('icrc1_transfer', argBlob, {
      language: 'fr',
    });

    expect(result).toHaveProperty('Err');
    expect(result.Err).toHaveProperty('GenericError');
    expect(result.Err.GenericError.description).toContain('Unsupported language');
  });

  // ---- Test 10: Default device_spec (null) => GenericDisplay ----
  it('should fallback to GenericDisplay when device_spec is absent', async () => {
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(100_000_000),
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('icrc1_transfer', argBlob, {
      deviceSpec: null,
    });

    expect(result).toHaveProperty('Ok');
    expect(result.Ok.consent_message).toHaveProperty('GenericDisplayMessage');
  });

  // ---- Test 11: Anonymous caller can call consent endpoint ----
  it('should allow anonymous callers', async () => {
    const transferArgs = {
      from_subaccount: [],
      to: { owner: alice.getPrincipal(), subaccount: [] },
      amount: BigInt(100_000_000),
      fee: [],
      memo: [],
      created_at_time: [],
    };
    const argBlob = encodeArg(TransferArgs, transferArgs);
    const result = await requestConsent('icrc1_transfer', argBlob, {
      sender: Principal.anonymous(),
    });

    expect(result).toHaveProperty('Ok');
    expect(result.Ok.consent_message).toHaveProperty('GenericDisplayMessage');
  });

  // ---- Test 12: ICRC-21 is in supported standards ----
  it('should include ICRC-21 in supported standards', async () => {
    const result = await pic.queryCall({
      canisterId: tokenCanisterId,
      method: 'icrc10_supported_standards',
      arg: IDL.encode([], []),
      sender: admin.getPrincipal(),
    });

    const standards = IDL.decode([IDL.Vec(StandardType)], result)[0] as any[];
    const icrc21 = standards.find((s: any) => s.name === 'ICRC-21');
    expect(icrc21).toBeDefined();
    expect(icrc21.url).toContain('ICRC-21');
  });
});
