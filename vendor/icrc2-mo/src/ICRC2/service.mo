module {
  public type Account = {
        owner : Principal;
        subaccount : ?Subaccount;
  };

  public type Subaccount = Blob;

  public type ApproveArgs = {
      from_subaccount : ?Blob;
      spender : Account;
      amount : Nat;
      expected_allowance : ?Nat;
      expires_at : ?Nat64;
      fee : ?Nat;
      memo : ?Blob;
      created_at_time : ?Nat64;
  };

  public type ApproveError = {
      #BadFee :  { expected_fee : Nat };
      // The caller does not have enough funds to pay the approval fee.
      #InsufficientFunds :  { balance : Nat };
      // The caller specified the [expected_allowance] field, and the current
      // allowance did not match the given value.
      #AllowanceChanged :  { current_allowance : Nat };
      // The approval request expired before the ledger had a chance to apply it.
      #Expired :  { ledger_time : Nat64; };
      #TooOld;
      #CreatedInFuture:  { ledger_time : Nat64 };
      #Duplicate :  { duplicate_of : Nat };
      #TemporarilyUnavailable;
      #GenericError :  { error_code : Nat; message : Text };
  };

  public type TransferFromError =  {
      #BadFee :  { expected_fee : Nat };
      #BadBurn :  { min_burn_amount : Nat };
      // The [from] account does not hold enough funds for the transfer.
      #InsufficientFunds :  { balance : Nat };
      // The caller exceeded its allowance.
      #InsufficientAllowance :  { allowance : Nat };
      #TooOld;
      #CreatedInFuture:  { ledger_time : Nat64 };
      #Duplicate :  { duplicate_of : Nat };
      #TemporarilyUnavailable;
      #GenericError :  { error_code : Nat; message : Text };
  };

  public type TransferFromArgs =  {
      spender_subaccount : ?Blob;
      from : Account;
      to : Account;
      amount : Nat;
      fee : ?Nat;
      memo : ?Blob;
      created_at_time : ?Nat64;
  };

  public type AllowanceArgs =  {
      account : Account;
      spender : Account;
  };

  public type Allowance =  {
    allowance : Nat;
    expires_at : ?Nat64;
  };

  public type AllowanceDetail = {
    from_account : Account;
    to_spender : Account;
    allowance : Nat;
    expires_at : ?Nat64;
  };

  public type GetAllowancesArgs = {
    take : ?Nat;
    prev_spender : ?Account;
    from_account : ?Account;
  };

  public type AllowanceResult = { #Ok : [AllowanceDetail]; #Err : GetAllowancesError };

  public type GetAllowancesError = {
    #GenericError : { message : Text; error_code : Nat };
    #AccessDenied : { reason : Text };
  };

  /// Fee type for ledger info
  public type Fee = {
    #Fixed: Nat;
    #Environment;
    #ICRC1;
  };

  /// MaxAllowance type for ledger info
  public type MaxAllowance = {
    #Fixed: Nat;
    #TotalSupply;
  };

  /// Shared ledger configuration (for query responses)
  public type LedgerInfoShared = {
    max_approvals_per_account : Nat;
    max_approvals : Nat;
    max_allowance : ?MaxAllowance;
    settle_to_approvals : Nat;
    fee : Fee;
    cleanup_interval : ?Nat;
    cleanup_on_zero_balance : ?Bool;
    icrc103_max_take_value : Nat;
    icrc103_public_allowances : Bool;
  };

  /// Statistics about the ICRC-2 ledger state
  public type Stats = {
    ledger_info : LedgerInfoShared;
    token_approvals_count : Nat;
    indexes: {
      spender_to_approval_account_count : Nat;
      owner_to_approval_account_count : Nat;
    };
  };


  public type service = actor {
    icrc2_approve : (ApproveArgs) -> async ({ #Ok : Nat; #Err : ApproveError });
    icrc2_transfer_from : (TransferFromArgs) -> async  { #Ok : Nat; #Err : TransferFromError };
    icrc2_allowance : query (AllowanceArgs) -> async (Allowance);
    icrc103_get_allowances : shared query GetAllowancesArgs -> async AllowanceResult;
    icrc2_get_stats : shared query () -> async Stats;
    
  };
};