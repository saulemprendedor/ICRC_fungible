/**
 * Token Timer Auto-Initialization Verification Tests
 * 
 * Tests that ICRC-85 timer is auto-initialized via ClassPlus pattern.
 * No manual init_icrc85_timer call is needed - the timer starts automatically
 * when using the Init() pattern instead of InitDirect().
 * 
 * Note: The regular Token and Token Mixin use InitDirect which bypasses
 * ClassPlus initialization, so they won't have ICRC-85 timers scheduled.
 * TokenWithICRC85 uses the proper Init() pattern with ClassPlus.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const TOKEN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token/token.wasm.gz');
const MIXIN_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token-mixin/token-mixin.wasm.gz');
const ICRC85_WASM_PATH = resolve(__dirname, '../.dfx/local/canisters/token_icrc85/token_icrc85.wasm.gz');

// Token Canister IDL (ICRC-85 timer is now auto-initialized)
const tokenIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const ICRC85Stats = IDL.Record({
    activeActions: IDL.Nat,
    lastActionReported: IDL.Opt(IDL.Nat),
    nextCycleActionId: IDL.Opt(IDL.Nat),
  });

  return IDL.Service({
    get_icrc85_stats: IDL.Func([], [ICRC85Stats], ['query']),
    deposit_cycles: IDL.Func([], [], []), 
  });
};

function buildInitArgs(IDL: typeof import('@icp-sdk/core/candid').IDL) {
  const InitArgs = IDL.Opt(IDL.Record({
    icrc1: IDL.Opt(IDL.Record({
        name: IDL.Opt(IDL.Text),
        symbol: IDL.Opt(IDL.Text),
        decimals: IDL.Nat8,
        fee: IDL.Opt(IDL.Variant({ Fixed: IDL.Nat, Environment: IDL.Null })),
        max_supply: IDL.Opt(IDL.Nat),
        min_burn_amount: IDL.Opt(IDL.Nat),
        minting_account: IDL.Opt(IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })),
        advanced_settings: IDL.Opt(IDL.Record({
            burned_tokens_holder: IDL.Opt(IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })),
            uc_burn_rate: IDL.Opt(IDL.Nat),
        })),
        metadata: IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, IDL.Record({ 
            'Int' : IDL.Int, 
            'Nat' : IDL.Nat, 
            'Blob' : IDL.Vec(IDL.Nat8), 
            'Text' : IDL.Text 
        })))), 
        fee_collector: IDL.Opt(IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })),
        transaction_window: IDL.Opt(IDL.Nat64),
        permitted_drift: IDL.Opt(IDL.Nat64),
        max_accounts: IDL.Opt(IDL.Nat),
        settle_to_accounts: IDL.Opt(IDL.Nat),
    })),
    icrc2: IDL.Opt(IDL.Record({
        max_approvals: IDL.Opt(IDL.Nat),
        max_approvals_per_account: IDL.Opt(IDL.Nat),
        settle_to_approvals: IDL.Opt(IDL.Nat),
        max_allowance: IDL.Opt(IDL.Variant({ Fixed: IDL.Nat, TotalSupply: IDL.Null })),
        fee: IDL.Opt(IDL.Variant({ ICRC1: IDL.Null, Fixed: IDL.Nat, Environment: IDL.Null })),
        advanced_settings: IDL.Opt(IDL.Record({ dummy: IDL.Null })),
    })),
    icrc3: IDL.Record({
        maxActiveRecords: IDL.Nat,
        settleToRecords: IDL.Nat,
        maxRecordsInArchiveInstance: IDL.Nat,
        maxArchivePages: IDL.Nat,
        archiveIndexType: IDL.Variant({ Stable: IDL.Null, StableTyped: IDL.Null }),
        maxRecordsToArchive: IDL.Nat,
        archiveCycles: IDL.Nat,
        supportedBlocks: IDL.Vec(IDL.Record({ block_type: IDL.Text, url: IDL.Text })),
        archiveControllers: IDL.Opt(IDL.Vec(IDL.Principal)),
    }),
    icrc4: IDL.Opt(IDL.Record({
        max_balances: IDL.Opt(IDL.Nat),
        max_transfers: IDL.Opt(IDL.Nat),
        fee: IDL.Opt(IDL.Variant({ ICRC1: IDL.Null, Fixed: IDL.Nat, Environment: IDL.Null })),
    }))
  }));
  return InitArgs;
}

describe('Token Timer Auto-Initialization Verification', () => {
    let pic: PocketIc;
    let server: PocketIcServer;

    beforeAll(async () => {
        server = await PocketIcServer.start();
        pic = await PocketIc.create(server.getUrl());
    });

    afterAll(async () => {
        await pic.tearDown();
        await server.stop();
    });

    const runTest = async (wasmPath: string, label: string, expectsTimerScheduled: boolean) => {
        it(`should auto-initialize ICRC-85 timer in ${label}`, async () => {
            if (!existsSync(wasmPath)) {
                console.error(`ERROR: WASM file not found at ${wasmPath}`);
                throw new Error(`WASM not found: ${wasmPath}. Run 'dfx build' first.`);
            }
            const wasmBuffer = readFileSync(wasmPath);
            console.log(`Loaded ${label} WASM: ${wasmBuffer.length} bytes`);

            const initArgsType = buildInitArgs(IDL);
            
            // Construct minimal valid Record for initialization
            const initRec = {
                icrc1: [], // None - use defaults
                icrc2: [], // None - use defaults
                icrc3: { // Required - not optional
                    maxActiveRecords: 3000n,
                    settleToRecords: 2000n,
                    maxRecordsInArchiveInstance: 500000n,
                    maxArchivePages: 62500n,
                    archiveIndexType: { Stable: null },
                    maxRecordsToArchive: 8000n,
                    archiveCycles: 20000000000000n,
                    supportedBlocks: [],
                    archiveControllers: []
                },
                icrc4: [] // None - use defaults
            };
            
            const encodedArgs = IDL.encode([initArgsType], [[initRec]]);

            const fixture = await pic.setupCanister({
                idlFactory: tokenIdlFactory,
                wasm: wasmBuffer,
                arg: encodedArgs,
            });

            const actor = fixture.actor as {
                get_icrc85_stats: () => Promise<{
                    activeActions: bigint;
                    lastActionReported: [] | [bigint];
                    nextCycleActionId: [] | [bigint];
                }>;
            };

            // Allow time for ClassPlus auto-initialization to complete
            // The timer is set up automatically during canister initialization
            await pic.advanceTime(1000);
            await pic.tick();
            await pic.tick();
            await pic.tick();
            await pic.tick();

            // Check stats - the stats endpoint should work
            const stats = await actor.get_icrc85_stats();
            console.log(`${label} Stats after auto-init:`, stats);

            // Verify stats structure is correct
            expect(stats.activeActions).toBeDefined();
            expect(stats.nextCycleActionId).toBeDefined();
            expect(stats.lastActionReported).toBeDefined();
            
            if (expectsTimerScheduled) {
                // Tokens using Init() pattern with ClassPlus should have ICRC-85 timer scheduled
                // ICRC-85 schedules timers by default for: ICRC-1, ICRC-3, TimerTool, and potentially index.mo
                expect(stats.nextCycleActionId.length).toBeGreaterThanOrEqual(1);
                console.log(`✅ ${label}: ICRC-85 timer scheduled (action ID: ${stats.nextCycleActionId[0]})`);
            } else {
                // Legacy tokens using InitDirect() bypass ClassPlus, so no ICRC-85 timers are scheduled
                // All production tokens should use Init() pattern
                expect(stats.nextCycleActionId.length).toBe(0);
                console.log(`✅ ${label}: No ICRC-85 timer (using InitDirect - legacy pattern)`);
            }
        });
    };

    // All tokens now use Init() pattern with ClassPlus - ICRC-85 timers should be scheduled
    runTest(TOKEN_WASM_PATH, 'Token (Clean)', true);
    runTest(MIXIN_WASM_PATH, 'Token Mixin', true);
    // TokenWithICRC85 uses Init() pattern with ClassPlus - ICRC-85 timer should be scheduled
    runTest(ICRC85_WASM_PATH, 'TokenWithICRC85', true);
});

