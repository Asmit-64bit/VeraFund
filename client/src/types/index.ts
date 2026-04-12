// ═══════════════════════════════════════════
//  Shared Types
// ═══════════════════════════════════════════

export interface CampaignInfo {
  address: string;
  factoryAddress?: string | null;
  ngoAddress: string;
  title: string;
  description: string;
  profileCid?: string | null;
  profile?: CampaignProfile | null;
  ngoName: string;
  goalAmount: bigint;
  raisedAmount: bigint;
  campaignDeadline: number;
  bootstrapPercent: number;
  bootstrapReleased?: boolean;
  status: number;
  milestoneCount: number;
  userDonation?: bigint;
}

export interface CreatorProfile {
  displayName?: string;
  roleTitle?: string;
  location?: string;
  aboutMe?: string;
  causes?: string[];
  associatedOrganizations?: string[];
  website?: string;
  profileImageUrl?: string | null;
  profileImageDataUrl?: string | null;
}

export interface CampaignProfile {
  coverImageCid?: string | null;
  category?: string;
  summary?: string;
  locationLabel?: string;
  beneficiary?: string;
  organizationType?: string;
  foundedYear?: string;
  website?: string;
  organizationBio?: string;
  useOfFunds?: string;
  proofLinks?: string[];
  coverImageUrl?: string | null;
  coverImageDataUrl?: string | null;
  galleryImages?: Array<{
    cid?: string | null;
    url?: string | null;
    alt?: string | null;
  }>;
  creatorProfile?: CreatorProfile | null;
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

export interface ClaimedLocation {
  label?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  satelliteViewUrl?: string;
}

export interface EvidenceLocation {
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  satelliteViewUrl?: string;
  localityLabel?: string | null;
}

export interface EvidenceUploadAuthenticity {
  sha256?: string;
  capturedAt?: string | null;
  captureTiming?: {
    status?: string;
    ageHours?: number | null;
    notes?: string[];
  } | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  software?: string | null;
  hasGps?: boolean;
  hasCameraMetadata?: boolean;
  provenanceMarkers?: string[];
  suspiciousFlags?: string[];
  aiGeneratedScore?: number | null;
  aiGeneratedLabel?: string | null;
  reverseImageMatches?: Array<Record<string, unknown>>;
  reverseImageMatched?: boolean;
  reverseImageSource?: string | null;
  syntheticWatermarkHints?: string[];
  geospatial?: {
    reverseGeocodedLabel?: string | null;
    localityMatch?: boolean | null;
    localityConfidence?: number;
    matchedTokens?: string[];
  } | null;
  failureReasons?: string[];
  passed?: boolean;
}

export interface AuthenticitySummary {
  passed: boolean;
  duplicateCount: number;
  failedUploads: Array<{
    fileName: string;
    reasons: string[];
  }>;
  notes: string[];
}

export interface GeospatialReview {
  status: "Consistent" | "Questionable" | "Mismatch" | "Insufficient";
  confidence: number;
  estimatedSetting: string;
  keyClues: string[];
  summary: string;
  averageDistanceKm?: number | null;
  localityMismatchCount?: number;
  gpsImageCount?: number;
}

export interface CampaignBindingSummary {
  passed: boolean;
  status: "Present" | "Partial" | "Missing" | "Mismatch" | "Insufficient" | string;
  proofCode?: string | null;
  notes: string[];
  previousMilestoneMatches: Array<{
    previousMilestoneId: number;
    previousMilestoneTitle?: string;
    fileName?: string;
    matchedFileName?: string;
    sha256?: string;
  }>;
}

export interface EvidenceUpload {
  cid: string;
  fileName: string;
  location: EvidenceLocation | null;
  comparison: {
    claimedLocation: ClaimedLocation;
    distanceKm: number | null;
  } | null;
  authenticity?: EvidenceUploadAuthenticity | null;
}

export interface EvidenceAIReview {
  score: number;
  verdict: "Verified" | "Inconclusive" | "Flagged";
  summary: string;
}

export interface WalletState {
  account: string | null;
  provider:
    | import("ethers").BrowserProvider
    | import("ethers").JsonRpcProvider
    | import("ethers").FallbackProvider
    | null;
  signer: import("ethers").JsonRpcSigner | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToSepolia: () => Promise<void>;
}

export interface AIVerdict {
  score: number;
  verdict: "Verified" | "Inconclusive" | "Flagged";
  summary: string;
  authenticity?: AuthenticitySummary;
  geospatial?: GeospatialReview | null;
  binding?: CampaignBindingSummary | null;
}
