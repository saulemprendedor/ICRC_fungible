import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Subaccount],
}
export interface AdvancedSettings {
  'existing_balances' : Array<[Account, Balance]>,
  'burned_tokens' : Balance,
  'fee_collector_emitted' : boolean,
  'minted_tokens' : Balance,
  'local_transactions' : Array<Transaction>,
  'fee_collector_block' : bigint,
}
export interface AdvancedSettings__1 {
  'existing_approvals' : Array<[[Account, Account], ApprovalInfo]>,
}
export interface Allowance {
  'allowance' : bigint,
  'expires_at' : [] | [bigint],
}
export interface AllowanceArgs { 'account' : Account, 'spender' : Account }
export interface ApprovalInfo {
  'from_subaccount' : [] | [Uint8Array | number[]],
  'amount' : bigint,
  'expires_at' : [] | [bigint],
  'spender' : Account,
}
export interface ApproveArgs {
  'fee' : [] | [bigint],
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
  'expected_allowance' : [] | [bigint],
  'expires_at' : [] | [bigint],
  'spender' : Account,
}
export type ApproveError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'TemporarilyUnavailable' : null } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'BadFee' : { 'expected_fee' : bigint } } |
  { 'AllowanceChanged' : { 'current_allowance' : bigint } } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'TooOld' : null } |
  { 'Expired' : { 'ledger_time' : bigint } } |
  { 'InsufficientFunds' : { 'balance' : bigint } };
export type ApproveResponse = { 'Ok' : bigint } |
  { 'Err' : ApproveError };
export interface ArchivedTransactionResponse {
  'args' : Array<TransactionRange>,
  'callback' : [Principal, string],
}
export type Balance = bigint;
export interface BalanceQueryArgs { 'accounts' : Array<Account> }
export type BalanceQueryResult = Array<bigint>;
export interface BlockType { 'url' : string, 'block_type' : string }
export interface Burn {
  'from' : Account,
  'memo' : [] | [Memo],
  'created_at_time' : [] | [Timestamp],
  'amount' : Balance,
}
export interface BurnArgs {
  'memo' : [] | [Memo],
  'from_subaccount' : [] | [Subaccount],
  'created_at_time' : [] | [Timestamp],
  'amount' : Balance,
}
export interface DataCertificate {
  'certificate' : Uint8Array | number[],
  'hash_tree' : Uint8Array | number[],
}
export type Fee = { 'Environment' : null } |
  { 'Fixed' : bigint };
export type Fee__1 = { 'ICRC1' : null } |
  { 'Environment' : null } |
  { 'Fixed' : bigint };
export interface GetArchivesArgs { 'from' : [] | [Principal] }
export type GetArchivesResult = Array<GetArchivesResultItem>;
export interface GetArchivesResultItem {
  'end' : bigint,
  'canister_id' : Principal,
  'start' : bigint,
}
export type GetBlocksArgs = Array<TransactionRange>;
export interface GetBlocksResult {
  'log_length' : bigint,
  'blocks' : Array<{ 'id' : bigint, 'block' : Value__1 }>,
  'archived_blocks' : Array<ArchivedTransactionResponse>,
}
export type GetTransactionsFn = ActorMethod<
  [Array<TransactionRange>],
  GetTransactionsResult
>;
export interface GetTransactionsResult {
  'log_length' : bigint,
  'blocks' : Array<{ 'id' : bigint, 'block' : Value__1 }>,
  'archived_blocks' : Array<ArchivedTransactionResponse>,
}
export type IndexType = { 'Stable' : null } |
  { 'StableTyped' : null } |
  { 'Managed' : null };
