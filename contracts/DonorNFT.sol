// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DonorNFT — Soulbound proof-of-donation NFT (ERC-5192)
/// @notice Minted when a donor contributes to an ImpactFund campaign.
///         Non-transferable (soulbound). One token per donor per campaign.
contract DonorNFT is ERC721, Ownable {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct DonorToken {
        address campaignAddress;
        address donor;
        uint256 amountDonated; // in wei
        uint256 timestamp;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    uint256 private _nextTokenId;
    mapping(uint256 => DonorToken) public tokenData;

    /// @notice Addresses allowed to mint (campaign contracts)
    mapping(address => bool) public authorizedMinters;

    /// @notice Track one token per donor per campaign: campaign => donor => tokenId
    mapping(address => mapping(address => uint256)) public donorCampaignToken;

    /// @notice Whether a donor already has a token for a given campaign
    mapping(address => mapping(address => bool)) public hasDonorToken;

    // ──────────────────────────────────────────────
    // Events (ERC-5192)
    // ──────────────────────────────────────────────

    event Locked(uint256 tokenId);

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor() ERC721("ImpactFund Donor", "IMPD") Ownable(msg.sender) {}

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    /// @notice Owner (factory) grants mint permission to campaign contracts
    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
    }

    // ──────────────────────────────────────────────
    // Mint
    // ──────────────────────────────────────────────

    /// @notice Mint a soulbound DonorNFT to the donor. One per donor per campaign.
    /// @param donor   The wallet that donated
    /// @param campaign The campaign contract address
    /// @param amount  Amount donated in wei
    /// @return tokenId The newly minted token ID
    function mint(
        address donor,
        address campaign,
        uint256 amount
    ) external returns (uint256) {
        require(authorizedMinters[msg.sender], "DonorNFT: not authorized");

        // One token per donor per campaign
        if (hasDonorToken[campaign][donor]) {
            // Update existing token's amount
            uint256 existingId = donorCampaignToken[campaign][donor];
            tokenData[existingId].amountDonated += amount;
            return existingId;
        }

        uint256 tokenId = _nextTokenId++;
        _safeMint(donor, tokenId);

        tokenData[tokenId] = DonorToken({
            campaignAddress: campaign,
            donor: donor,
            amountDonated: amount,
            timestamp: block.timestamp
        });

        hasDonorToken[campaign][donor] = true;
        donorCampaignToken[campaign][donor] = tokenId;

        emit Locked(tokenId);
        return tokenId;
    }

    // ──────────────────────────────────────────────
    // Soulbound: block all transfers (ERC-5192)
    // ──────────────────────────────────────────────

    /// @notice Returns true — every token is permanently locked
    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId); // reverts if non-existent
        return true;
    }

    /// @dev Override to prevent all transfers except minting
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert("Soulbound: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    // ──────────────────────────────────────────────
    // ERC-165 supportsInterface
    // ──────────────────────────────────────────────

    /// @dev ERC-5192 interface id = 0xb45a3c0e
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return
            interfaceId == 0xb45a3c0e || // ERC-5192
            super.supportsInterface(interfaceId);
    }
}
