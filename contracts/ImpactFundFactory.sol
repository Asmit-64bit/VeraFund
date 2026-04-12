// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./ImpactFundCampaign.sol";
import "./DonorNFT.sol";

/// @title ImpactFundFactory — Campaign deployer and registry
/// @notice Deploys new ImpactFundCampaign contracts with bootstrap grant config
///         and maintains a global registry of all campaigns.
contract ImpactFundFactory {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct MilestoneInput {
        string title;
        string description;
        uint256 fundPercent;
        uint256 deadline;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    /// @notice All deployed campaign addresses
    address[] public campaigns;

    /// @notice NGO wallet → their campaign addresses
    mapping(address => address[]) public campaignsByNGO;

    /// @notice Reference to the shared DonorNFT contract
    DonorNFT public donorNFT;

    /// @notice Trusted backend signer address (passed to each campaign)
    address public backendSigner;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event CampaignCreated(
        address indexed campaignAddress,
        address indexed ngo,
        string title
    );

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor(address _donorNFT, address _backendSigner) {
        donorNFT = DonorNFT(_donorNFT);
        backendSigner = _backendSigner;
    }

    // ──────────────────────────────────────────────
    // Create campaign
    // ──────────────────────────────────────────────

    /// @notice Deploy a new ImpactFundCampaign with bootstrap grant and milestones
    /// @param _title             Campaign title
    /// @param _description       Campaign description
    /// @param _ngoName           Name of the NGO
    /// @param _bootstrapPercent  Bootstrap grant % (1-15), released when goal hit
    /// @param _milestones        Milestone inputs (excludes milestone 0 which is auto-created)
    /// @param _goalAmount        Funding goal in wei
    /// @param _campaignDeadline  Unix timestamp for fundraising deadline
    /// @return campaignAddress   Address of newly deployed campaign
    function createCampaign(
        string memory _title,
        string memory _description,
        string memory _ngoName,
        uint256 _bootstrapPercent,
        MilestoneInput[] memory _milestones,
        uint256 _goalAmount,
        uint256 _campaignDeadline
    ) external returns (address) {
        // Validate milestone percentages sum to 100 (of post-bootstrap amount)
        uint256 totalPercent = 0;
        for (uint256 i = 0; i < _milestones.length; i++) {
            totalPercent += _milestones[i].fundPercent;
        }
        require(totalPercent == 100, "Factory: milestone percentages must sum to 100");
        require(_milestones.length >= 2 && _milestones.length <= 5, "Factory: 2-5 milestones required");
        require(_bootstrapPercent >= 1 && _bootstrapPercent <= 15, "Factory: bootstrap must be 1-15%");
        require(_campaignDeadline > block.timestamp, "Factory: fundraising deadline must be in the future");

        uint256 previousDeadline = _campaignDeadline;
        for (uint256 i = 0; i < _milestones.length; i++) {
            require(_milestones[i].deadline > block.timestamp, "Factory: milestone deadline must be in the future");
            require(_milestones[i].deadline > _campaignDeadline, "Factory: milestone deadline must be after fundraising deadline");
            require(_milestones[i].deadline > previousDeadline, "Factory: milestone deadlines must be increasing");
            previousDeadline = _milestones[i].deadline;
        }

        // Deploy new campaign
        ImpactFundCampaign campaign = new ImpactFundCampaign(
            msg.sender,           // NGO address is the caller
            _title,
            _description,
            _ngoName,
            _goalAmount,
            _campaignDeadline,
            _bootstrapPercent,
            address(donorNFT),
            backendSigner
        );

        // Add user-defined milestones.
        // Milestone percentages are entered as shares of the post-bootstrap pool.
        // We convert them to shares of the total goal and assign any rounding remainder
        // to the final milestone so bootstrap + milestones always cover the full goal.
        uint256 remainingPercent = 100 - _bootstrapPercent;
        uint256 assignedPercent = 0;
        for (uint256 i = 0; i < _milestones.length; i++) {
            uint256 actualPercent = i == _milestones.length - 1
                ? remainingPercent - assignedPercent
                : (_milestones[i].fundPercent * remainingPercent) / 100;

            assignedPercent += actualPercent;
            campaign.addMilestone(
                _milestones[i].title,
                _milestones[i].description,
                actualPercent,
                _milestones[i].deadline
            );
        }

        // Authorize campaign to mint DonorNFTs
        donorNFT.setAuthorizedMinter(address(campaign), true);

        // Register campaign
        address campaignAddr = address(campaign);
        campaigns.push(campaignAddr);
        campaignsByNGO[msg.sender].push(campaignAddr);

        emit CampaignCreated(campaignAddr, msg.sender, _title);

        return campaignAddr;
    }

    // ──────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────

    function getAllCampaigns() external view returns (address[] memory) {
        return campaigns;
    }

    function getCampaignsByNGO(address ngo) external view returns (address[] memory) {
        return campaignsByNGO[ngo];
    }

    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
