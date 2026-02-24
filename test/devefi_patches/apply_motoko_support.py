#!/usr/bin/env python3
"""
Apply patches to common.ts for Motoko ICRC_fungible ledger support.
This script modifies the devefi_ledger_tests to support the PanIndustrial Motoko token.
"""
import re
import sys

DEVEFI_DIR = '/tmp/devefi_ledger_tests'
COMMON_TS_PATH = f'{DEVEFI_DIR}/common.ts'

def main():
    # Read the file
    try:
        with open(COMMON_TS_PATH, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Error: {COMMON_TS_PATH} not found. Make sure devefi_ledger_tests is cloned.")
        sys.exit(1)

    original_length = len(content)
    patches_applied = 0

    # 1. Add Motoko import after ICP ledger import
    import_pattern = r"(import \{ _SERVICE as ICPLedgerService.*?from ['\"]\.\/icp_ledger\/ledger\.idl['\"];?)"
    import_replacement = r"""\1
// Motoko ICRC_fungible ledger support
import { idlFactory as MotokoLedgerIdlFactory, init as motokoInit } from './icrc_ledger/motoko_ledger.idl.js';"""
    
    if re.search(import_pattern, content, re.DOTALL):
        if 'MotokoLedgerIdlFactory' not in content:
            content = re.sub(import_pattern, import_replacement, content, flags=re.DOTALL)
            patches_applied += 1
            print("✓ Added Motoko import statement")
        else:
            print("○ Motoko import already present")
    else:
        print("✗ Could not find ICPLedgerService import pattern")

    # 2. Add LEDGER_IMPL after LEDGER_TYPE export
    ledger_type_pattern = r'(export const LEDGER_TYPE\s*=\s*process\.env\[[\'"]LEDGER_TYPE[\'"]\]\s*as\s*["\']icrc["\'].*?;)'
    ledger_impl_code = """
// Support for multiple ledger implementations: "dfinity" (default) or "motoko"
export const LEDGER_IMPL = process.env['LEDGER'] as "dfinity" | "motoko" | undefined;"""

    if re.search(ledger_type_pattern, content, re.DOTALL):
        if 'LEDGER_IMPL' not in content:
            content = re.sub(ledger_type_pattern, r'\1' + ledger_impl_code, content, flags=re.DOTALL)
            patches_applied += 1
            print("✓ Added LEDGER_IMPL export")
        else:
            print("○ LEDGER_IMPL already present")
    else:
        print("✗ Could not find LEDGER_TYPE export pattern")

    # 3. Update WASM path section to use gzipped WASM for Motoko
    # Look for the existing motoko WASM path setup
    wasm_pattern = r'let ICRC_WASM_PATH\s*=\s*resolve\(__dirname,\s*["\']\.\/icrc_ledger\/ledger\.wasm["\']\);[\s\S]*?if\s*\(process\.env\[[\'"]LEDGER[\'"]\]\s*===\s*["\']motoko["\']\)\s*\{[\s\S]*?ICRC_WASM_PATH\s*=\s*resolve\(__dirname,\s*["\']\.\/icrc_ledger\/motoko_ledger\.wasm["\']\);[\s\S]*?\}'
    
    wasm_new = '''let ICRC_WASM_PATH = resolve(__dirname, "./icrc_ledger/ledger.wasm");
let MOTOKO_WASM_PATH = resolve(__dirname, "./icrc_ledger/motoko_ledger.wasm.gz");

if (LEDGER_IMPL === "motoko") {
    console.log("🚀🦀 USING MOTOKO LEDGER - BRACE FOR IMPACT! 💥🦑");
}'''

    if re.search(wasm_pattern, content, re.DOTALL):
        if 'MOTOKO_WASM_PATH' not in content:
            content = re.sub(wasm_pattern, wasm_new, content, flags=re.DOTALL)
            patches_applied += 1
            print("✓ Updated WASM path section to use .wasm.gz")
        else:
            print("○ MOTOKO_WASM_PATH already present")
    else:
        print("✗ Could not find WASM path pattern")

    # 4. Add get_motoko_args function after get_args function
    get_motoko_args_fn = '''

// Init args for Motoko ICRC_fungible token (PanIndustrial)
function get_motoko_args(me: Principal): any {
    // Note: outer [[{...}]] because init arg is opt(record)
    // [value] = Some, [] = None for opt types
    const initArgs: any = [[{
        icrc1: [{
            fee: [{ Fixed: 10000n }],
            advanced_settings: [] as never[],
            max_memo: [80n],
            decimals: 8,
            metadata: [] as never[],
            minting_account: [{ owner: me, subaccount: [] as never[] }],
            logo: [] as never[],
            permitted_drift: [] as never[],
            name: ["Test Coin"],
            settle_to_accounts: [] as never[],
            fee_collector: [] as never[],
            transaction_window: [] as never[],
            min_burn_amount: [] as never[],
            max_supply: [] as never[],
            max_accounts: [] as never[],
            symbol: ["tCOIN"],
        }],
        icrc2: [{
            fee: [{ ICRC1: null as null }],
            advanced_settings: [] as never[],
            max_allowance: [{ TotalSupply: null as null }],
            max_approvals: [10_000_000n],
            max_approvals_per_account: [10_000n],
            settle_to_approvals: [9_990_000n],
        }],
        icrc3: {
            maxRecordsToArchive: 3000n,
            archiveIndexType: { Stable: null as null },
            maxArchivePages: 62500n,
            settleToRecords: 2000n,
            archiveCycles: 2_000_000_000_000n,
            maxActiveRecords: 4000n,
            maxRecordsInArchiveInstance: 10_000_000n,
            archiveControllers: [] as never[],
            supportedBlocks: [
                { block_type: "1burn", url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
                { block_type: "1mint", url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
                { block_type: "2approve", url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
                { block_type: "1xfer", url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
                { block_type: "2xfer", url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
            ],
        },
        icrc4: [{
            fee: [{ ICRC1: null as null }],
            max_balances: [200n],
            max_transfers: [200n],
        }],
    }]];
    return initArgs;
}'''

    # Find the end of get_args function and add get_motoko_args after it
    get_args_pattern = r'(function get_args\(me:\s*Principal\)[\s\S]*?return ledger_args;\s*\})'
    
    if re.search(get_args_pattern, content):
        if 'get_motoko_args' not in content:
            content = re.sub(get_args_pattern, r'\1' + get_motoko_args_fn, content)
            patches_applied += 1
            print("✓ Added get_motoko_args function")
        else:
            print("○ get_motoko_args already present")
    else:
        print("✗ Could not find get_args function pattern")

    # 5. Replace ICRCLedger function to support Motoko
    icrc_ledger_pattern = r'export async function ICRCLedger\(pic:\s*PocketIc,\s*me:\s*Principal,\s*subnet:\s*Principal\s*\|\s*undefined\)\s*\{[\s\S]*?const fixture = await pic\.setupCanister<ICRCLedgerService>\(\{[\s\S]*?idlFactory:\s*ICRCLedgerIdlFactory,[\s\S]*?wasm:\s*ICRC_WASM_PATH,[\s\S]*?arg:\s*IDL\.encode\(icrcInit\(\{IDL\}\),\s*\[get_args\(me\)\]\),[\s\S]*?\}\);[\s\S]*?await pic\.addCycles[\s\S]*?return \{[\s\S]*?canisterId:.*?fixture\.canisterId,[\s\S]*?actor:.*?fixture\.actor.*?ICRCLedgerService>[\s\S]*?\};[\s\S]*?\};'
    
    new_icrc_ledger = '''export async function ICRCLedger(pic: PocketIc, me:Principal, subnet:Principal | undefined) {
    // Use Motoko ICRC_fungible ledger with its own init format
    if (LEDGER_IMPL === "motoko") {
        const fixture = await pic.setupCanister<ICRCLedgerService>({
            //@ts-ignore - MotokoLedgerIdlFactory has compatible interface
            idlFactory: MotokoLedgerIdlFactory,
            wasm: MOTOKO_WASM_PATH,
            arg: IDL.encode(motokoInit({ IDL }), get_motoko_args(me)),
            ...subnet ? { targetSubnetId: subnet } : {},
        });
        await pic.addCycles(fixture.canisterId, 100_000_000_000_000_000);
        
        // Return with DFINITY-compatible IDL factory for middleware compatibility
        const proxyActor = pic.createActor<ICRCLedgerService>(ICRCLedgerIdlFactory, fixture.canisterId);
        return {
            canisterId: fixture.canisterId,
            actor: proxyActor
        };
    }

    // Default: Use DFINITY ICRC ledger
    const fixture = await pic.setupCanister<ICRCLedgerService>({
        idlFactory: ICRCLedgerIdlFactory,
        wasm: ICRC_WASM_PATH,
        arg: IDL.encode(icrcInit({IDL}), [get_args(me)]),
        ...subnet?{targetSubnetId: subnet}:{},
    });

    await pic.addCycles(fixture.canisterId, 100_000_000_000_000_000);   
    
    return {
        canisterId: fixture.canisterId,
        actor: fixture.actor as Actor<ICRCLedgerService>
    };
};'''

    if re.search(icrc_ledger_pattern, content):
        if 'LEDGER_IMPL === "motoko"' not in content:
            content = re.sub(icrc_ledger_pattern, new_icrc_ledger, content)
            patches_applied += 1
            print("✓ Updated ICRCLedger function")
        else:
            print("○ ICRCLedger already patched")
    else:
        print("✗ Could not find ICRCLedger function pattern")

    # 6. Update ICRCLedgerUpgrade
    upgrade_pattern = r'export async function ICRCLedgerUpgrade\(pic:\s*PocketIc,\s*me:\s*Principal,\s*canister_id:\s*Principal,\s*subnet:\s*Principal\s*\|\s*undefined\)\s*\{[\s\S]*?await pic\.upgradeCanister\(\{[\s\S]*?canisterId:\s*canister_id,[\s\S]*?wasm:\s*ICRC_WASM_PATH,[\s\S]*?\}\);[\s\S]*?\}'
    
    new_upgrade = '''export async function ICRCLedgerUpgrade(pic: PocketIc, me:Principal, canister_id:Principal, subnet:Principal | undefined) {
    if (LEDGER_IMPL === "motoko") {
        // Motoko ledger upgrade with null args to keep existing state
        await pic.upgradeCanister({
            canisterId: canister_id,
            wasm: MOTOKO_WASM_PATH,
            arg: IDL.encode(motokoInit({ IDL }), [[]])
        });
    } else {
        // DFINITY ledger upgrade
        await pic.upgradeCanister({ canisterId: canister_id, wasm: ICRC_WASM_PATH, arg: IDL.encode(icrcInit({ IDL }), [{Upgrade: []}]) });
    }
}'''

    if re.search(upgrade_pattern, content):
        if 'LEDGER_IMPL === "motoko"' not in content or '"motoko"' not in content.split('ICRCLedgerUpgrade')[1].split('export')[0]:
            content = re.sub(upgrade_pattern, new_upgrade, content)
            patches_applied += 1
            print("✓ Updated ICRCLedgerUpgrade function")
        else:
            print("○ ICRCLedgerUpgrade already patched")
    else:
        print("✗ Could not find ICRCLedgerUpgrade function pattern")

    # Write the file
    with open(COMMON_TS_PATH, 'w') as f:
        f.write(content)

    print(f"\n{'='*50}")
    print(f"Applied {patches_applied} patch(es)")
    print(f"File size: {original_length} -> {len(content)} bytes")
    
    if patches_applied > 0 or 'LEDGER_IMPL' in content:
        print("✓ Patches applied successfully!")
        return 0
    else:
        print("✗ No patches applied - file may already be patched or patterns have changed")
        return 1

if __name__ == '__main__':
    sys.exit(main())
