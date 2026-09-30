/// ICRC2/Inspect.mo - Message inspection helpers for ICRC-2 endpoints
///
/// This module provides validation functions to protect against cycle drain attacks
/// through oversized unbounded arguments (Nat, Int, Blob, Text).
///
/// Two-layer protection:
/// 1. `inspect*` functions - return Bool for use in `system func inspect()`
/// 2. `guard*` functions - trap early in functions for inter-canister protection
///
/// Reference: https://motoko-book.dev/advanced-concepts/system-apis/message-inspection.html

import Nat "mo:core/Nat";
import Runtime "mo:core/Runtime";

module {

  /// Configuration for validation size limits
  public type Config = {
    /// Maximum memo size (ICRC-1 standard is 32 bytes)
    maxMemoSize : Nat;
    /// Maximum digits for Nat arguments
    maxNatDigits : Nat;
    /// Subaccount must be exactly 32 bytes or null
    maxSubaccountSize : Nat;
    /// Maximum raw message blob size
    maxRawArgSize : Nat;
    /// Maximum number of allowances to return in get_allowances
    maxTake : Nat;
  };

  /// Default configuration with ICRC-2 standard limits
  public let defaultConfig : Config = {
    maxMemoSize = 32;           // ICRC-1 standard
    maxNatDigits = 40;          // ~2^128, enough for any balance
    maxSubaccountSize = 32;     // Standard subaccount size
    maxRawArgSize = 2048;       // 2KB reasonable max
    maxTake = 1000;             // Reasonable max for get_allowances
  };

  /// Account type matching ICRC-2
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  /// ApproveArgs type matching ICRC-2
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

  /// TransferFromArgs type matching ICRC-2
  public type TransferFromArgs = {
    spender_subaccount : ?Blob;
    from : Account;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  /// AllowanceArgs type matching ICRC-2
  public type AllowanceArgs = {
    account : Account;
    spender : Account;
  };

  /// GetAllowancesArgs type matching ICRC-103/ICRC-130
  public type GetAllowancesArgs = {
    take : ?Nat;
    prev_spender : ?Account;
    from_account : ?Account;
  };

  // ============================================
  // Core Validators (return Bool for inspect)
  // ============================================

  /// Validate memo size
  public func isValidMemo(memo : ?Blob, config : Config) : Bool {
    switch (memo) {
      case (null) true;
      case (?m) m.size() <= config.maxMemoSize;
    };
  };

  /// Validate subaccount size
  public func isValidSubaccount(sub : ?Blob, config : Config) : Bool {
    switch (sub) {
      case (null) true;
      case (?s) s.size() <= config.maxSubaccountSize;
    };
  };

  /// Validate Nat by digit count
  public func isValidNat(n : Nat, config : Config) : Bool {
    Nat.toText(n).size() <= config.maxNatDigits;
  };

  /// Validate optional Nat
  public func isValidOptNat(n : ?Nat, config : Config) : Bool {
    switch (n) {
      case (null) true;
      case (?val) isValidNat(val, config);
    };
  };

  /// Validate account
  public func isValidAccount(account : Account, config : Config) : Bool {
    isValidSubaccount(account.subaccount, config);
  };

  /// Validate optional account
  public func isValidOptAccount(account : ?Account, config : Config) : Bool {
    switch (account) {
      case (null) true;
      case (?a) isValidAccount(a, config);
    };
  };

  // ============================================
  // ICRC-2 Endpoint Validators
  // ============================================

  /// Validate icrc2_approve arguments
  public func inspectApprove(args : ApproveArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.from_subaccount, cfg)) return false;
    if (not isValidAccount(args.spender, cfg)) return false;
    if (not isValidNat(args.amount, cfg)) return false;
    if (not isValidOptNat(args.expected_allowance, cfg)) return false;
    if (not isValidOptNat(args.fee, cfg)) return false;
    if (not isValidMemo(args.memo, cfg)) return false;
    
    true;
  };

  /// Validate icrc2_transfer_from arguments
  public func inspectTransferFrom(args : TransferFromArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.spender_subaccount, cfg)) return false;
    if (not isValidAccount(args.from, cfg)) return false;
    if (not isValidAccount(args.to, cfg)) return false;
    if (not isValidNat(args.amount, cfg)) return false;
    if (not isValidOptNat(args.fee, cfg)) return false;
    if (not isValidMemo(args.memo, cfg)) return false;
    
    true;
  };

  /// Validate icrc2_allowance arguments
  public func inspectAllowance(args : AllowanceArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidAccount(args.account, cfg)) return false;
    if (not isValidAccount(args.spender, cfg)) return false;
    
    true;
  };

  /// Validate icrc103_get_allowances / icrc130_get_allowances arguments
  public func inspectGetAllowances(args : GetAllowancesArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    // Validate take limit
    switch (args.take) {
      case (null) {};
      case (?t) {
        if (t > cfg.maxTake) return false;
      };
    };
    
    if (not isValidOptAccount(args.prev_spender, cfg)) return false;
    if (not isValidOptAccount(args.from_account, cfg)) return false;
    
    true;
  };

  // ============================================
  // Guard Functions (trap on invalid)
  // ============================================

  /// Guard icrc2_approve - traps if validation fails
  public func guardApprove(args : ApproveArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.from_subaccount, cfg)) {
      Runtime.trap("ICRC2: from_subaccount too large");
    };
    if (not isValidAccount(args.spender, cfg)) {
      Runtime.trap("ICRC2: spender.subaccount too large");
    };
    if (not isValidNat(args.amount, cfg)) {
      Runtime.trap("ICRC2: amount too large");
    };
    if (not isValidOptNat(args.expected_allowance, cfg)) {
      Runtime.trap("ICRC2: expected_allowance too large");
    };
    if (not isValidOptNat(args.fee, cfg)) {
      Runtime.trap("ICRC2: fee too large");
    };
    if (not isValidMemo(args.memo, cfg)) {
      Runtime.trap("ICRC2: memo too large (max " # Nat.toText(cfg.maxMemoSize) # " bytes)");
    };
  };

  /// Guard icrc2_transfer_from - traps if validation fails
  public func guardTransferFrom(args : TransferFromArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.spender_subaccount, cfg)) {
      Runtime.trap("ICRC2: spender_subaccount too large");
    };
    if (not isValidAccount(args.from, cfg)) {
      Runtime.trap("ICRC2: from.subaccount too large");
    };
    if (not isValidAccount(args.to, cfg)) {
      Runtime.trap("ICRC2: to.subaccount too large");
    };
    if (not isValidNat(args.amount, cfg)) {
      Runtime.trap("ICRC2: amount too large");
    };
    if (not isValidOptNat(args.fee, cfg)) {
      Runtime.trap("ICRC2: fee too large");
    };
    if (not isValidMemo(args.memo, cfg)) {
      Runtime.trap("ICRC2: memo too large (max " # Nat.toText(cfg.maxMemoSize) # " bytes)");
    };
  };

  /// Guard icrc2_allowance - traps if validation fails
  public func guardAllowance(args : AllowanceArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidAccount(args.account, cfg)) {
      Runtime.trap("ICRC2: account.subaccount too large");
    };
    if (not isValidAccount(args.spender, cfg)) {
      Runtime.trap("ICRC2: spender.subaccount too large");
    };
  };

  /// Guard icrc103_get_allowances / icrc130_get_allowances - traps if validation fails
  public func guardGetAllowances(args : GetAllowancesArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    switch (args.take) {
      case (null) {};
      case (?t) {
        if (t > cfg.maxTake) {
          Runtime.trap("ICRC2: take too large (max " # Nat.toText(cfg.maxTake) # ")");
        };
      };
    };
    if (not isValidOptAccount(args.prev_spender, cfg)) {
      Runtime.trap("ICRC2: prev_spender.subaccount too large");
    };
    if (not isValidOptAccount(args.from_account, cfg)) {
      Runtime.trap("ICRC2: from_account.subaccount too large");
    };
  };

  // ============================================
  // Utility Functions
  // ============================================

  /// Create a config with custom limits
  public func configWith(overrides : {
    maxMemoSize : ?Nat;
    maxNatDigits : ?Nat;
    maxSubaccountSize : ?Nat;
    maxRawArgSize : ?Nat;
    maxTake : ?Nat;
  }) : Config {
    {
      maxMemoSize = switch (overrides.maxMemoSize) { case (?v) v; case (null) defaultConfig.maxMemoSize };
      maxNatDigits = switch (overrides.maxNatDigits) { case (?v) v; case (null) defaultConfig.maxNatDigits };
      maxSubaccountSize = switch (overrides.maxSubaccountSize) { case (?v) v; case (null) defaultConfig.maxSubaccountSize };
      maxRawArgSize = switch (overrides.maxRawArgSize) { case (?v) v; case (null) defaultConfig.maxRawArgSize };
      maxTake = switch (overrides.maxTake) { case (?v) v; case (null) defaultConfig.maxTake };
    };
  };

};
