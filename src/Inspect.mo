/// Inspect.mo - Shared validation module for message inspection and guards
///
/// This module provides validation functions to protect against cycle drain attacks
/// through oversized unbounded arguments (Nat, Int, Blob, Text).
///
/// Two-layer protection:
/// 1. `inspect` system function - rejects malformed ingress calls before execution
/// 2. Guard functions - trap early in functions to protect inter-canister calls
///
/// Reference: https://motoko-book.dev/advanced-concepts/system-apis/message-inspection.html

import Blob "mo:core/Blob";
import Debug "mo:core/Debug";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";

module {

  /// Configuration for validation size limits
  /// All sizes are in bytes unless otherwise noted
  public type Config = {
    /// Maximum memo size (ICRC-1 standard is 32 bytes)
    maxMemoSize : Nat;
    /// Maximum size for general Blob arguments
    maxBlobArgSize : Nat;
    /// Maximum size for Text arguments
    maxTextArgSize : Nat;
    /// Maximum digits for Nat/Int arguments (prevents huge numbers)
    maxNatDigits : Nat;
    /// Maximum array length for batch operations
    maxArrayLength : Nat;
    /// Subaccount must be exactly 32 bytes or null
    maxSubaccountSize : Nat;
    /// Maximum raw message blob size (checked first, cheapest)
    maxRawArgSize : Nat;
  };

  /// Default configuration with sensible limits
  public let defaultConfig : Config = {
    maxMemoSize = 32;           // ICRC-1 standard
    maxBlobArgSize = 1024;      // 1KB
    maxTextArgSize = 1024;      // 1KB  
    maxNatDigits = 40;          // ~2^128, enough for any balance
    maxArrayLength = 10000;     // Reasonable batch limit
    maxSubaccountSize = 32;     // Standard subaccount size
    maxRawArgSize = 10_000_000; // 10MB max raw message
  };

  /// Validation result type
  public type ValidationResult = {
    #ok;
    #reject : Text;
  };

  // ============================================
  // Core Validators
  // ============================================

  /// Validate a memo blob
  /// Memos must be null or <= maxMemoSize bytes
  public func validateMemo(memo : ?Blob, config : Config) : ValidationResult {
    switch (memo) {
      case (null) #ok;
      case (?m) {
        if (m.size() > config.maxMemoSize) {
          #reject("Memo too large: " # Nat.toText(m.size()) # " bytes, max " # Nat.toText(config.maxMemoSize));
        } else {
          #ok;
        };
      };
    };
  };

  /// Validate a subaccount blob
  /// Subaccounts must be null or exactly 32 bytes (or <= maxSubaccountSize for flexibility)
  public func validateSubaccount(sub : ?Blob, config : Config) : ValidationResult {
    switch (sub) {
      case (null) #ok;
      case (?s) {
        if (s.size() > config.maxSubaccountSize) {
          #reject("Subaccount too large: " # Nat.toText(s.size()) # " bytes, max " # Nat.toText(config.maxSubaccountSize));
        } else {
          #ok;
        };
      };
    };
  };

  /// Validate a Nat value by checking its digit count
  /// This prevents attacks using astronomically large numbers
  public func validateNat(n : Nat, config : Config) : ValidationResult {
    let digits = Nat.toText(n).size();
    if (digits > config.maxNatDigits) {
      #reject("Nat too large: " # Nat.toText(digits) # " digits, max " # Nat.toText(config.maxNatDigits));
    } else {
      #ok;
    };
  };

  /// Validate an Int value by checking its digit count
  public func validateInt(i : Int, config : Config) : ValidationResult {
    let digits = Int.toText(i).size();
    // Account for potential negative sign
    let effectiveDigits = if (i < 0) { digits - 1 } else { digits };
    if (effectiveDigits > config.maxNatDigits) {
      #reject("Int too large: " # Nat.toText(effectiveDigits) # " digits, max " # Nat.toText(config.maxNatDigits));
    } else {
      #ok;
    };
  };

  /// Validate a Text value by checking its size
  public func validateText(t : Text, config : Config) : ValidationResult {
    if (t.size() > config.maxTextArgSize) {
      #reject("Text too large: " # Nat.toText(t.size()) # " bytes, max " # Nat.toText(config.maxTextArgSize));
    } else {
      #ok;
    };
  };

  /// Validate a Blob value by checking its size
  public func validateBlob(b : Blob, config : Config) : ValidationResult {
    if (b.size() > config.maxBlobArgSize) {
      #reject("Blob too large: " # Nat.toText(b.size()) # " bytes, max " # Nat.toText(config.maxBlobArgSize));
    } else {
      #ok;
    };
  };

  /// Validate array length for batch operations
  public func validateArrayLength<T>(arr : [T], config : Config) : ValidationResult {
    if (arr.size() > config.maxArrayLength) {
      #reject("Array too large: " # Nat.toText(arr.size()) # " elements, max " # Nat.toText(config.maxArrayLength));
    } else {
      #ok;
    };
  };

  /// Validate raw argument blob size (cheapest check, do first)
  public func validateRawArg(arg : Blob, config : Config) : ValidationResult {
    if (arg.size() > config.maxRawArgSize) {
      #reject("Raw argument too large: " # Nat.toText(arg.size()) # " bytes, max " # Nat.toText(config.maxRawArgSize));
    } else {
      #ok;
    };
  };

  // ============================================
  // Compound Validators
  // ============================================

  /// Standard Account type for validation
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  /// Validate an account (owner + optional subaccount)
  public func validateAccount(account : Account, config : Config) : ValidationResult {
    // Principal validation is implicit (bounded by protocol)
    // Only need to validate subaccount
    validateSubaccount(account.subaccount, config);
  };

  /// Validate an optional Nat
  public func validateOptNat(n : ?Nat, config : Config) : ValidationResult {
    switch (n) {
      case (null) #ok;
      case (?val) validateNat(val, config);
    };
  };

  /// Validate an optional Nat64 (convert to Nat for validation)
  public func validateOptNat64(n : ?Nat64, config : Config) : ValidationResult {
    switch (n) {
      case (null) #ok;
      case (?val) validateNat(Nat64.toNat(val), config);
    };
  };

  /// Validate an optional Blob
  public func validateOptBlob(b : ?Blob, config : Config) : ValidationResult {
    switch (b) {
      case (null) #ok;
      case (?val) validateBlob(val, config);
    };
  };

  // ============================================
  // Combined Validation
  // ============================================

  /// Run multiple validations and return first failure or #ok
  public func validateAll(checks : [ValidationResult]) : ValidationResult {
    for (check in checks.vals()) {
      switch (check) {
        case (#reject(reason)) { return #reject(reason) };
        case (#ok) {};
      };
    };
    #ok;
  };

  /// Convert ValidationResult to Bool for inspect functions
  public func isValid(result : ValidationResult) : Bool {
    switch (result) {
      case (#ok) true;
      case (#reject(_)) false;
    };
  };

  // ============================================
  // Guard Functions
  // ============================================

  /// Guard function - traps with error message if validation fails
  /// Use at the beginning of public functions to protect against inter-canister attacks
  public func guard(result : ValidationResult) : () {
    switch (result) {
      case (#ok) {};
      case (#reject(reason)) {
        Runtime.trap("Validation failed: " # reason);
      };
    };
  };

  /// Guard with custom prefix for better error identification
  public func guardWithPrefix(prefix : Text, result : ValidationResult) : () {
    switch (result) {
      case (#ok) {};
      case (#reject(reason)) {
        Runtime.trap(prefix # ": " # reason);
      };
    };
  };

  // ============================================
  // Utility Functions
  // ============================================

  /// Create a config with custom overrides
  public func configWith(overrides : {
    maxMemoSize : ?Nat;
    maxBlobArgSize : ?Nat;
    maxTextArgSize : ?Nat;
    maxNatDigits : ?Nat;
    maxArrayLength : ?Nat;
    maxSubaccountSize : ?Nat;
    maxRawArgSize : ?Nat;
  }) : Config {
    {
      maxMemoSize = switch (overrides.maxMemoSize) { case (?v) v; case (null) defaultConfig.maxMemoSize };
      maxBlobArgSize = switch (overrides.maxBlobArgSize) { case (?v) v; case (null) defaultConfig.maxBlobArgSize };
      maxTextArgSize = switch (overrides.maxTextArgSize) { case (?v) v; case (null) defaultConfig.maxTextArgSize };
      maxNatDigits = switch (overrides.maxNatDigits) { case (?v) v; case (null) defaultConfig.maxNatDigits };
      maxArrayLength = switch (overrides.maxArrayLength) { case (?v) v; case (null) defaultConfig.maxArrayLength };
      maxSubaccountSize = switch (overrides.maxSubaccountSize) { case (?v) v; case (null) defaultConfig.maxSubaccountSize };
      maxRawArgSize = switch (overrides.maxRawArgSize) { case (?v) v; case (null) defaultConfig.maxRawArgSize };
    };
  };

  /// Get the default config (convenience function)
  public func getDefaultConfig() : Config {
    defaultConfig;
  };

  // ============================================
  // Debug Helpers
  // ============================================

  /// Get a human-readable description of validation failure
  public func describeResult(result : ValidationResult) : Text {
    switch (result) {
      case (#ok) "Valid";
      case (#reject(reason)) "Invalid: " # reason;
    };
  };

};
