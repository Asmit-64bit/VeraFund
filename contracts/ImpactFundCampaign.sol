// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./DonorNFT.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ImpactFundCampaign — Milestone-gated donation escrow with bootstrap grant
/// @notice One instance per campaign. Holds ETH in escrow. Features:
///         - Bootstrap grant released automatically once its tranche is funded
///         - Later milestones unlock as cumulative funding thresholds are reached
///         - 7-day voting window per milestone with quorum requirement
///         - AI tiebreaker when quorum is not met
contract ImpactFundCampaign is ReentrancyGuard {
    // ──────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────

    enum CampaignStatus { Fundraising, Active, Completed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, Voting, Approved, Rejected }

    // ──────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────

    struct Milestone {
        string title;
        string description;
        uint256 fundPercent;       // % of total goal for this milestone
        uint256 deadline;          // unix timestamp (0 for milestone 0)
        MilestoneStatus status;
        string ipfsHash;           // evidence CID, empty until submitted
        uint256 votingDeadline;    // set when submitted (timestamp + VOTING_WINDOW)
        uint256 votesFor;          // total wei weight of approve votes
        uint256 votesAgainst;      // total wei weight of challenge votes
        bool resolvedByAI;         // true if AI was tiebreaker
        uint8 aiScore;             // stored on-chain for resolution
    }

    struct CampaignView {
        address ngoAddress;
        string title;
        string description;
        string ngoName;
        uint256 goalAmount;
        uint256 raisedAmount;
        uint256 campaignDeadline;
        uint256 bootstrapPercent;
        CampaignStatus status;
        uint256 milestoneCount;
    }

    // ──────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────

    uint256 public constant QUORUM_PERCENT = 30;        // 30% of total weight must vote
    uint256 public constant APPROVAL_THRESHOLD = 60;    // 60% of votes must approve
    uint256 public constant VOTING_WINDOW = 7 days;
    uint256 public constant AI_AUTO_APPROVE_SCORE = 70; // AI score needed for tiebreaker
    uint256 public constant STALE_WINDOW = 60 days;     // inactivity grace period after a milestone deadline

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    address public ngoAddress;
    string public title;
    string public description;
    string public ngoName;
    uint256 public goalAmount;
    uint256 public raisedAmount;
    uint256 public campaignDeadline;
    uint256 public bootstrapPercent;  // 1-15
    CampaignStatus public status;

    Milestone[] public milestones;

    /// @notice donor address → total wei donated
    mapping(address => uint256) public donations;

    /// @notice donor → milestoneId → has voted
    mapping(address => mapping(uint256 => bool)) public hasVoted;

    /// @notice Track all donor addresses for iteration
    address[] public donorList;
    mapping(address => bool) private isDonor;

    /// @notice Reference to the DonorNFT contract
    DonorNFT public donorNFTContract;

    /// @notice Trusted backend signer for setAIScore
    address public backendSigner;

    /// @notice Track if bootstrap has been released
    bool public bootstrapReleased;

    /// @notice Track funds already released per milestone
    mapping(uint256 => bool) public fundsReleased;

    /// @notice Track if donor has already been refunded
    mapping(address => bool) public refunded;

    /// @notice Snapshot of remaining locked funds when the campaign is marked stale
    uint256 public staleRefundPool;

    /// @notice The address that deployed this contract (factory or direct deployer)
    address public deployer;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event DonationReceived(address indexed donor, uint256 amount);
    event BootstrapReleased(uint256 amount);
    event MilestoneSubmitted(uint256 indexed milestoneId, string ipfsHash);
    event VotingOpened(uint256 indexed milestoneId, uint256 votingDeadline);
    event VoteCast(address indexed voter, uint256 indexed milestoneId, bool approved);
    event FundsReleased(uint256 indexed milestoneId, uint256 amount, bool resolvedByAI);
    event MilestoneRejected(uint256 indexed milestoneId, bool resolvedByAI);
    event RefundIssued(address indexed donor, uint256 amount);
    event CampaignMarkedStale(uint256 indexed milestoneId, uint256 refundPool);

    // ──────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────

    modifier onlyNGO() {
        require(msg.sender == ngoAddress, "Campaign: caller is not the NGO");
        _;
    }

    modifier onlyDonor() {
        require(donations[msg.sender] > 0, "Campaign: caller is not a donor");
        _;
    }

    modifier onlyBackendSigner() {
        require(msg.sender == backendSigner, "Campaign: caller is not backend signer");
        _;
    }

    modifier inStatus(CampaignStatus _status) {
        require(status == _status, "Campaign: invalid status for this action");
        _;
    }

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _ngoAddress,
        string memory _title,
        string memory _description,
        string memory _ngoName,
        uint256 _goalAmount,
        uint256 _campaignDeadline,
        uint256 _bootstrapPercent,
        address _donorNFT,
        address _backendSigner
    ) {
        require(_goalAmount > 0, "Campaign: goal must be > 0");
        require(_campaignDeadline > block.timestamp, "Campaign: deadline must be in the future");
        require(_bootstrapPercent >= 1 && _bootstrapPercent <= 15, "Campaign: bootstrap must be 1-15%");

        ngoAddress = _ngoAddress;
        title = _title;
        description = _description;
        ngoName = _ngoName;
        goalAmount = _goalAmount;
        campaignDeadline = _campaignDeadline;
        bootstrapPercent = _bootstrapPercent;
        status = CampaignStatus.Fundraising;
        donorNFTContract = DonorNFT(_donorNFT);
        backendSigner = _backendSigner;
        deployer = msg.sender;

        // Auto-create Milestone 0 (Bootstrap Grant)
        milestones.push(Milestone({
            title: "Initial Operating Grant",
            description: "Bootstrap funds released on campaign funding",
            fundPercent: _bootstrapPercent,
            deadline: 0,
            status: MilestoneStatus.Pending,
            ipfsHash: "",
            votingDeadline: 0,
            votesFor: 0,
            votesAgainst: 0,
            resolvedByAI: false,
            aiScore: 0
        }));
    }

    // ──────────────────────────────────────────────
    // Milestone setup (called by factory during deploy)
    // ──────────────────────────────────────────────

    /// @notice Add a milestone. Only callable before any donations.
    function addMilestone(
        string memory _title,
        string memory _description,
        uint256 _fundPercent,
        uint256 _milestoneDeadline
    ) external {
        require(msg.sender == deployer, "Campaign: only deployer can add milestones");
        require(raisedAmount == 0, "Campaign: cannot add milestones after donations");

        milestones.push(Milestone({
            title: _title,
            description: _description,
            fundPercent: _fundPercent,
            deadline: _milestoneDeadline,
            status: MilestoneStatus.Pending,
            ipfsHash: "",
            votingDeadline: 0,
            votesFor: 0,
            votesAgainst: 0,
            resolvedByAI: false,
            aiScore: 0
        }));
    }

    // ──────────────────────────────────────────────
    // Donate
    // ──────────────────────────────────────────────

    /// @notice Accept ETH donation, record donor, mint DonorNFT, trigger tranche unlocks
    function donate() external payable nonReentrant {
        require(
            status == CampaignStatus.Fundraising || status == CampaignStatus.Active,
            "Campaign: donations are closed"
        );
        require(msg.value > 0, "Campaign: donation must be > 0");
        require(msg.sender != ngoAddress, "Campaign: NGO cannot donate to own campaign");
        require(block.timestamp < campaignDeadline, "Campaign: fundraising deadline passed");
        require(raisedAmount + msg.value <= goalAmount, "Campaign: donation exceeds goal");

        // Track donor
        if (!isDonor[msg.sender]) {
            donorList.push(msg.sender);
            isDonor[msg.sender] = true;
        }
        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        // Mint DonorNFT (one per donor per campaign, updates amount on re-donation)
        donorNFTContract.mint(msg.sender, address(this), msg.value);

        emit DonationReceived(msg.sender, msg.value);

        // Release bootstrap as soon as its tranche is fully funded.
        if (!bootstrapReleased && isMilestoneFundingUnlocked(0)) {
            _releaseBootstrap();
        }
    }

    // ──────────────────────────────────────────────
    // Bootstrap Grant (internal, auto-triggered)
    // ──────────────────────────────────────────────

    /// @notice Releases bootstrap % to NGO, marks milestone 0 as Approved, transitions to Active
    function _releaseBootstrap() internal {
        uint256 bootstrapAmount = (goalAmount * bootstrapPercent) / 100;
        bootstrapReleased = true;

        // Mark milestone 0 as approved
        milestones[0].status = MilestoneStatus.Approved;
        fundsReleased[0] = true;

        // Campaign becomes active as soon as bootstrap funding is secured.
        status = CampaignStatus.Active;

        // Transfer bootstrap to NGO
        (bool success, ) = payable(ngoAddress).call{value: bootstrapAmount}("");
        require(success, "Campaign: bootstrap transfer failed");

        emit BootstrapReleased(bootstrapAmount);
        emit FundsReleased(0, bootstrapAmount, false);
    }

    // ──────────────────────────────────────────────
    // Submit milestone evidence (NGO only)
    // ──────────────────────────────────────────────

    /// @notice NGO submits IPFS evidence hash. Opens 7-day voting window.
    function submitMilestone(
        uint256 milestoneId,
        string memory ipfsHash
    ) external onlyNGO inStatus(CampaignStatus.Active) {
        require(milestoneId > 0, "Campaign: cannot submit milestone 0 (bootstrap)");
        require(milestoneId < milestones.length, "Campaign: invalid milestone id");
        require(bootstrapReleased, "Campaign: bootstrap not released");
        require(_previousMilestoneApproved(milestoneId), "Campaign: previous milestone not approved");
        require(isMilestoneFundingUnlocked(milestoneId), "Campaign: milestone funding not unlocked");

        Milestone storage m = milestones[milestoneId];
        require(
            m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.Rejected,
            "Campaign: milestone not in submittable state"
        );
        require(bytes(ipfsHash).length > 0, "Campaign: empty IPFS hash");

        m.ipfsHash = ipfsHash;
        m.status = MilestoneStatus.Voting;
        m.votingDeadline = block.timestamp + VOTING_WINDOW;
        // Reset votes on resubmission
        m.votesFor = 0;
        m.votesAgainst = 0;
        m.resolvedByAI = false;
        m.aiScore = 0;

        // Reset hasVoted for all donors so they can re-vote on resubmission
        for (uint256 i = 0; i < donorList.length; i++) {
            hasVoted[donorList[i]][milestoneId] = false;
        }

        emit MilestoneSubmitted(milestoneId, ipfsHash);
        emit VotingOpened(milestoneId, m.votingDeadline);
    }

    // ──────────────────────────────────────────────
    // Vote (Donor only, weighted by donation)
    // ──────────────────────────────────────────────

    /// @notice Cast a weighted vote on a submitted milestone during the voting window
    function vote(
        uint256 milestoneId,
        bool approve
    ) external onlyDonor inStatus(CampaignStatus.Active) {
        require(milestoneId > 0, "Campaign: cannot vote on milestone 0");
        require(milestoneId < milestones.length, "Campaign: invalid milestone id");

        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Voting, "Campaign: milestone not in voting");
        require(block.timestamp <= m.votingDeadline, "Campaign: voting window closed");
        require(!hasVoted[msg.sender][milestoneId], "Campaign: already voted");

        hasVoted[msg.sender][milestoneId] = true;
        uint256 weight = donations[msg.sender];

        if (approve) {
            m.votesFor += weight;
        } else {
            m.votesAgainst += weight;
        }

        emit VoteCast(msg.sender, milestoneId, approve);
    }

    // ──────────────────────────────────────────────
    // Set AI Score (Backend signer only)
    // ──────────────────────────────────────────────

    /// @notice Backend calls this to store AI score on-chain for resolution
    function setAIScore(
        uint256 milestoneId,
        uint8 score
    ) external onlyBackendSigner {
        require(milestoneId > 0 && milestoneId < milestones.length, "Campaign: invalid milestone id");
        require(score <= 100, "Campaign: score must be 0-100");

        Milestone storage m = milestones[milestoneId];
        require(
            m.status == MilestoneStatus.Voting,
            "Campaign: milestone not in voting"
        );

        m.aiScore = score;
    }

    // ──────────────────────────────────────────────
    // Resolve Vote (anyone, after window closes)
    // ──────────────────────────────────────────────

    /// @notice Resolve a milestone vote once the window closes or all donor weight has voted
    ///         Checks quorum → threshold → AI fallback
    function resolveVote(uint256 milestoneId) external inStatus(CampaignStatus.Active) {
        require(milestoneId > 0 && milestoneId < milestones.length, "Campaign: invalid milestone id");

        Milestone storage m = milestones[milestoneId];
        require(m.status == MilestoneStatus.Voting, "Campaign: milestone not in voting");

        uint256 totalVoted = m.votesFor + m.votesAgainst;
        bool allDonorWeightCast = totalVoted >= raisedAmount;
        require(
            block.timestamp > m.votingDeadline || allDonorWeightCast,
            "Campaign: voting still open"
        );

        uint256 quorumWeight = (raisedAmount * QUORUM_PERCENT) / 100;
        bool quorumMet = totalVoted >= quorumWeight;

        if (quorumMet) {
            // Standard path: check approval threshold
            uint256 approvalWeight = (totalVoted * APPROVAL_THRESHOLD) / 100;
            if (m.votesFor >= approvalWeight) {
                _releaseMilestoneFunds(milestoneId);
            } else {
                m.status = MilestoneStatus.Rejected;
                emit MilestoneRejected(milestoneId, false);
            }
        } else {
            // Quorum not met: AI tiebreaker
            m.resolvedByAI = true;
            if (m.aiScore >= AI_AUTO_APPROVE_SCORE) {
                _releaseMilestoneFunds(milestoneId);
            } else {
                m.status = MilestoneStatus.Rejected;
                emit MilestoneRejected(milestoneId, true);
            }
        }
    }

    // ──────────────────────────────────────────────
    // Internal: release milestone tranche
    // ──────────────────────────────────────────────

    function _releaseMilestoneFunds(uint256 milestoneId) internal nonReentrant {
        Milestone storage m = milestones[milestoneId];

        // Calculate tranche: fundPercent is % of total goal
        uint256 trancheAmount =
            milestoneId == milestones.length - 1
                ? address(this).balance
                : (goalAmount * m.fundPercent) / 100;

        // Cap at available balance
        uint256 available = address(this).balance;
        if (trancheAmount > available) {
            trancheAmount = available;
        }

        m.status = MilestoneStatus.Approved;
        fundsReleased[milestoneId] = true;

        (bool success, ) = payable(ngoAddress).call{value: trancheAmount}("");
        require(success, "Campaign: ETH transfer failed");

        emit FundsReleased(milestoneId, trancheAmount, m.resolvedByAI);

        // Check if all milestones are approved → complete campaign
        if (_allMilestonesApproved()) {
            status = CampaignStatus.Completed;
            for (uint256 i = 0; i < donorList.length; i++) {
                donorNFTContract.recordCampaignSuccess(donorList[i], address(this));
            }
        }
    }

    // ──────────────────────────────────────────────
    // Stale campaign protection
    // ──────────────────────────────────────────────

    /// @notice Any account can mark an active campaign stale after 60+ days of missed milestone activity
    function markCampaignStale() external inStatus(CampaignStatus.Active) {
        (bool stale, uint256 milestoneId) = _getStaleMilestone();
        require(stale, "Campaign: stale refund not available");
        require(staleRefundPool == 0, "Campaign: stale refund already initialized");

        status = CampaignStatus.Cancelled;
        staleRefundPool = address(this).balance;

        emit CampaignMarkedStale(milestoneId, staleRefundPool);
    }

    // ──────────────────────────────────────────────
    // Refund
    // ──────────────────────────────────────────────

    /// @notice Donor can reclaim funds if fundraising failed or an active campaign was marked stale
    function refund() external onlyDonor nonReentrant {
        bool fundraisingFailed =
            block.timestamp > campaignDeadline &&
            raisedAmount < goalAmount &&
            status != CampaignStatus.Completed;

        require(
            status == CampaignStatus.Cancelled ||
            fundraisingFailed,
            "Campaign: refund not available"
        );
        require(!refunded[msg.sender], "Campaign: already refunded");

        if (fundraisingFailed && staleRefundPool == 0) {
            staleRefundPool = address(this).balance;
            if (status != CampaignStatus.Cancelled) {
                status = CampaignStatus.Cancelled;
            }
        }

        uint256 amount = getRefundAmount(msg.sender);
        require(amount > 0, "Campaign: nothing to refund");

        refunded[msg.sender] = true;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Campaign: refund transfer failed");

        emit RefundIssued(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────

    function getCampaign() external view returns (CampaignView memory) {
        return CampaignView({
            ngoAddress: ngoAddress,
            title: title,
            description: description,
            ngoName: ngoName,
            goalAmount: goalAmount,
            raisedAmount: raisedAmount,
            campaignDeadline: campaignDeadline,
            bootstrapPercent: bootstrapPercent,
            status: status,
            milestoneCount: milestones.length
        });
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        require(milestoneId < milestones.length, "Campaign: invalid milestone id");
        return milestones[milestoneId];
    }

    function getAllMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    function getMilestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getDonors() external view returns (address[] memory) {
        return donorList;
    }

    function getDonation(address donor) external view returns (uint256) {
        return donations[donor];
    }

    function getRefundAmount(address donor) public view returns (uint256) {
        if (donations[donor] == 0 || refunded[donor]) {
            return 0;
        }

        bool fundraisingFailed =
            block.timestamp > campaignDeadline &&
            raisedAmount < goalAmount &&
            status != CampaignStatus.Completed;

        if ((status == CampaignStatus.Cancelled && staleRefundPool > 0) || fundraisingFailed) {
            uint256 refundPool = staleRefundPool > 0 ? staleRefundPool : address(this).balance;
            return (refundPool * donations[donor]) / raisedAmount;
        }

        return 0;
    }

    function isStale() external view returns (bool) {
        (bool stale, ) = _getStaleMilestone();
        return stale;
    }

    /// @notice Returns the cumulative amount that must be raised before a milestone can open.
    function getMilestoneUnlockAmount(uint256 milestoneId) public view returns (uint256) {
        require(milestoneId < milestones.length, "Campaign: invalid milestone id");

        uint256 cumulativePercent = 0;
        for (uint256 i = 0; i <= milestoneId; i++) {
            cumulativePercent += milestones[i].fundPercent;
        }

        return (goalAmount * cumulativePercent) / 100;
    }

    /// @notice Returns whether the campaign has raised enough to open a milestone.
    function isMilestoneFundingUnlocked(uint256 milestoneId) public view returns (bool) {
        return raisedAmount >= getMilestoneUnlockAmount(milestoneId);
    }

    // ──────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────

    function _allMilestonesApproved() internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].status != MilestoneStatus.Approved) {
                return false;
            }
        }
        return true;
    }

    function _previousMilestoneApproved(uint256 milestoneId) internal view returns (bool) {
        if (milestoneId == 0) {
            return true;
        }

        return milestones[milestoneId - 1].status == MilestoneStatus.Approved;
    }

    function _getStaleMilestone() internal view returns (bool, uint256) {
        for (uint256 i = 1; i < milestones.length; i++) {
            Milestone storage milestone = milestones[i];

            if (milestone.status == MilestoneStatus.Approved) {
                continue;
            }

            uint256 activityDeadline;

            if (milestone.status == MilestoneStatus.Voting) {
                activityDeadline = milestone.votingDeadline;
            } else {
                activityDeadline = milestone.deadline;
            }

            if (activityDeadline > 0 && block.timestamp > activityDeadline + STALE_WINDOW) {
                return (true, i);
            }
        }

        return (false, 0);
    }

    receive() external payable {}
}
