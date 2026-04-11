// Contract addresses — deployed on Sepolia
export const FACTORY_ADDRESS = "0xC37cb2Eb3ef384906F8Cc48bCa889449B1E7F83D";
export const DONOR_NFT_ADDRESS = "0x7ec109b7931cdc7a3869a033E4fb5cF9a934670c";

// Backend API
export const API_BASE = "http://localhost:3001";

// Chain config
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

// ABIs — only the functions we use from the frontend
export const FACTORY_ABI = [
  "function createCampaign(string _title, string _description, string _ngoName, uint256 _bootstrapPercent, tuple(string title, string description, uint256 fundPercent, uint256 deadline)[] _milestones, uint256 _goalAmount, uint256 _campaignDeadline) external returns (address)",
  "function getAllCampaigns() external view returns (address[])",
  "function getCampaignsByNGO(address ngo) external view returns (address[])",
  "function getCampaignCount() external view returns (uint256)",
  "event CampaignCreated(address indexed campaignAddress, address indexed ngo, string title)",
] as const;

export const CAMPAIGN_ABI = [
  "function donate() external payable",
  "function submitMilestone(uint256 milestoneId, string ipfsHash) external",
  "function vote(uint256 milestoneId, bool approve) external",
  "function refund() external",
  "function getCampaign() external view returns (tuple(address ngoAddress, string title, string description, string ngoName, uint256 goalAmount, uint256 raisedAmount, uint256 campaignDeadline, uint256 bootstrapPercent, uint8 status, uint256 milestoneCount))",
  "function getMilestone(uint256 milestoneId) external view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string ipfsHash, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst, bool resolvedByAI, uint8 aiScore))",
  "function getAllMilestones() external view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string ipfsHash, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst, bool resolvedByAI, uint8 aiScore)[])",
  "function getMilestoneCount() external view returns (uint256)",
  "function getDonors() external view returns (address[])",
  "function getDonation(address donor) external view returns (uint256)",
  "function donations(address) external view returns (uint256)",
  "function hasVoted(address, uint256) external view returns (bool)",
  "function raisedAmount() external view returns (uint256)",
  "function goalAmount() external view returns (uint256)",
  "function bootstrapPercent() external view returns (uint256)",
  "function bootstrapReleased() external view returns (bool)",
  "function status() external view returns (uint8)",
  "event DonationReceived(address indexed donor, uint256 amount)",
  "event BootstrapReleased(uint256 amount)",
  "event MilestoneSubmitted(uint256 indexed milestoneId, string ipfsHash)",
  "event VoteCast(address indexed voter, uint256 indexed milestoneId, bool approved)",
  "event FundsReleased(uint256 indexed milestoneId, uint256 amount, bool resolvedByAI)",
  "event MilestoneRejected(uint256 indexed milestoneId, bool resolvedByAI)",
] as const;

export const DONOR_NFT_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenData(uint256 tokenId) external view returns (tuple(address campaignAddress, address donor, uint256 amountDonated, uint256 timestamp))",
  "function hasDonorToken(address campaign, address donor) external view returns (bool)",
  "function donorCampaignToken(address campaign, address donor) external view returns (uint256)",
] as const;

// Status labels
export const CAMPAIGN_STATUS = ["Fundraising", "Active", "Completed", "Cancelled"] as const;
export const MILESTONE_STATUS = ["Pending", "Submitted", "Voting", "Approved", "Rejected"] as const;
