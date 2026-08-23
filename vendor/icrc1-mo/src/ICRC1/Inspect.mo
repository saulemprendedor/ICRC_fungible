/// ICRC1/Inspect.mo - Message inspection helpers for ICRC-1 endpoints
///
/// This module provides validation functions to protect against cycle drain attacks
/// through oversized unbounded arguments (Nat, Int, Blob, Text).
///
/// Two-layer protection:
/// 1. `inspect*` functions - return Bool for use in `system func inspect()`
/// 2. `guard*` functions - trap early in functions for inter-canister protection
///
/// Reference: https://motoko-book.dev/advanced-concepts/system-apis/message-inspection.html

import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
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
  };

  /// Default configuration with ICRC-1 standard limits
  /// 
  /// Theoretical max TransferArgs size calculation:
  ///   from_subaccount: ?Blob(32) → ~35 bytes
  ///   to.owner: Principal        → ~30 bytes  
  ///   to.subaccount: ?Blob(32)   → ~35 bytes
  ///   amount: Nat(40 digits)     → ~20 bytes
  ///   fee: ?Nat(40 digits)       → ~22 bytes
  ///   memo: ?Blob(32)            → ~35 bytes
  ///   created_at_time: ?Nat64    → ~10 bytes
  ///   Record/method overhead     → ~30 bytes
  ///   TOTAL                      → ~220 bytes (use 256 with margin)
  public let defaultConfig : Config = {
    maxMemoSize = 32;           // ICRC-1 standard
    maxNatDigits = 40;          // ~2^128, enough for any balance
    maxSubaccountSize = 32;     // Standard subaccount size
    maxRawArgSize = 256;        // Theoretical max for single transfer
  };

  /// Account type matching ICRC-1
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  /// TransferArgs type matching ICRC-1
  public type TransferArgs = {
    from_subaccount : ?Blob;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  /// BurnArgs type matching ICRC-1
  public type BurnArgs = {
    from_subaccount : ?Blob;
    amount : Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
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

  /// Validate raw arg blob size
  public func isValidRawArg(arg : Blob, config : Config) : Bool {
    arg.size() <= config.maxRawArgSize;
  };

  // ============================================
  // ICRC-1 Endpoint Validators
  // ============================================

  /// Validate icrc1_transfer arguments
  /// Returns true if valid, false if should reject
  public func inspectTransfer(args : TransferArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    // Check all fields
    if (not isValidSubaccount(args.from_subaccount, cfg)) return false;
    if (not isValidAccount(args.to, cfg)) return false;
    if (not isValidNat(args.amount, cfg)) return false;
    if (not isValidOptNat(args.fee, cfg)) return false;
    if (not isValidMemo(args.memo, cfg)) return false;
    
    true;
  };

  /// Validate icrc1_balance_of arguments
  public func inspectBalanceOf(args : Account, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    isValidAccount(args, cfg);
  };

  /// Validate burn arguments
  public func inspectBurn(args : BurnArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.from_subaccount, cfg)) return false;
    if (not isValidNat(args.amount, cfg)) return false;
    if (not isValidMemo(args.memo, cfg)) return false;
    
    true;
  };

  // ============================================
  // Guard Functions (trap on invalid)
  // ============================================

  /// Guard icrc1_transfer - traps if validation fails
  public func guardTransfer(args : TransferArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.from_subaccount, cfg)) {
      Runtime.trap("ICRC1: from_subaccount too large");
    };
    if (not isValidAccount(args.to, cfg)) {
      Runtime.trap("ICRC1: to.subaccount too large");
    };
    if (not isValidNat(args.amount, cfg)) {
      Runtime.trap("ICRC1: amount too large");
    };
    if (not isValidOptNat(args.fee, cfg)) {
      Runtime.trap("ICRC1: fee too large");
    };
    if (not isValidMemo(args.memo, cfg)) {
      Runtime.trap("ICRC1: memo too large (max " # Nat.toText(cfg.maxMemoSize) # " bytes)");
    };
  };

  /// Guard icrc1_balance_of - traps if validation fails
  public func guardBalanceOf(args : Account, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidAccount(args, cfg)) {
      Runtime.trap("ICRC1: subaccount too large");
    };
  };

  /// Guard burn - traps if validation fails
  public func guardBurn(args : BurnArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidSubaccount(args.from_subaccount, cfg)) {
      Runtime.trap("ICRC1: from_subaccount too large");
    };
    if (not isValidNat(args.amount, cfg)) {
      Runtime.trap("ICRC1: amount too large");
    };
    if (not isValidMemo(args.memo, cfg)) {
      Runtime.trap("ICRC1: memo too large (max " # Nat.toText(cfg.maxMemoSize) # " bytes)");
    };
  };

  // ============================================
  // Utility Functions
  // ============================================

  /// Create a config with custom max memo size
  public func configWithMaxMemo(maxMemo : Nat) : Config {
    { defaultConfig with maxMemoSize = maxMemo };
  };

  /// Create a config with custom limits
  public func configWith(overrides : {
    maxMemoSize : ?Nat;
    maxNatDigits : ?Nat;
    maxSubaccountSize : ?Nat;
    maxRawArgSize : ?Nat;
  }) : Config {
    {
      maxMemoSize = switch (overrides.maxMemoSize) { case (?v) v; case (null) defaultConfig.maxMemoSize };
      maxNatDigits = switch (overrides.maxNatDigits) { case (?v) v; case (null) defaultConfig.maxNatDigits };
      maxSubaccountSize = switch (overrides.maxSubaccountSize) { case (?v) v; case (null) defaultConfig.maxSubaccountSize };
      maxRawArgSize = switch (overrides.maxRawArgSize) { case (?v) v; case (null) defaultConfig.maxRawArgSize };
    };
  };

  // ============================================
  // ICRC-107 / ICRC-106 / ICRC-21 Validators
  // ============================================

  /// SetFeeCollectorArgs type for validation
  public type SetFeeCollectorArgs = {
    fee_collector : ?Account;
    created_at_time : Nat64;
  };

  /// Validate icrc107_set_fee_collector arguments
  public func inspectSetFeeCollector(args : SetFeeCollectorArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    switch (args.fee_collector) {
      case (?acct) isValidAccount(acct, cfg);
      case (null) true;
    };
  };

  /// Guard icrc107_set_fee_collector - traps if validation fails
  public func guardSetFeeCollector(args : SetFeeCollectorArgs, config : ?Config) : () {
    if (not inspectSetFeeCollector(args, config)) {
      Runtime.trap("ICRC107: fee_collector subaccount too large");
    };
  };

  /// ConsentMessageRequest type for validation
  public type ConsentMessageRequest = {
    method : Text;
    arg : Blob;
    user_preferences : {
      metadata : { language : Text; utc_offset_minutes : ?Int16 };
      device_spec : ?{ #GenericDisplay; #FieldsDisplay };
    };
  };

  /// Maximum arg blob size for consent messages (generous limit for batch transfers)
  public let maxConsentArgSize : Nat = 65536; // 64KB

  /// Validate icrc21_canister_call_consent_message arguments
  public func inspectConsentMessage(args : ConsentMessageRequest, _config : ?Config) : Bool {
    // The arg blob could be large for batch transfers, limit to 64KB
    args.arg.size() <= maxConsentArgSize and args.method.size() <= 256;
  };

  /// Guard icrc21_canister_call_consent_message - traps if validation fails
  public func guardConsentMessage(args : ConsentMessageRequest, config : ?Config) : () {
    if (not inspectConsentMessage(args, config)) {
      Runtime.trap("ICRC21: consent message request too large");
    };
  };

};
