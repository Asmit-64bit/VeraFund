// ═══════════════════════════════════════════
//  Shared Types
// ═══════════════════════════════════════════

export interface CampaignInfo {
  address: string;
  ngoAddress: string;
  title: string;
  description: string;
  ngoName: string;
  goalAmount: bigint;
  raisedAmount: bigint;
  campaignDeadline: number;
  bootstrapPercent: number;
  status: number;
  milestoneCount: number;
}

export interface MilestoneInfo {
  id: number;
  title: string;
  description: string;
  fundPercent: number;
  deadline: number;
  status: number;
  ipfsHash: string;
  votingDeadline: number;
  votesFor: bigint;
  votesAgainst: bigint;
  resolvedByAI: boolean;
  aiScore: number;
}

export interface WalletState {
  account: string | null;
  provider: import("ethers").BrowserProvider | import("ethers").JsonRpcProvider | null;
  signer: import("ethers").JsonRpcSigner | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

export interface AIVerdict {
  score: number;
  verdict: "Verified" | "Inconclusive" | "Flagged";
  summary: string;
}
