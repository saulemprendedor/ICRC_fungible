import MigrationTypes "../types";
import Debug "mo:core/Debug";

module {
  public func upgrade(_prevmigration_state: MigrationTypes.State, _args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {
    return #v0_0_0(#data);
  };

  public func downgrade(_prev_migration_state: MigrationTypes.State, _args: MigrationTypes.Args, _caller: Principal): MigrationTypes.State {

    return #v0_0_0(#data);
  };

};