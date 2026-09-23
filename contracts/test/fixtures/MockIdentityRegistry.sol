// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

/// @notice The one function Sclera reads from the ERC-8004 Identity Registry.
///
/// Deliberately reverts for an unset token, exactly as an ERC-721 `ownerOf` does. A mock that
/// returned `address(0)` instead would let a test pass while the real registry reverted, which is the
/// class of mock that proves nothing.
contract MockIdentityRegistry {
    error NonexistentToken();

    mapping(uint256 => address) private _owner;

    function setOwner(uint256 tokenId, address who) external {
        _owner[tokenId] = who;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owner[tokenId];
        if (o == address(0)) revert NonexistentToken();
        return o;
    }
}
