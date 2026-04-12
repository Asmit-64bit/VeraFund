const DEFAULT_FACTORY_ADDRESS = "0x6A837595E2592d699d48eB2DAcF47Df9493035d2";
const DEFAULT_BLOCK_EXPLORER_URL = "https://sepolia.etherscan.io";
const DEFAULT_SEPOLIA_RPCS = [
  "https://gateway.tenderly.co/public/sepolia",
  "https://1rpc.io/sepolia",
  "https://ethereum-sepolia-rpc.publicnode.com",
] as const;
const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://w3s.link/ipfs/",
] as const;

function splitCsvEnv(rawValue: string | undefined) {
  return String(rawValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueValues<T>(values: Iterable<T>) {
  return [...new Set(values)];
}

// Runtime config
export const FACTORY_ADDRESS =
  (import.meta.env.VITE_FACTORY_ADDRESS || DEFAULT_FACTORY_ADDRESS).trim();
export const READONLY_FACTORY_ADDRESSES = uniqueValues([
  FACTORY_ADDRESS,
  ...splitCsvEnv(import.meta.env.VITE_FACTORY_ADDRESSES),
]) as readonly string[];
export const API_BASE = import.meta.env.VITE_API_BASE || "/api";
export const BLOCK_EXPLORER_URL = (
  import.meta.env.VITE_BLOCK_EXPLORER_URL || DEFAULT_BLOCK_EXPLORER_URL
).replace(/\/$/, "");
export const READONLY_SEPOLIA_RPCS = uniqueValues([
  import.meta.env.VITE_SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPCS[0],
  ...splitCsvEnv(import.meta.env.VITE_SEPOLIA_RPC_FALLBACKS),
  ...DEFAULT_SEPOLIA_RPCS,
]) as readonly string[];
export const READONLY_SEPOLIA_RPC = READONLY_SEPOLIA_RPCS[0];
export const IPFS_GATEWAYS = uniqueValues([
  ...splitCsvEnv(import.meta.env.VITE_IPFS_GATEWAYS),
  ...DEFAULT_IPFS_GATEWAYS,
]) as readonly string[];

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
  "function markCampaignStale() external",
  "function isStale() external view returns (bool)",
  "function getRefundAmount(address donor) external view returns (uint256)",
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
  "event VotingOpened(uint256 indexed milestoneId, uint256 votingDeadline)",
  "event VoteCast(address indexed voter, uint256 indexed milestoneId, bool approved)",
  "event FundsReleased(uint256 indexed milestoneId, uint256 amount, bool resolvedByAI)",
  "event MilestoneRejected(uint256 indexed milestoneId, bool resolvedByAI)",
  "event RefundIssued(address indexed donor, uint256 amount)",
  "event CampaignMarkedStale(uint256 indexed milestoneId, uint256 refundPool)",
] as const;

// Status labels
export const CAMPAIGN_STATUS = ["Fundraising", "Active", "Completed", "Cancelled"] as const;
export const MILESTONE_STATUS = ["Pending", "Submitted", "Voting", "Approved", "Rejected"] as const;
