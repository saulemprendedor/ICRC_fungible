/// ICRC3/Inspect.mo - Message inspection helpers for ICRC-3 endpoints
///
/// This module provides validation functions to protect against cycle drain attacks
/// through oversized unbounded arguments (Nat, Int, Blob, Text, arrays).
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
    /// Maximum digits for Nat arguments
    maxNatDigits : Nat;
    /// Maximum number of transaction ranges in a request
    maxRangesPerRequest : Nat;
    /// Maximum length per range (prevents requesting too many blocks)
    maxLengthPerRange : Nat;
    /// Maximum total blocks across all ranges
    maxTotalBlocks : Nat;
    /// Maximum raw message blob size
    maxRawArgSize : Nat;
  };

  /// Default configuration with sensible limits
  public let defaultConfig : Config = {
    maxNatDigits = 40;          // ~2^128, enough for any block index
    maxRangesPerRequest = 100;  // Reasonable number of ranges
    maxLengthPerRange = 10000;  // Max blocks per range
    maxTotalBlocks = 100000;    // Max total blocks per request
    maxRawArgSize = 10240;      // 10KB reasonable for range requests
  };

  /// TransactionRange type matching ICRC-3
  public type TransactionRange = {
    start : Nat;
    length : Nat;
  };

  /// GetBlocksArgs type matching ICRC-3
  public type GetBlocksArgs = [TransactionRange];

  /// GetArchivesArgs type matching ICRC-3
  public type GetArchivesArgs = {
    from : ?Principal;
  };

  /// Legacy get_blocks/get_transactions args
  public type LegacyBlocksArgs = {
    start : Nat;
    length : Nat;
  };

  // ============================================
  // Core Validators (return Bool for inspect)
  // ============================================

  /// Validate Nat by digit count
  public func isValidNat(n : Nat, config : Config) : Bool {
    Nat.toText(n).size() <= config.maxNatDigits;
  };

  /// Validate a single TransactionRange
  public func isValidRange(range : TransactionRange, config : Config) : Bool {
    if (not isValidNat(range.start, config)) return false;
    if (range.length > config.maxLengthPerRange) return false;
    true;
  };

  // ============================================
  // ICRC-3 Endpoint Validators
  // ============================================

  /// Validate icrc3_get_blocks arguments
  public func inspectGetBlocks(args : GetBlocksArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    // Check array length first
    if (args.size() > cfg.maxRangesPerRequest) return false;
    
    // Validate each range and compute total blocks
    var totalBlocks : Nat = 0;
    for (range in args.vals()) {
      if (not isValidRange(range, cfg)) return false;
      totalBlocks += range.length;
      if (totalBlocks > cfg.maxTotalBlocks) return false;
    };
    
    true;
  };

  /// Validate icrc3_get_archives arguments
  /// The from field is optional Principal - no validation needed
  public func inspectGetArchives(_args : GetArchivesArgs, _config : ?Config) : Bool {
    // Principal is bounded by protocol, no special validation needed
    true;
  };

  /// Validate legacy get_blocks/get_transactions arguments
  public func inspectLegacyBlocks(args : LegacyBlocksArgs, config : ?Config) : Bool {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidNat(args.start, cfg)) return false;
    if (args.length > cfg.maxLengthPerRange) return false;
    
    true;
  };

  // ============================================
  // Guard Functions (trap on invalid)
  // ============================================

  /// Guard icrc3_get_blocks - traps if validation fails
  public func guardGetBlocks(args : GetBlocksArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (args.size() > cfg.maxRangesPerRequest) {
      Runtime.trap("ICRC3: too many ranges (max " # Nat.toText(cfg.maxRangesPerRequest) # ")");
    };
    
    var totalBlocks : Nat = 0;
    var rangeIndex : Nat = 0;
    for (range in args.vals()) {
      if (not isValidNat(range.start, cfg)) {
        Runtime.trap("ICRC3: range[" # Nat.toText(rangeIndex) # "].start too large");
      };
      if (range.length > cfg.maxLengthPerRange) {
        Runtime.trap("ICRC3: range[" # Nat.toText(rangeIndex) # "].length too large (max " # Nat.toText(cfg.maxLengthPerRange) # ")");
      };
      totalBlocks += range.length;
      if (totalBlocks > cfg.maxTotalBlocks) {
        Runtime.trap("ICRC3: total blocks requested too large (max " # Nat.toText(cfg.maxTotalBlocks) # ")");
      };
      rangeIndex += 1;
    };
  };

  /// Guard icrc3_get_archives - traps if validation fails
  public func guardGetArchives(_args : GetArchivesArgs, _config : ?Config) : () {
    // No validation needed for Principal
  };

  /// Guard legacy get_blocks/get_transactions - traps if validation fails
  public func guardLegacyBlocks(args : LegacyBlocksArgs, config : ?Config) : () {
    let cfg = switch (config) { case (?c) c; case (null) defaultConfig };
    
    if (not isValidNat(args.start, cfg)) {
      Runtime.trap("ICRC3: start too large");
    };
    if (args.length > cfg.maxLengthPerRange) {
      Runtime.trap("ICRC3: length too large (max " # Nat.toText(cfg.maxLengthPerRange) # ")");
    };
  };

  // ============================================
  // Utility Functions
  // ============================================

  /// Create a config with custom limits
  public func configWith(overrides : {
    maxNatDigits : ?Nat;
    maxRangesPerRequest : ?Nat;
    maxLengthPerRange : ?Nat;
    maxTotalBlocks : ?Nat;
    maxRawArgSize : ?Nat;
  }) : Config {
    {
      maxNatDigits = switch (overrides.maxNatDigits) { case (?v) v; case (null) defaultConfig.maxNatDigits };
      maxRangesPerRequest = switch (overrides.maxRangesPerRequest) { case (?v) v; case (null) defaultConfig.maxRangesPerRequest };
      maxLengthPerRange = switch (overrides.maxLengthPerRange) { case (?v) v; case (null) defaultConfig.maxLengthPerRange };
      maxTotalBlocks = switch (overrides.maxTotalBlocks) { case (?v) v; case (null) defaultConfig.maxTotalBlocks };
      maxRawArgSize = switch (overrides.maxRawArgSize) { case (?v) v; case (null) defaultConfig.maxRawArgSize };
    };
  };

};
