// Script to verify ICRC-21 consent message works on local canister
// Uses @dfinity/agent to make the call and decode response

import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import fetch from 'node-fetch';

// Polyfill fetch for node environment
(global as any).fetch = fetch;

const CANISTER_ID = 'br5f7-7uaaa-aaaaa-qaaca-cai'; // From previous deployment
const HOST = 'http://127.0.0.1:8080';

// Initialize agent
const agent = new HttpAgent({ host: HOST });

// Fetch root key since it's local
agent.fetchRootKey().catch(err => {
  console.warn("Unable to fetch root key. Is the replica running?");
  console.error(err);
});

// IDL for Token (simplified for consent message)
const idlFactory = ({ IDL }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const TransferArgs = IDL.Record({
    to: Account,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
    amount: IDL.Nat,
  });
  
  // Consent Types
  const DisplayValue = IDL.Variant({
    TokenAmount: IDL.Record({ decimals: IDL.Nat8, amount: IDL.Nat64, symbol: IDL.Text }),
    TimestampSeconds: IDL.Record({ amount: IDL.Nat64 }),
    DurationSeconds: IDL.Record({ amount: IDL.Nat64 }),
    Text: IDL.Record({ content: IDL.Text }),
  });

  const Message = IDL.Variant({
    GenericDisplayMessage: IDL.Text,
    FieldsDisplayMessage: IDL.Record({
      intent: IDL.Text,
      fields: IDL.Vec(IDL.Tuple(IDL.Text, DisplayValue)),
    }),
  });

  const ConsentInfo = IDL.Record({
    consent_message: Message,
    metadata: IDL.Record({
      language: IDL.Text,
      utc_offset_minutes: IDL.Opt(IDL.Int16),
    }),
  });
  
  const ErrorInfo = IDL.Record({ description: IDL.Text });
  
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
  
  const DeviceSpec = IDL.Record({ 
    generic_display : IDL.Opt(IDL.Null), // Simplified
    fields_display : IDL.Opt(IDL.Null) // Simplified
  });
  
  const ConsentMessageMetadata = IDL.Record({
    language: IDL.Text,
    utc_offset_minutes: IDL.Opt(IDL.Int16),
  });

  const ConsentMessageUserPreferences = IDL.Record({
      metadata : ConsentMessageMetadata,
      device_spec : IDL.Opt(IDL.Variant({
        GenericDisplay: IDL.Null,
        FieldsDisplay: IDL.Null // Or simplify as needed based on actual type
      }))
  });

  const ConsentMessageRequest = IDL.Record({
    method: IDL.Text,
    arg: IDL.Vec(IDL.Nat8),
    user_preferences: ConsentMessageUserPreferences,
  });

  return IDL.Service({
    icrc21_canister_call_consent_message: IDL.Func([ConsentMessageRequest], [ConsentMessageResponse], ['query']),
  });
};

const TransferArgsIDL = ({ IDL }) => {
    const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    return IDL.Record({
        to: Account,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        amount: IDL.Nat,
    });
};

// Main function
async function run() {
  console.log("Creating actor...");
  const actor = Actor.createActor(idlFactory, { agent, canisterId: CANISTER_ID });
  
  // Create arguments for icrc1_transfer
  // We need to encode TransferArgs into a blob
  // Using IDL.encode requires knowing the types
  const transferArgs = {
      to: { owner: Principal.fromText("aaaaa-aa"), subaccount: [] }, // Management canister or any valid principal
      fee: [],
      memo: [],
      from_subaccount: [],
      created_at_time: [],
      amount: BigInt(100000000) // 1 token (8 decimals)
  };
  
  // We need a way to encode TransferArgs
  // We use the IDL factory for TransferArgs directly
  const encodedArgs = new Uint8Array(IDL.encode([TransferArgsIDL({IDL})], [transferArgs]));
  
  console.log(`Encoded 'icrc1_transfer' args length: ${encodedArgs.length} bytes`);
  
  // Construct request
  const request = {
      method: "icrc1_transfer",
      arg: encodedArgs,
      user_preferences: {
          metadata: { language: "en", utc_offset_minutes: [] },
          device_spec: [] // Default/Generic
      }
  };
  
  console.log("\nCalling 'icrc21_canister_call_consent_message'...");
  try {
      const result: any = await actor.icrc21_canister_call_consent_message(request);
      
      if (result.Ok) {
          console.log("\n✅ SUCCESS! Consent Message Received:");
          const info = result.Ok;
          console.log("Metadata:", info.metadata);
          
          if (info.consent_message.GenericDisplayMessage) {
               console.log("Generic Display Message:", info.consent_message.GenericDisplayMessage);
          } else if (info.consent_message.FieldsDisplayMessage) {
               console.log("Fields Display Message:", JSON.stringify(info.consent_message.FieldsDisplayMessage, (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value // Handle BigInt
               , 2));
          } else {
               console.log("Unknown message format:", info.consent_message);
          }
      } else {
          console.error("❌ Error response:", result.Err);
      }
  } catch (e) {
      console.error("❌ detailed error:", e);
  }
}

run();
