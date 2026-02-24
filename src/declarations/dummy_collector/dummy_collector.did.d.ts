import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface DummyCollector {
  /**
   * / Get the most recent notification
   */
  'get_last_notification' : ActorMethod<[], [] | [ShareNotification]>,
  /**
   * / Get notification count
   */
  'get_notification_count' : ActorMethod<[], bigint>,
  /**
   * / Get all notifications for testing verification
   */
  'get_notifications' : ActorMethod<[], Array<ShareNotification>>,
  /**
   * / Get notifications by namespace
   */
  'get_notifications_by_namespace' : ActorMethod<
    [string],
    Array<ShareNotification>
  >,
  /**
   * / Get stats summary
   */
  'get_stats' : ActorMethod<
    [],
    {
      'notification_count' : bigint,
      'total_notifications' : bigint,
      'total_cycles' : bigint,
    }
  >,
  /**
   * / Get total cycles received
   */
  'get_total_cycles' : ActorMethod<[], bigint>,
  /**
   * / ICRC-85 deposit cycles with async response
   */
  'icrc85_deposit_cycles' : ActorMethod<
    [ShareArgs],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
  /**
   * / ICRC-85 deposit cycles notification (one-way, no response)
   */
  'icrc85_deposit_cycles_notify' : ActorMethod<[ShareArgs], undefined>,
  /**
   * / Reset all data (for test cleanup)
   */
  'reset' : ActorMethod<[], undefined>,
}
export type ShareArgs = Array<[string, bigint]>;
export interface ShareNotification {
  'actions' : bigint,
  'timestamp' : bigint,
  'caller' : Principal,
  'cycles_received' : bigint,
  'namespace' : string,
}
/**
 * / ICRC-85 Dummy Collector Canister
 * / This canister receives ICRC-85 cycle share notifications for testing purposes.
 * / It tracks all received notifications and cycles for verification.
 */
export interface _SERVICE extends DummyCollector {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