export interface InitArgs {
  'fee' : [] | [Fee],
  'advanced_settings' : [] | [AdvancedSettings],
  'max_memo' : [] | [bigint],
  'decimals' : number,
  'metadata' : [] | [Value],
  'minting_account' : [] | [Account],
  'logo' : [] | [string],
  'permitted_drift' : [] | [Timestamp],
  'name' : [] | [string],
  'settle_to_accounts' : [] | [bigint],
  'fee_collector' : [] | [Account],
  'transaction_window' : [] | [Timestamp],
  'min_burn_amount' : [] | [Balance],
  'max_supply' : [] | [Balance],
  'max_accounts' : [] | [bigint],
  'symbol' : [] | [string],
}
export interface InitArgs__1 {
  'fee' : [] | [Fee__1],
  'advanced_settings' : [] | [AdvancedSettings__1],
  'max_allowance' : [] | [MaxAllowance],
  'max_approvals' : [] | [bigint],
  'max_approvals_per_account' : [] | [bigint],
  'settle_to_approvals' : [] | [bigint],
}
export interface InitArgs__2 {
  'maxRecordsToArchive' : bigint,
  'archiveIndexType' : IndexType,
  'maxArchivePages' : bigint,
  'settleToRecords' : bigint,
  'archiveCycles' : bigint,
  'maxActiveRecords' : bigint,
  'maxRecordsInArchiveInstance' : bigint,
  'archiveControllers' : [] | [[] | [Array<Principal>]],
  'supportedBlocks' : Array<BlockType>,
}
export interface InitArgs__3 {
  'fee' : [] | [Fee__1],
  'max_balances' : [] | [bigint],
  'max_transfers' : [] | [bigint],
}
export type MaxAllowance = { 'TotalSupply' : null } |
  { 'Fixed' : bigint };
export type Memo = Uint8Array | number[];
export type MetaDatum = [string, Value];
export interface Mint {
  'to' : Account,
  'memo' : [] | [Memo],
  'created_at_time' : [] | [Timestamp],
  'amount' : Balance,
}
export type Subaccount = Uint8Array | number[];
export interface SupportedStandard { 'url' : string, 'name' : string }
export type Timestamp = bigint;
export interface Tip {
  'last_block_index' : Uint8Array | number[],
  'hash_tree' : Uint8Array | number[],
  'last_block_hash' : Uint8Array | number[],
}
export interface TokenWithICRC85 {
  'admin_update_owner' : ActorMethod<[Principal], boolean>,
  'burn' : ActorMethod<[BurnArgs], TransferResult>,
  'calculate_cycles_to_share' : ActorMethod<[], [bigint, bigint]>,
  'deposit_cycles' : ActorMethod<[], undefined>,
  'get_icrc85_stats' : ActorMethod<
    [],
    {
      'activeActions' : bigint,
      'nextCycleActionId' : [] | [bigint],
      'lastActionReported' : [] | [bigint],
    }
  >,
  'get_owner' : ActorMethod<[], Principal>,
  'get_tip' : ActorMethod<[], Tip>,
  'icrc1_balance_of' : ActorMethod<[Account], Balance>,
  'icrc1_decimals' : ActorMethod<[], number>,
  'icrc1_fee' : ActorMethod<[], Balance>,
  'icrc1_metadata' : ActorMethod<[], Array<MetaDatum>>,
  'icrc1_minting_account' : ActorMethod<[], [] | [Account]>,
  'icrc1_name' : ActorMethod<[], string>,
  'icrc1_supported_standards' : ActorMethod<[], Array<SupportedStandard>>,
  'icrc1_symbol' : ActorMethod<[], string>,
  'icrc1_total_supply' : ActorMethod<[], Balance>,
  'icrc1_transfer' : ActorMethod<[TransferArgs], TransferResult>,
  'icrc2_allowance' : ActorMethod<[AllowanceArgs], Allowance>,
  'icrc2_approve' : ActorMethod<[ApproveArgs], ApproveResponse>,
  'icrc2_transfer_from' : ActorMethod<[TransferFromArgs], TransferFromResponse>,
  'icrc3_get_archives' : ActorMethod<[GetArchivesArgs], GetArchivesResult>,
  'icrc3_get_blocks' : ActorMethod<[GetBlocksArgs], GetBlocksResult>,
  'icrc3_get_tip_certificate' : ActorMethod<[], [] | [DataCertificate]>,
  'icrc3_supported_block_types' : ActorMethod<[], Array<BlockType>>,
  'icrc4_balance_of_batch' : ActorMethod<
    [BalanceQueryArgs],
    BalanceQueryResult
  >,
  'icrc4_maximum_query_batch_size' : ActorMethod<[], [] | [bigint]>,
  'icrc4_maximum_update_batch_size' : ActorMethod<[], [] | [bigint]>,
  'icrc4_transfer_batch' : ActorMethod<
    [TransferBatchArgs],
    TransferBatchResults
  >,
  'mint' : ActorMethod<[Mint], TransferResult>,
  'trigger_icrc85_share' : ActorMethod<[], undefined>,
}
export interface Transaction {
  'burn' : [] | [Burn],
  'kind' : string,
  'mint' : [] | [Mint],
  'timestamp' : Timestamp,
  'index' : TxIndex,
  'transfer' : [] | [Transfer],
}
export interface TransactionRange { 'start' : bigint, 'length' : bigint }
export interface Transfer {
  'to' : Account,
  'fee' : [] | [Balance],
  'from' : Account,
  'memo' : [] | [Memo],
  'created_at_time' : [] | [Timestamp],
  'amount' : Balance,
}
export interface TransferArgs {
  'to' : Account,
  'fee' : [] | [Balance],
  'memo' : [] | [Memo],
  'from_subaccount' : [] | [Subaccount],
  'created_at_time' : [] | [Timestamp],
  'amount' : Balance,
}
export type TransferBatchArgs = Array<TransferArgs>;
export type TransferBatchError = { 'TooManyRequests' : { 'limit' : bigint } } |
  { 'GenericError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TemporarilyUnavailable' : null } |
  { 'BadBurn' : { 'min_burn_amount' : bigint } } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'BadFee' : { 'expected_fee' : bigint } } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null } |
  { 'InsufficientFunds' : { 'balance' : bigint } };
