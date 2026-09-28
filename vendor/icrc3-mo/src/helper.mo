import MigrationTypes "./migrations/types";
import Iter "mo:core/Iter";

module {
  // do not forget to change current migration when you add a new one
  // you should use this field to import types from you current migration anywhere in your project
  // instead of importing it from migration folder itself

  public type Value = MigrationTypes.Current.Value;

  /// Creates an iterator over a range of natural numbers [start, end] inclusive.
  public func range(start: Nat, end : Nat) : Iter.Iter<Nat> {
    var i = start;
    {
      next = func() : ?Nat {
        if (i > end) return null;
        let val = i;
        i += 1;
        ?val
      }
    }
  };


  public func get_item_from_map(name: Text, map: Value) : ?Value {
    switch(map){
      case(#Map(map)){
        for(thisItem in map.vals()){
          if(thisItem.0 == name){
            return ?thisItem.1;
          };
        };
      };
      case(_)return null;
    };
    return null;
  };
};