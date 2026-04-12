// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

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

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);

        DonorToken memory donorToken = tokenData[tokenId];
        string memory metadata = Base64.encode(
            bytes(_buildMetadata(tokenId, donorToken))
        );

        return string(abi.encodePacked("data:application/json;base64,", metadata));
    }

    function _buildImage(
        DonorToken memory donorToken
    ) internal pure returns (string memory) {
        return Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480">',
                        '<rect width="480" height="480" fill="#F4F0EA"/>',
                        '<rect x="22" y="22" width="436" height="436" rx="20" fill="#FFFFFF" stroke="#141414" stroke-width="24"/>',
                        '<rect x="48" y="48" width="384" height="384" rx="16" fill="#111111"/>',
                        '<text x="240" y="150" text-anchor="middle" fill="#F4F0EA" font-size="30" font-family="monospace">ImpactFund Donor</text>',
                        '<text x="240" y="228" text-anchor="middle" fill="#E2E800" font-size="42" font-family="monospace">Donation Proof</text>',
                        '<text x="240" y="286" text-anchor="middle" fill="#F4F0EA" font-size="22" font-family="monospace">Donated ',
                        Strings.toString(donorToken.amountDonated / 1e15),
                        " finney</text>",
                        '<text x="240" y="334" text-anchor="middle" fill="#F4F0EA" font-size="18" font-family="monospace">Campaign contributor</text>',
                        '<text x="240" y="382" text-anchor="middle" fill="#F4F0EA" font-size="16" font-family="monospace">',
                        Strings.toHexString(uint160(donorToken.donor), 20),
                        "</text>",
                        "</svg>"
                    )
                )
            )
        );
    }

    function _buildMetadata(
        uint256 tokenId,
        DonorToken memory donorToken
    ) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '{"name":"ImpactFund Donor #',
                Strings.toString(tokenId),
                '","description":"A soulbound donor NFT that proves a wallet backed a specific ImpactFund campaign.",',
                '"image":"data:image/svg+xml;base64,',
                _buildImage(donorToken),
                '","attributes":[',
                '{"trait_type":"Amount Donated (wei)","value":"',
                Strings.toString(donorToken.amountDonated),
                '"},',
                '{"trait_type":"Campaign Address","value":"',
                Strings.toHexString(uint160(donorToken.campaignAddress), 20),
                '"},',
                '{"trait_type":"Donor Address","value":"',
                Strings.toHexString(uint160(donorToken.donor), 20),
                '"}]}'
            )
        );
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