export type TransferBatchResult = { 'Ok' : bigint } |
  { 'Err' : TransferBatchError };
export type TransferBatchResults = Array<[] | [TransferBatchResult]>;
export type TransferError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'TemporarilyUnavailable' : null } |
  { 'BadBurn' : { 'min_burn_amount' : Balance } } |
  { 'Duplicate' : { 'duplicate_of' : TxIndex } } |
  { 'BadFee' : { 'expected_fee' : Balance } } |
  { 'CreatedInFuture' : { 'ledger_time' : Timestamp } } |
  { 'TooOld' : null } |
  { 'InsufficientFunds' : { 'balance' : Balance } };
export interface TransferFromArgs {
  'to' : Account,
  'fee' : [] | [bigint],
  'spender_subaccount' : [] | [Uint8Array | number[]],
  'from' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
}
export type TransferFromError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'TemporarilyUnavailable' : null } |
  { 'InsufficientAllowance' : { 'allowance' : bigint } } |
  { 'BadBurn' : { 'min_burn_amount' : bigint } } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'BadFee' : { 'expected_fee' : bigint } } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'TooOld' : null } |
  { 'InsufficientFunds' : { 'balance' : bigint } };
export type TransferFromResponse = { 'Ok' : bigint } |
  { 'Err' : TransferFromError };
export type TransferResult = { 'Ok' : TxIndex } |
  { 'Err' : TransferError };
export type TxIndex = bigint;
export type Value = { 'Int' : bigint } |
  { 'Map' : Array<[string, Value]> } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<Value> };
export type Value__1 = { 'Int' : bigint } |
  { 'Map' : Array<[string, Value__1]> } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<Value__1> };
/**
 * / Token with ICRC-85 cycle sharing enabled for testing
 * / This variant of the token has ICRC-85 OVS configured to share cycles
 * / with a configurable collector canister.
 */
export interface _SERVICE extends TokenWithICRC85 {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
