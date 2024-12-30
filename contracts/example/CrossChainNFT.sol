// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../PolyBridge.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract CrossChainNFT is PolyBridge, ERC721 {
    // Counter for token IDs
    uint256 private _tokenIdCounter;

    // Mapping to track locked tokens
    mapping(uint256 => bool) public lockedTokens;

    // Function selectors for cross-chain calls
    bytes4 public constant MINT_ON_CHAIN_B =
        bytes4(keccak256("mintOnChainB(uint256,address)"));
    bytes4 public constant BURN_ON_CHAIN_A =
        bytes4(keccak256("burnOnChainA(uint256)"));
    bytes4 public constant UNLOCK_ON_CHAIN_B =
        bytes4(keccak256("unlockOnChainB(uint256)"));

    // Events for bridge tracking
    event NFTLocked(uint256 tokenId, address owner, string chain);
    event NFTUnlocked(uint256 tokenId, address owner, string chain);
    event NFTBridged(uint256 tokenId, address owner, string step);

    constructor(
        address _polymerProver
    ) PolyBridge(_polymerProver) ERC721("Cross Chain NFT", "CCNFT") {
        registerFunction(MINT_ON_CHAIN_B);
        registerFunction(BURN_ON_CHAIN_A);
        registerFunction(UNLOCK_ON_CHAIN_B);
    }

    // Step 1: Mint NFT on Chain A
    function mintOnChainA() external returns (uint256) {
        _tokenIdCounter++;
        uint256 newTokenId = _tokenIdCounter;
        _safeMint(msg.sender, newTokenId);
        return newTokenId;
    }

    // Step 2: Lock NFT on Chain A and bridge to Chain B
    function bridgeToChainB(uint256 tokenId) external returns (bytes32) {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        require(!lockedTokens[tokenId], "Token already locked");

        // Lock the token on Chain A
        lockedTokens[tokenId] = true;
        emit NFTLocked(tokenId, msg.sender, "Chain A");

        // Bridge to chain B to mint equivalent NFT
        return bridge(MINT_ON_CHAIN_B, abi.encode(tokenId, msg.sender));
    }

    // Step 2b: Mint and Lock NFT on Chain B (called by relayer)
    function mintOnChainB(
        uint256 tokenId,
        address owner
    ) public returns (bool) {
        // Use the same token ID from Chain A
        _safeMint(owner, tokenId);
        emit NFTBridged(tokenId, owner, "minted on chain B");

        // Lock the token on Chain B
        lockedTokens[tokenId] = true;
        emit NFTLocked(tokenId, owner, "Chain B");

        // Bridge back to chain A to burn original token
        bridge(BURN_ON_CHAIN_A, abi.encode(tokenId));
        return true;
    }

    // Step 3a: Burn NFT on Chain A (called by relayer)
    function burnOnChainA(uint256 tokenId) public returns (bool) {
        require(lockedTokens[tokenId], "Token not locked");

        address owner = ownerOf(tokenId);
        _burn(tokenId);
        lockedTokens[tokenId] = false;

        emit NFTBridged(tokenId, owner, "burned on chain A");

        // Bridge to Chain B to unlock the token
        bridge(UNLOCK_ON_CHAIN_B, abi.encode(tokenId));
        return true;
    }

    // Step 3b: Unlock NFT on Chain B (called by relayer)
    function unlockOnChainB(uint256 tokenId) public returns (bool) {
        require(lockedTokens[tokenId], "Token not locked");
        require(ownerOf(tokenId) != address(0), "Token does not exist");

        lockedTokens[tokenId] = false;
        emit NFTUnlocked(tokenId, ownerOf(tokenId), "Chain B");
        return true;
    }

    /**
     * @dev Execute bridged function calls
     */
    function _executeFunction(
        bytes4 selector,
        bytes memory payload
    ) internal override returns (bool) {
        if (selector == MINT_ON_CHAIN_B) {
            (uint256 tokenId, address owner) = abi.decode(
                payload,
                (uint256, address)
            );
            return mintOnChainB(tokenId, owner);
        } else if (selector == BURN_ON_CHAIN_A) {
            uint256 tokenId = abi.decode(payload, (uint256));
            return burnOnChainA(tokenId);
        } else if (selector == UNLOCK_ON_CHAIN_B) {
            uint256 tokenId = abi.decode(payload, (uint256));
            return unlockOnChainB(tokenId);
        }
        revert("Unknown function selector");
    }
}
