import Iter "mo:core/Iter";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import AccountTools "mo:account";


import MigrationTypes "/migrations/types";

module {
    type Iter<A> = Iter.Iter<A>;

    /// Checks if a subaccount is valid
    public func validate_subaccount(subaccount : ?MigrationTypes.Current.Subaccount) : Bool {
        switch (subaccount) {
            case (?bytes) {
                bytes.size() == 32;
            };
            case (_) true;
        };
    };

    /// Checks if an account is valid
    /// Note: Anonymous principal is allowed per DFINITY reference implementation
    public func validate(account : MigrationTypes.Current.Account) : Bool {
        let invalid_size = Principal.toBlob(account.owner).size() > 29;

        if (invalid_size) {
            false;
        } else {
            validate_subaccount(account.subaccount);
        };
    };

    /// Implementation of ICRC1's Textual representation of accounts [Encoding Standard](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-1#encoding)
    public func encodeAccount(account : MigrationTypes.Current.Account) : Text {
        AccountTools.toText(account)
    };

    /// Implementation of ICRC1's Textual representation of accounts [Decoding Standard](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-1#decoding)
    public func decodeAccount(encoded : Text) : Result.Result<MigrationTypes.Current.Account, AccountTools.ParseError>  {
        AccountTools.fromText(encoded);
    };
};
