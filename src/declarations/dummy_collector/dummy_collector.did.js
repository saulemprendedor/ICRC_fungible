export const idlFactory = ({ IDL }) => {
  const ShareNotification = IDL.Record({
    'actions' : IDL.Nat,
    'timestamp' : IDL.Int,
    'caller' : IDL.Principal,
    'cycles_received' : IDL.Nat,
    'namespace' : IDL.Text,
  });
  const ShareArgs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat));
  const DummyCollector = IDL.Service({
    'get_last_notification' : IDL.Func(
        [],
        [IDL.Opt(ShareNotification)],
        ['query'],
      ),
    'get_notification_count' : IDL.Func([], [IDL.Nat], ['query']),
    'get_notifications' : IDL.Func([], [IDL.Vec(ShareNotification)], ['query']),
    'get_notifications_by_namespace' : IDL.Func(
        [IDL.Text],
        [IDL.Vec(ShareNotification)],
        ['query'],
      ),
    'get_stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'notification_count' : IDL.Nat,
            'total_notifications' : IDL.Nat,
            'total_cycles' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_total_cycles' : IDL.Func([], [IDL.Nat], ['query']),
    'icrc85_deposit_cycles' : IDL.Func(
        [ShareArgs],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'icrc85_deposit_cycles_notify' : IDL.Func([ShareArgs], [], ['oneway']),
    'reset' : IDL.Func([], [], []),
  });
  return DummyCollector;
};
export const init = ({ IDL }) => { return []; };
