import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useCampaign } from "../hooks/useCampaign";
import {
  CAMPAIGN_ABI,
  CAMPAIGN_STATUS,
  MILESTONE_STATUS,
  API_BASE,
} from "../constants";
import { getMediaProxyUrl, getSatelliteViewUrl } from "../lib/campaignProfile";
import { normalizeCampaignCategories } from "../lib/campaigns";
import { formatEth, formatEthLabel, formatPercent } from "../lib/format";
import type {
  AIVerdict,
  AuthenticitySummary,
  CampaignBindingSummary,
  CampaignInfo,
  ClaimedLocation,
  EvidenceAIReview,
  EvidenceUpload,
  GeospatialReview,
  WalletState,
  MilestoneInfo,
} from "../types";

interface DetailProps {
  wallet: WalletState;
}

type EvidenceMetadataMap = Record<number, {
  uploads: EvidenceUpload[];
  claimedLocation: ClaimedLocation | null;
  authenticity?: AuthenticitySummary;
  geospatial?: GeospatialReview | null;
  binding?: CampaignBindingSummary | null;
  aiReview?: EvidenceAIReview | null;
}>;

interface AuditTrailEntry {
  id: string;
  title: string;
  summary: string;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
}

type MilestoneVoteMap = Record<number, boolean>;

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_TIMEOUT_MS = 60_000;
const CHAIN_CONFIRMATION_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 90_000;

function getReadableAuditTrailError(message: string | null | undefined) {
  const normalized = String(message || "");

  if (
    normalized.includes("Too Many Requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("infura.io/dashboard") ||
    normalized.includes("missing response for request") ||
    normalized.includes("timed out")
  ) {
    return "Audit trail is temporarily unavailable because the Sepolia log provider is rate-limiting requests. Please refresh in a moment.";
  }

  return "Audit trail could not be loaded right now. Please refresh and try again.";
}

function getReadableVoteError(message: string | null | undefined) {
  const normalized = String(message || "").toLowerCase();

  if (
    normalized.includes("already voted") ||
    normalized.includes("missing revert data") ||
    normalized.includes("call_exception")
  ) {
    return "You have already voted on this milestone. A second vote from the same wallet is not allowed.";
  }

  if (normalized.includes("not donor")) {
    return "Only donors to this campaign can vote on milestone evidence.";
  }

  if (normalized.includes("window closed") || normalized.includes("voting closed")) {
    return "Voting for this milestone is already closed.";
  }

  return message || "Vote failed";
}

function getAiReviewTone(verdict?: EvidenceAIReview["verdict"] | null) {
  if (verdict === "Verified") return "neo-tag-green";
  if (verdict === "Flagged") return "neo-tag-red";
  return "neo-tag-yellow";
}

function getAiScoreBand(score: number) {
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Moderate match";
  if (score >= 40) return "Weak match";
  return "Low confidence";
}

function getProgressPercentNumber(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator <= 0n) {
    return 0;
  }

  const percentTimes100 = Number((numerator * 10000n) / denominator) / 100;
  return Math.min(percentTimes100, 100);
}

function buildProofCode(campaignAddress: string, milestoneId: number, when = new Date()) {
  const utcDate = when.toISOString().slice(0, 10).replace(/-/g, "");
  const compactAddress = String(campaignAddress || "")
    .replace(/^0x/i, "")
    .slice(0, 6)
    .toUpperCase();
  return `VERA-${compactAddress}-M${milestoneId}-${utcDate}`;
}

function validateSelectedImages(files: FileList | null) {
  const selectedFiles = Array.from(files || []);

  if (selectedFiles.length === 0) {
    return { ok: false as const, error: "Choose at least one JPG, PNG, or WEBP image." };
  }

  for (const file of selectedFiles) {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      return {
        ok: false as const,
        error:
          "Please upload JPG, PNG, or WEBP images. HEIC and HEIF files are not supported reliably in the verifier yet.",
      };
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return {
        ok: false as const,
        error: "Each proof image must be 10 MB or smaller.",
      };
    }
  }

  return { ok: true as const, files: selectedFiles };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function waitForTransactionWithTimeout(
  tx: ethers.TransactionResponse,
  timeoutMs: number
) {
  if (tx.provider) {
    const receipt = await tx.provider.waitForTransaction(tx.hash, 1, timeoutMs);
    if (!receipt) {
      throw new Error(
        "On-chain confirmation is taking too long. Check your wallet or the Sepolia transaction, then refresh the page."
      );
    }

    return receipt;
  }

  return Promise.race([
    tx.wait(),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(
          new Error(
            "On-chain confirmation is taking too long. Check your wallet or the Sepolia transaction, then refresh the page."
          )
        );
      }, timeoutMs);
    }),
  ]);
}

function toProofMarkerWords(value: string, maxWords = 4) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, maxWords);
}

function buildProofMarker(
  campaignAddress: string,
  milestoneId: number,
  milestoneTitle: string,
  when = new Date()
) {
  const utcDate = when.toISOString().slice(0, 10).replace(/-/g, "");
  const compactAddress = String(campaignAddress || "")
    .replace(/^0x/i, "")
    .slice(0, 6)
    .toUpperCase();
  const titleMarker = toProofMarkerWords(milestoneTitle, 4).join(" ");
  return `VERAFUND ${compactAddress} M${milestoneId} ${titleMarker} ${utcDate}`.trim();
}

const MILESTONE_TAG_COLORS: Record<number, string> = {
  0: "neo-tag-yellow",   // Pending
  1: "neo-tag-blue",     // Submitted
  2: "neo-tag-purple",   // Voting
  3: "neo-tag-green",    // Approved
  4: "neo-tag-red",      // Rejected
};

function getMilestoneUnlockPercent(milestone: MilestoneInfo, milestones: MilestoneInfo[]) {
  return milestones
    .slice(0, milestone.id + 1)
    .reduce((sum, entry) => sum + entry.fundPercent, 0);
}

function getMilestoneDisplayState(
  milestone: MilestoneInfo,
  campaign: CampaignInfo,
  milestones: MilestoneInfo[]
): { label: string; tagClass: string; helperText: string | null } {
  const unlockPercent = getMilestoneUnlockPercent(milestone, milestones);
  const bootstrapUnlockPercent = milestones[0]?.fundPercent ?? campaign.bootstrapPercent;
  const fundingUnlocked =
    campaign.goalAmount > 0n &&
    campaign.raisedAmount * 100n >= campaign.goalAmount * BigInt(unlockPercent);
  const previousMilestoneApproved =
    milestone.id === 0 || milestones[milestone.id - 1]?.status === 3;

  if (milestone.status === 0 && milestone.id === 0 && !campaign.bootstrapReleased) {
    return {
      label: `Locked until ${unlockPercent}% funded`,
      tagClass: "neo-tag-outline",
      helperText:
        `Bootstrap is a ${milestone.fundPercent}% tranche and releases as soon as total donations reach ${unlockPercent}% of the goal.`,
    };
  }

  if (milestone.status === 0 && milestone.id > 0 && !campaign.bootstrapReleased) {
    return {
      label: "Waiting for bootstrap release",
      tagClass: "neo-tag-outline",
      helperText:
        `This milestone can open after the bootstrap tranche is funded at ${bootstrapUnlockPercent}% of the goal.`,
    };
  }

  if (milestone.status === 0 && milestone.id > 0 && !previousMilestoneApproved) {
    return {
      label: `Waiting for Milestone ${milestone.id - 1}`,
      tagClass: "neo-tag-outline",
      helperText:
        `Milestone ${milestone.id} opens only after Milestone ${milestone.id - 1} is approved.`,
    };
  }

  if (milestone.status === 0 && milestone.id > 0 && !fundingUnlocked) {
    return {
      label: `Locked until ${unlockPercent}% funded`,
      tagClass: "neo-tag-outline",
      helperText:
        `This milestone is a ${milestone.fundPercent}% tranche and opens once total funding reaches ${unlockPercent}% of the campaign goal.`,
    };
  }

  if (milestone.status === 0 && milestone.id > 0) {
    return {
      label: "Ready for submission",
      tagClass: "neo-tag-blue",
      helperText:
        "Funding for this milestone is unlocked. The organiser can now submit evidence for review.",
    };
  }

  return {
    label: MILESTONE_STATUS[milestone.status],
    tagClass: MILESTONE_TAG_COLORS[milestone.status] || "neo-tag-yellow",
    helperText: null,
  };
}

function isMilestoneReadyForSubmission(
  milestone: MilestoneInfo,
  campaign: CampaignInfo,
  milestones: MilestoneInfo[]
) {
  if (milestone.id === 0 || milestone.status !== 0 || !campaign.bootstrapReleased) {
    return false;
  }

  const unlockPercent = milestones
    .slice(0, milestone.id + 1)
    .reduce((sum, entry) => sum + entry.fundPercent, 0);
  const fundingUnlocked =
    campaign.goalAmount > 0n &&
    campaign.raisedAmount * 100n >= campaign.goalAmount * BigInt(unlockPercent);
  const previousMilestoneApproved = milestones[milestone.id - 1]?.status === 3;

  return fundingUnlocked && previousMilestoneApproved;
}

function getEvidenceStorageKey(campaignAddress: string) {
  return `verafund:evidence:${campaignAddress.toLowerCase()}`;
}

function getPrimaryIpfsUrl(cid: string) {
  return getMediaProxyUrl(null, cid) || "#";
}

function getGeospatialTone(status?: GeospatialReview["status"] | null) {
  if (status === "Consistent") return "neo-tag-green";
  if (status === "Questionable") return "neo-tag-yellow";
  if (status === "Mismatch") return "neo-tag-red";
  return "neo-tag-blue";
}

function formatEvidenceTimestamp(value: string | null | undefined) {
  if (!value) return "Not found in the original image metadata";

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Metadata timestamp could not be read";
  }

  return parsedDate.toLocaleString();
}

export default function CampaignDetail({ wallet }: DetailProps) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, error, refetch } = useCampaign(wallet.provider, address);

  const [donateAmount, setDonateAmount] = useState("");
  const [donating, setDonating] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isDonateInputHovered, setIsDonateInputHovered] = useState(false);
  const [isDonateInputFocused, setIsDonateInputFocused] = useState(false);

  // Milestone submission
  const [submitMilestoneId, setSubmitMilestoneId] = useState<number | null>(null);
  const [submitFiles, setSubmitFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [claimedLatitude, setClaimedLatitude] = useState("");
  const [claimedLongitude, setClaimedLongitude] = useState("");
  const [claimedLocationLabel, setClaimedLocationLabel] = useState("");
  const [locating, setLocating] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [refundAmount, setRefundAmount] = useState<bigint>(0n);
  const [staleActionLoading, setStaleActionLoading] = useState(false);
  const [evidenceMetadataByMilestone, setEvidenceMetadataByMilestone] = useState<EvidenceMetadataMap>({});
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([]);
  const [auditTrailLoading, setAuditTrailLoading] = useState(false);
  const [auditTrailError, setAuditTrailError] = useState<string | null>(null);
  const [heroBannerMissing, setHeroBannerMissing] = useState(false);

  // Voting
  const [votingId, setVotingId] = useState<number | null>(null);
  const [votedMilestones, setVotedMilestones] = useState<MilestoneVoteMap>({});

  const isNGO = wallet.account?.toLowerCase() === campaign?.ngoAddress.toLowerCase();
  const heroBannerSource =
    campaign?.profile?.coverImageDataUrl ||
    campaign?.profile?.coverImageUrl ||
    campaign?.profile?.galleryImages?.[0]?.url ||
    null;
  const creatorAvatarSource =
    campaign?.profile?.creatorProfile?.profileImageDataUrl ||
    campaign?.profile?.creatorProfile?.profileImageUrl ||
    null;
  const remainingGoalWei = campaign ? campaign.goalAmount - campaign.raisedAmount : 0n;
  const remainingGoalEth = campaign ? formatEth(remainingGoalWei) : "0";
  const campaignCategoryLabels = normalizeCampaignCategories(
    campaign?.profile?.category
  );
  const currentReviewTime = useMemo(() => new Date().toLocaleString(), []);
  const parsedDonateAmount =
    donateAmount.trim() === ""
      ? null
      : (() => {
          try {
            return ethers.parseEther(donateAmount);
          } catch {
            return null;
          }
        })();
  const exceedsRemainingGoal =
    parsedDonateAmount !== null && remainingGoalWei >= 0n && parsedDonateAmount > remainingGoalWei;
  const canDonate =
    !donating &&
    parsedDonateAmount !== null &&
    parsedDonateAmount > 0n &&
    !exceedsRemainingGoal;

  useEffect(() => {
    if (!address || typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(getEvidenceStorageKey(address));
      if (!stored) return;
      const parsed = JSON.parse(stored) as EvidenceMetadataMap;
      setEvidenceMetadataByMilestone(parsed);
    } catch {
      // Ignore malformed local evidence cache.
    }
  }, [address]);

  useEffect(() => {
    if (!address || typeof window === "undefined") return;

    try {
      window.localStorage.setItem(
        getEvidenceStorageKey(address),
        JSON.stringify(evidenceMetadataByMilestone)
      );
    } catch {
      // Ignore storage quota errors.
    }
  }, [address, evidenceMetadataByMilestone]);

  useEffect(() => {
    let cancelled = false;

    async function loadVoteStatus() {
      if (!address || !wallet.account || !wallet.provider || milestones.length === 0) {
        setVotedMilestones({});
        return;
      }

      try {
        const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.provider);
        const voteStatuses = await Promise.all(
          milestones
            .filter((milestone) => milestone.id > 0)
            .map(async (milestone) => {
              const hasVoted = await contract.hasVoted(wallet.account, milestone.id);
              return [milestone.id, Boolean(hasVoted)] as const;
            })
        );

        if (!cancelled) {
          setVotedMilestones(Object.fromEntries(voteStatuses));
        }
      } catch {
        if (!cancelled) {
          setVotedMilestones({});
        }
      }
    }

    loadVoteStatus();
    return () => {
      cancelled = true;
    };
  }, [address, milestones, wallet.account, wallet.provider]);

  useEffect(() => {
    async function fetchEvidenceMetadata() {
      if (!address) return;

      const candidates = milestones.filter((milestone) => milestone.id > 0 && milestone.ipfsHash);

      await Promise.all(
        candidates.map(async (milestone) => {
          try {
            const res = await fetch(
              `${API_BASE}/evidence-metadata?campaignAddress=${address}&milestoneId=${milestone.id}`
            );

            if (!res.ok) return;
            const data = await res.json();
            setEvidenceMetadataByMilestone((prev) => {
              const next = {
                ...prev,
                [milestone.id]: data,
              };
              return next;
            });
          } catch {
            // Ignore cache misses for now.
          }
        })
      );
    }

    fetchEvidenceMetadata();
  }, [address, milestones]);

  useEffect(() => {
    setHeroBannerMissing(false);
  }, [heroBannerSource, address]);

  useEffect(() => {
    async function fetchRefundState() {
      if (!wallet.provider || !address) {
        setIsStale(false);
        setRefundAmount(0n);
        return;
      }

      try {
        const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.provider);
        const stale = await contract.isStale();
        setIsStale(Boolean(stale));

        if (wallet.account) {
          const amount = await contract.getRefundAmount(wallet.account);
          setRefundAmount(amount);
        } else {
          setRefundAmount(0n);
        }
      } catch {
        setIsStale(false);
        setRefundAmount(0n);
      }
    }

    fetchRefundState();
  }, [wallet.provider, wallet.account, address, campaign?.status, milestones]);

  useEffect(() => {
    async function fetchAuditTrail() {
      if (!address) {
        setAuditTrail([]);
        return;
      }

      setAuditTrailLoading(true);
      setAuditTrailError(null);

      try {
        const response = await fetch(
          `${API_BASE}/campaign-audit?address=${encodeURIComponent(address)}`
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(getReadableAuditTrailError(payload?.error));
        }

        setAuditTrail((payload?.entries || []) as AuditTrailEntry[]);
      } catch (err: unknown) {
        setAuditTrail([]);
        setAuditTrailError(
          getReadableAuditTrailError(err instanceof Error ? err.message : null)
        );
      } finally {
        setAuditTrailLoading(false);
      }
    }

    fetchAuditTrail();
  }, [address, campaign?.status, milestones]);

  // ── Donate ──
  const handleDonate = async () => {
    if (!wallet.signer || !address || !donateAmount) return;
    setDonating(true);
    setTxHash(null);
    try {
      const parsedAmount = parsedDonateAmount ?? ethers.parseEther(donateAmount);
      if (parsedAmount > remainingGoalWei) {
        toast.error(`Donation exceeds remaining goal of ${formatEthLabel(remainingGoalWei)}`, {
          id: "donate",
        });
        return;
      }

      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.donate({
        value: parsedAmount,
      });
      setTxHash(tx.hash);
      toast.loading("Waiting for confirmation...", { id: "donate" });
      await tx.wait();
      toast.success("Donation confirmed!", { id: "donate" });
      setDonateAmount("");

      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Donation failed", { id: "donate" });
    } finally {
      setDonating(false);
    }
  };

  // ── Submit Milestone ──
  const handleSubmitMilestone = async () => {
    if (!wallet.signer || !address || submitMilestoneId === null || !submitFiles?.length) return;
    const validatedFiles = validateSelectedImages(submitFiles);
    if (!validatedFiles.ok) {
      toast.error(validatedFiles.error, { id: "submit" });
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload to IPFS
      toast.loading("Uploading evidence to IPFS...", { id: "submit" });
      const formData = new FormData();
      for (const file of validatedFiles.files) {
        formData.append("files", file);
      }
      formData.append("claimedLatitude", claimedLatitude);
      formData.append("claimedLongitude", claimedLongitude);
      formData.append("claimedLocationLabel", claimedLocationLabel);
      formData.append("campaignAddress", address);
      formData.append("milestoneId", String(submitMilestoneId));
      const uploadRes = await fetchWithTimeout(
        `${API_BASE}/upload-evidence`,
        {
        method: "POST",
        body: formData,
        },
        UPLOAD_TIMEOUT_MS
      );
      if (!uploadRes.ok) {
        const uploadError = await uploadRes.json().catch(() => null);
        throw new Error(uploadError?.error || "Evidence upload failed");
      }
      const { cids, uploads, claimedLocation, proofCode } = await uploadRes.json();

      // 2. Submit on-chain (use first CID as the hash)
      toast.loading("Submitting on-chain...", { id: "submit" });
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(submitMilestoneId, cids[0]);
      await waitForTransactionWithTimeout(tx, CHAIN_CONFIRMATION_TIMEOUT_MS);

      // 3. Trigger AI verification
      toast.loading("Running AI verification...", { id: "submit" });
      const milestone = milestones.find((m) => m.id === submitMilestoneId);
      const verifyRes = await fetchWithTimeout(
        `${API_BASE}/verify-milestone`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestoneId: submitMilestoneId,
          campaignAddress: address,
          cids,
          milestoneDescription: milestone?.description || "",
          uploads,
          claimedLocation,
          proofCode,
          campaignTitle: campaign?.title || "VeraFund Campaign",
          milestoneTitle: milestone?.title || `Milestone ${submitMilestoneId}`,
        }),
        },
        VERIFY_TIMEOUT_MS
      );
      const verdict = (await verifyRes.json().catch(() => null)) as AIVerdict | null;
      if (!verifyRes.ok) {
        throw new Error((verdict as { error?: string } | null)?.error || "Verification failed");
      }

      toast.success("Milestone submitted and verified.", { id: "submit" });
      setEvidenceMetadataByMilestone((prev) => ({
        ...prev,
        [submitMilestoneId]: {
          uploads,
          claimedLocation,
          authenticity: verdict?.authenticity,
          geospatial: verdict?.geospatial || null,
          binding: verdict?.binding || null,
          aiReview: verdict
            ? {
                score: verdict.score,
                verdict: verdict.verdict,
                summary: verdict.summary,
              }
            : null,
        },
      }));
      setSubmitMilestoneId(null);
      setSubmitFiles(null);
      setClaimedLatitude("");
      setClaimedLongitude("");
      setClaimedLocationLabel("");
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Submission failed", { id: "submit" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Vote ──
  const handleVote = async (milestoneId: number, approve: boolean) => {
    if (!wallet.signer || !address) return;
    if (votedMilestones[milestoneId]) {
      toast.error("You have already voted on this milestone.", { id: "vote" });
      return;
    }
    setVotingId(milestoneId);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      toast.loading("Submitting vote...", { id: "vote" });
      const tx = await contract.vote(milestoneId, approve);
      await tx.wait();
      setVotedMilestones((current) => ({
        ...current,
        [milestoneId]: true,
      }));
      toast.success(approve ? "Voted to approve." : "Voted to challenge.", { id: "vote" });
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Vote failed";
      toast.error(getReadableVoteError(message), { id: "vote" });
    } finally {
      setVotingId(null);
    }
  };

  // ── Resolve Vote ──
  const handleResolve = async (milestoneId: number) => {
    try {
      if (!wallet.signer || !address) {
        toast.error("Connect your wallet to resolve the vote on-chain.", { id: "resolve" });
        return;
      }

      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      toast.loading("Submitting on-chain resolution...", { id: "resolve" });
      const tx = await contract.resolveVote(milestoneId);
      await tx.wait();
      toast.success("Vote resolved on-chain.", { id: "resolve" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Resolution failed", { id: "resolve" });
    }
  };

  const handleMarkStale = async () => {
    if (!wallet.signer || !address) return;
    setStaleActionLoading(true);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.markCampaignStale();
      toast.loading("Marking campaign as stale...", { id: "stale" });
      await tx.wait();
      toast.success("Campaign marked stale. Refunds are now available.", { id: "stale" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to mark campaign stale", { id: "stale" });
    } finally {
      setStaleActionLoading(false);
    }
  };

  const handleRefund = async () => {
    if (!wallet.signer || !address) return;
    setStaleActionLoading(true);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.refund();
      toast.loading("Claiming refund...", { id: "refund" });
      await tx.wait();
      toast.success("Refund claimed.", { id: "refund" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Refund failed", { id: "refund" });
    } finally {
      setStaleActionLoading(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation is not available in this browser.", { id: "location" });
      return;
    }

    setLocating(true);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);

      setClaimedLatitude(latitude);
      setClaimedLongitude(longitude);
      setClaimedLocationLabel((current) =>
        current.trim() || `Current project site (${latitude}, ${longitude})`
      );
      toast.success("Current location added.", { id: "location" });
    } catch (err: unknown) {
      const geoError = err as GeolocationPositionError | undefined;
      const message =
        geoError?.code === 1
          ? "Location permission was denied."
          : geoError?.code === 2
          ? "Could not determine the current location."
          : geoError?.code === 3
          ? "Location request timed out."
          : "Failed to fetch the current location.";
      toast.error(message, { id: "location" });
    } finally {
      setLocating(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading from blockchain...</p>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="page-container">
        <div className="neo-card" style={{ background: "#fca5a5" }}>
          <p><strong>Error:</strong> {error || "Campaign not found"}</p>
        </div>
      </div>
    );
  }

  const goal = formatEth(campaign.goalAmount);
  const raised = formatEth(campaign.raisedAmount);
  const percent = getProgressPercentNumber(campaign.raisedAmount, campaign.goalAmount);
  const percentLabel = formatPercent(campaign.raisedAmount, campaign.goalAmount);
  const deadline = new Date(campaign.campaignDeadline * 1000);
  const campaignDeadlinePassed = deadline.getTime() <= Date.now();
  const fundraisingOpen =
    !campaignDeadlinePassed &&
    campaign.status !== 2 &&
    campaign.status !== 3 &&
    remainingGoalWei > 0n;
  const bootstrapUnlockPercent = milestones[0]?.fundPercent ?? campaign.bootstrapPercent;
  const bootstrapUnlockWei =
    campaign.goalAmount > 0n ? (campaign.goalAmount * BigInt(bootstrapUnlockPercent)) / 100n : 0n;
  const bootstrapMarkerPercent = Math.min(bootstrapUnlockPercent, 100);
  const bootstrapMarkerEdgeClass =
    bootstrapMarkerPercent <= 8
      ? "is-left-edge"
      : bootstrapMarkerPercent >= 92
        ? "is-right-edge"
        : "";
  const projectedRaisedWei =
    parsedDonateAmount !== null && parsedDonateAmount > 0n
      ? campaign.raisedAmount + parsedDonateAmount > campaign.goalAmount
        ? campaign.goalAmount
        : campaign.raisedAmount + parsedDonateAmount
      : campaign.raisedAmount;
  const projectedPercent = getProgressPercentNumber(projectedRaisedWei, campaign.goalAmount);
  const projectedPercentLabel = formatPercent(projectedRaisedWei, campaign.goalAmount);
  const showDonateProjection = isDonateInputHovered || isDonateInputFocused;
  const donationPreviewActive =
    showDonateProjection &&
    !isNGO &&
    parsedDonateAmount !== null &&
    parsedDonateAmount > 0n &&
    !exceedsRemainingGoal;
  const projectedExtensionPercent = Math.max(projectedPercent - percent, 0);
  const crossesBootstrapWithPreview =
    !campaign.bootstrapReleased &&
    bootstrapUnlockWei > 0n &&
    campaign.raisedAmount < bootstrapUnlockWei &&
    projectedRaisedWei >= bootstrapUnlockWei;
  const getEvidenceForMilestone = (milestone: MilestoneInfo) => {
    const cached = evidenceMetadataByMilestone[milestone.id];
    if (cached?.uploads?.length) return cached;
    if (!milestone.ipfsHash) return null;

    return {
      uploads: [
        {
          cid: milestone.ipfsHash,
          fileName: "Submitted evidence",
          location: null,
          comparison: null,
          authenticity: null,
        },
      ],
      claimedLocation: null,
      authenticity: undefined,
      geospatial: null,
      aiReview: null,
    };
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="detail-header">
        <div className={`campaign-detail-hero ${heroBannerMissing || !heroBannerSource ? "is-fallback" : ""}`}>
          {!heroBannerMissing && heroBannerSource ? (
            <img
              src={heroBannerSource}
              alt={`${campaign.title} banner`}
              className="campaign-detail-hero-image"
              onError={(event) => {
                event.currentTarget.style.display = "none";
                setHeroBannerMissing(true);
              }}
            />
          ) : (
            <div className="campaign-detail-hero-fallback">No Banner</div>
          )}
        </div>
        <div className="page-title-block detail-title-block">
          <h1 className="page-title">{campaign.title}</h1>
        </div>
        <div className="detail-meta">
          <span className={`neo-tag ${MILESTONE_TAG_COLORS[campaign.status] || "neo-tag-yellow"}`}>
            {CAMPAIGN_STATUS[campaign.status]}
          </span>
          {campaignCategoryLabels.map((category) => (
            <span key={category} className="neo-tag neo-tag-accent">
              {category}
            </span>
          ))}
          <span className="neo-tag neo-tag-accent">
            {campaign.bootstrapPercent}% bootstrap
          </span>
          <span className="neo-tag neo-tag-blue">
            {campaign.milestoneCount} milestones
          </span>
        </div>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          by <strong>{campaign.ngoName}</strong> · Deadline:{" "}
          {deadline.toLocaleDateString()}
        </p>
        <p style={{ marginTop: 8, color: "var(--text-secondary)" }}>
          {campaign.description}
        </p>
      </div>

      {campaign.profile && (
        <div className="detail-section">
          <h3 className="detail-section-title">Organisation Details</h3>
          {campaign.profile.creatorProfile && (
            <div className="creator-campaign-card">
            <div className="creator-campaign-head">
                {creatorAvatarSource ? (
                  <img
                    className="creator-campaign-avatar"
                    src={creatorAvatarSource}
                    alt={campaign.profile.creatorProfile.displayName || campaign.ngoName}
                  />
                ) : null}
                <div>
                  <h4>{campaign.profile.creatorProfile.displayName || campaign.ngoName}</h4>
                  <p className="creator-campaign-meta">
                    {campaign.profile.creatorProfile.roleTitle || "Organizer"}
                    {campaign.profile.creatorProfile.location ? ` · ${campaign.profile.creatorProfile.location}` : ""}
                  </p>
                </div>
              </div>
              <p className="creator-campaign-copy">
                {campaign.profile.creatorProfile.aboutMe || "No organizer introduction provided."}
              </p>
              {(campaign.profile.creatorProfile.causes?.length || 0) > 0 && (
                <div className="creator-profile-pill-row">
                  {campaign.profile.creatorProfile.causes?.map((cause) => (
                    <span key={cause} className="profile-inline-stat">{cause}</span>
                  ))}
                </div>
              )}
              {(campaign.profile.creatorProfile.associatedOrganizations?.length || 0) > 0 && (
                <div className="campaign-profile-panel" style={{ marginTop: 16 }}>
                  <h4>Associations</h4>
                  <ul className="campaign-profile-list">
                    {campaign.profile.creatorProfile.associatedOrganizations?.map((organization) => (
                      <li key={organization}>{organization}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="campaign-profile-links" style={{ marginTop: 16 }}>
                {campaign.profile.creatorProfile.website && (
                  <a className="tx-link" href={campaign.profile.creatorProfile.website} target="_blank" rel="noreferrer">
                    Website
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="campaign-profile-grid">
            <div className="campaign-profile-panel">
              <h4>About the organiser</h4>
              <p>{campaign.profile.organizationBio || "No background provided."}</p>
            </div>
            <div className="campaign-profile-panel">
              <h4>How funds will be used</h4>
              <p>{campaign.profile.useOfFunds || "No use-of-funds note provided."}</p>
            </div>
            <div className="campaign-profile-panel">
              <h4>Campaign facts</h4>
              <ul className="campaign-profile-list">
                <li>Beneficiary: {campaign.profile.beneficiary || "Not provided"}</li>
                <li>Organisation type: {campaign.profile.organizationType || "Not provided"}</li>
                <li>Founded year: {campaign.profile.foundedYear || "Not provided"}</li>
                <li>Location: {campaign.profile.locationLabel || "Not provided"}</li>
              </ul>
            </div>
            <div className="campaign-profile-panel">
              <h4>External links</h4>
              <div className="campaign-profile-links">
                {campaign.profile.website && <a className="tx-link" href={campaign.profile.website} target="_blank" rel="noreferrer">Website</a>}
                {!campaign.profile.website && (
                  <p>No external links provided.</p>
                )}
              </div>
            </div>
          </div>
          {campaign.profile.proofLinks && campaign.profile.proofLinks.length > 0 && (
            <div className="campaign-proof-links">
              <h4>Reference material</h4>
              {campaign.profile.proofLinks.map((link) => (
                <a key={link} className="tx-link" href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
              ))}
            </div>
          )}
          {campaign.profile.galleryImages && campaign.profile.galleryImages.length > 0 && (
            <div className="campaign-proof-links">
              <h4>Campaign gallery</h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 14,
                }}
              >
                {campaign.profile.galleryImages.map((image, index) =>
                  image.url ? (
                    <a
                      key={`${image.cid || image.url}-${index}`}
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      className="evidence-image-link"
                    >
                      <img
                        src={image.url}
                        alt={image.alt || `${campaign.title} gallery image ${index + 1}`}
                        className="evidence-image-preview"
                        loading="lazy"
                      />
                    </a>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="detail-section">
        <h3 className="detail-section-title">Audit Trail</h3>
        <p className="audit-trail-intro">
          Every donation, vote, fund release, rejection, and refund event is shown here in plain language.
        </p>

        {auditTrailLoading && (
          <div className="loading-spinner" style={{ padding: "32px 0" }}>
            <div className="spinner" />
          </div>
        )}

        {auditTrailError && (
          <div className="form-error-banner">{auditTrailError}</div>
        )}

        {!auditTrailLoading && !auditTrailError && auditTrail.length === 0 && (
          <div className="neo-card" style={{ background: "var(--bg-card)" }}>
            No on-chain activity has been recorded for this campaign yet.
          </div>
        )}

        {!auditTrailLoading && !auditTrailError && auditTrail.length > 0 && (
          <div className="audit-trail-list">
            {auditTrail.map((entry) => (
              <div key={entry.id} className="audit-trail-item">
                <div className="audit-trail-marker" />
                <div className="audit-trail-content">
                  <div className="audit-trail-header">
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.timestamp
                        ? new Date(entry.timestamp * 1000).toLocaleString()
                        : `Block ${entry.blockNumber}`}
                    </span>
                  </div>
                  <p>{entry.summary}</p>
                  <a
                    className="tx-link"
                    href={`https://sepolia.etherscan.io/tx/${entry.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction on Etherscan
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="detail-stats">
        <div className="stat-card">
          <div className="stat-value">{raised}</div>
          <div className="stat-label">ETH Raised</div>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-value">{goal}</div>
          <div className="stat-label">ETH Goal</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{percentLabel}%</div>
          <div className="stat-label">Funded</div>
        </div>
      </div>

      {/* Progress */}
      <div className="funding-progress-shell">
        <div className="funding-progress-summary">
          <span>Current funding: <strong>{percentLabel}%</strong></span>
          <span>
            Bootstrap goal: <strong>{bootstrapMarkerPercent}%</strong>
            {bootstrapUnlockWei > 0n ? ` (${formatEthLabel(bootstrapUnlockWei)})` : ""}
          </span>
          {donationPreviewActive && (
            <span className={crossesBootstrapWithPreview ? "funding-progress-summary-hit" : ""}>
              With this donation: <strong>{projectedPercentLabel}%</strong>
              {crossesBootstrapWithPreview ? " · bootstrap unlocks" : ""}
            </span>
          )}
        </div>
        <div className="funding-progress-track" style={{ marginBottom: 32 }}>
          <div className="funding-progress-fill" style={{ width: `${percent}%` }}>
            {percentLabel}%
          </div>
          {donationPreviewActive && projectedExtensionPercent > 0 && (
            <div
              className="funding-progress-preview"
              style={{ left: `${percent}%`, width: `${projectedExtensionPercent}%` }}
            >
              {projectedPercentLabel}%
            </div>
          )}
          <div
            className={`funding-progress-marker ${campaign.bootstrapReleased ? "is-reached" : ""} ${bootstrapMarkerEdgeClass}`.trim()}
            style={{ left: `${bootstrapMarkerPercent}%` }}
          >
            <span className="funding-progress-marker-line" />
            <span className="funding-progress-marker-label">
              {campaign.bootstrapReleased ? "Bootstrap unlocked" : "Bootstrap goal"}
            </span>
          </div>
        </div>
      </div>

      {(isStale || campaign.status === 3 || refundAmount > 0n) && (
        <div className="detail-section">
          <h3 className="detail-section-title">Refund Protection</h3>
          {campaign.status === 1 && isStale && (
            <div className="donate-info">
              This campaign has gone quiet for more than 60 days after a milestone deadline. Any user can mark it stale to unlock proportional refunds for donors.
            </div>
          )}
          {campaign.status === 1 && isStale && wallet.account && (
            <button
              className="neo-btn neo-btn-outline"
              onClick={handleMarkStale}
              disabled={staleActionLoading}
            >
              {staleActionLoading ? "Processing..." : "Mark Campaign Stale"}
            </button>
          )}
          {campaign.status === 3 && refundAmount > 0n && wallet.account && (
            <>
              <div className="donate-info">
                Refund available: <strong>{formatEthLabel(refundAmount)}</strong>
              </div>
              <button
                className="neo-btn neo-btn-primary"
                onClick={handleRefund}
                disabled={staleActionLoading}
              >
                {staleActionLoading ? "Processing..." : "Claim Refund"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Donate Box */}
      {wallet.account && fundraisingOpen && (
      <div className="detail-section">
        <h3 className="detail-section-title">Donate</h3>
        <div className="donate-box">
          <div className="donate-info">
            {campaign.bootstrapReleased ? (
              <>
                Bootstrap has already been released. New donations now unlock the next execution
                milestones as their cumulative funding targets are reached.
              </>
            ) : (
              <>
                Bootstrap unlock target: <strong>{bootstrapUnlockPercent}%</strong> (
                {formatEthLabel(bootstrapUnlockWei)}). The initial operating grant releases as soon
                as the campaign reaches that funding mark.
              </>
            )}
          </div>
          <div className="donate-info" style={{ marginTop: 10 }}>
            Remaining to fund: <strong>{formatEthLabel(remainingGoalWei)}</strong>
          </div>
          {isNGO ? (
            <div className="milestone-gate-banner" style={{ marginTop: 14, marginBottom: 0 }}>
              <strong>Campaign owners cannot donate to their own campaign.</strong> Connect a
              separate donor wallet if you want to test the donor flow.
            </div>
          ) : (
            <>
              <div className="donate-input-row" style={{ marginTop: 14 }}>
                <input
                  type="number"
                  className="neo-input"
                  placeholder="Amount in ETH"
                  step="any"
                  min="0"
                  max={remainingGoalEth}
                  value={donateAmount}
                  onChange={(e) => setDonateAmount(e.target.value)}
                  onMouseEnter={() => setIsDonateInputHovered(true)}
                  onMouseLeave={() => setIsDonateInputHovered(false)}
                  onFocus={() => setIsDonateInputFocused(true)}
                  onBlur={() => setIsDonateInputFocused(false)}
                />
                <button
                  className="neo-btn neo-btn-primary"
                  onClick={handleDonate}
                  disabled={!canDonate}
                >
                  {donating ? "Confirming..." : "Donate"}
                </button>
              </div>
              {exceedsRemainingGoal && (
                <p className="form-error-inline">
                  Enter an amount up to the remaining goal.
                </p>
              )}
              {parsedDonateAmount !== null && parsedDonateAmount > 0n && (
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                  Your voting weight: <strong>{formatEthLabel(parsedDonateAmount)}</strong>
                </p>
              )}
              {donationPreviewActive && (
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 8 }}>
                  This donation would move funding from <strong>{percentLabel}%</strong> to{" "}
                  <strong>{projectedPercentLabel}%</strong>
                  {crossesBootstrapWithPreview
                    ? ", which reaches the bootstrap release line."
                    : "."}
                </p>
              )}
              {txHash && (
                <div className="tx-confirmation tx-success">
                  <p>Transaction submitted.</p>
                  <a
                    className="tx-link"
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Etherscan →
                  </a>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="detail-section">
        <h3 className="detail-section-title">Milestones</h3>
        {campaign.status !== 2 && campaign.status !== 3 && (
          <div className="milestone-gate-banner">
            {!campaign.bootstrapReleased ? (
              <>
                <strong>Bootstrap unlocks first at {bootstrapUnlockPercent}% funded.</strong> This
                campaign is currently {percentLabel}% funded. Once bootstrap is released, each
                later milestone opens when its own cumulative funding threshold is reached and the
                previous milestone is approved.
              </>
            ) : (
              <>
                <strong>Bootstrap is already live.</strong> Later milestones now open one by one as
                the campaign reaches each cumulative funding threshold and previous milestones are
                approved.
              </>
            )}
          </div>
        )}
        {milestones.map((m: MilestoneInfo) => {
          const isVoting = m.status === 2;
          const totalVotes = m.votesFor + m.votesAgainst;
          const allVotingWeightCast = campaign.raisedAmount > 0n && totalVotes >= campaign.raisedAmount;
          const votingOpen =
            isVoting &&
            Date.now() / 1000 <= m.votingDeadline &&
            !allVotingWeightCast;
          const votingClosed =
            isVoting &&
            (Date.now() / 1000 > m.votingDeadline || allVotingWeightCast);
          const approvePercent = totalVotes > 0n ? Number((m.votesFor * 100n) / totalVotes) : 0;
          const challengePercent = totalVotes > 0n ? 100 - approvePercent : 0;
          const hasCurrentWalletVoted = wallet.account ? votedMilestones[m.id] === true : false;
          const milestoneEvidence = getEvidenceForMilestone(m);
          const milestoneUploads = milestoneEvidence?.uploads ?? [];
          const milestoneDisplay = getMilestoneDisplayState(m, campaign, milestones);
          const unlockPercent = getMilestoneUnlockPercent(m, milestones);

          return (
            <div className="milestone-card" key={m.id}>
              <div className="milestone-card-header">
                <div>
                  <span className="milestone-card-title">
                    {m.id === 0 ? "Bootstrap · " : `#${m.id} · `}
                    {m.title}
                  </span>
                  <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    (unlocks at {unlockPercent}%)
                  </span>
                </div>
                <span className={`neo-tag ${milestoneDisplay.tagClass}`}>
                  {milestoneDisplay.label}
                </span>
              </div>

              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>
                {m.id === 0
                  ? `Bootstrap reserve released automatically once donations reach ${bootstrapUnlockPercent}% of the campaign goal.`
                  : m.description}
              </p>

              {milestoneDisplay.helperText && (
                <p className="milestone-helper-copy">{milestoneDisplay.helperText}</p>
              )}

              {m.ipfsHash && (
                <p style={{ fontSize: 13 }}>
                  Evidence:{" "}
                  <a
                    className="tx-link"
                    href={getPrimaryIpfsUrl(m.ipfsHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.ipfsHash.slice(0, 16)}...
                  </a>
                </p>
              )}

              {milestoneUploads.length > 0 && (
                <div className="evidence-location-panel">
                  <p style={{ fontWeight: 700, marginBottom: 8 }}>Submitted Evidence</p>
                  {milestoneEvidence?.aiReview && (
                    <div className="evidence-ai-card">
                      <div className="evidence-ai-header">
                        <div>
                          <p className="evidence-ai-kicker">OpenAI GPT-4o with Vision</p>
                          <h4 className="evidence-ai-title">AI Evidence Review</h4>
                        </div>
                        <div className="evidence-ai-score-wrap">
                          <span className={`neo-tag ${getAiReviewTone(milestoneEvidence.aiReview.verdict)}`}>
                            {milestoneEvidence.aiReview.verdict}
                          </span>
                          <div className="evidence-ai-score">
                            <strong>{milestoneEvidence.aiReview.score}</strong>
                            <span>/100</span>
                          </div>
                        </div>
                      </div>
                      <div className="evidence-ai-grid">
                        <div className="evidence-ai-metric">
                          <span className="evidence-ai-label">Visual match</span>
                          <strong>{getAiScoreBand(milestoneEvidence.aiReview.score)}</strong>
                        </div>
                        <div className="evidence-ai-metric">
                          <span className="evidence-ai-label">Milestone asked</span>
                          <strong>{m.title}</strong>
                        </div>
                        <div className="evidence-ai-metric">
                          <span className="evidence-ai-label">Review time</span>
                          <strong>{currentReviewTime}</strong>
                        </div>
                      </div>
                      <p className="evidence-ai-summary">
                        {milestoneEvidence.aiReview.summary}
                      </p>
                      <div className="evidence-ai-checks">
                        <div className="evidence-ai-check">
                          <span className={`neo-tag ${getAiReviewTone(milestoneEvidence.aiReview.verdict)}`}>
                            {milestoneEvidence.aiReview.verdict === "Verified" ? "Passed" : milestoneEvidence.aiReview.verdict === "Flagged" ? "Flagged" : "Review"}
                          </span>
                          <div>
                            <strong>Image matches the milestone description</strong>
                            <p>
                              GPT-4o reviews whether the visible work in the uploaded image lines up
                              with the milestone description shown above.
                            </p>
                          </div>
                        </div>
                        <div className="evidence-ai-check">
                          <span className={`neo-tag ${milestoneEvidence.binding?.passed ? "neo-tag-green" : "neo-tag-red"}`}>
                            {milestoneEvidence.binding?.passed ? "Passed" : "Needs proof"}
                          </span>
                          <div>
                            <strong>Campaign-specific proof marker</strong>
                            <p>
                              VeraFund checks whether the image appears tied to this exact campaign
                              and milestone, not just a generic construction photo.
                            </p>
                          </div>
                        </div>
                        <div className="evidence-ai-check">
                          <span className={`neo-tag ${milestoneEvidence.geospatial ? getGeospatialTone(milestoneEvidence.geospatial.status) : "neo-tag-outline"}`}>
                            {milestoneEvidence.geospatial?.status || "Pending"}
                          </span>
                          <div>
                            <strong>Location and context consistency</strong>
                            <p>
                              GPS, locality, and other context checks are compared against the
                              claimed project site to support the AI decision.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {(milestoneEvidence?.authenticity || milestoneEvidence?.geospatial || milestoneEvidence?.binding || milestoneEvidence?.aiReview) && (
                    <div className="evidence-summary-card">
                      {milestoneEvidence.authenticity && (
                        <div className="evidence-summary-row">
                          <span className={`neo-tag ${milestoneEvidence.authenticity.passed ? "neo-tag-green" : "neo-tag-red"}`}>
                            {milestoneEvidence.authenticity.passed ? "Authenticity passed" : "Authenticity flagged"}
                          </span>
                          {milestoneEvidence.authenticity.duplicateCount > 0 && (
                            <span className="profile-inline-stat">
                              {milestoneEvidence.authenticity.duplicateCount} duplicate file match{milestoneEvidence.authenticity.duplicateCount > 1 ? "es" : ""}
                            </span>
                          )}
                        </div>
                      )}
                      {milestoneEvidence.aiReview && (
                        <div className="evidence-summary-row">
                          <span className={`neo-tag ${getAiReviewTone(milestoneEvidence.aiReview.verdict)}`}>
                            OpenAI visual check: {milestoneEvidence.aiReview.verdict}
                          </span>
                          <span className="profile-inline-stat">
                            Score {milestoneEvidence.aiReview.score}/100
                          </span>
                        </div>
                      )}
                      {milestoneEvidence.binding && (
                        <div className="evidence-summary-row">
                          <span className={`neo-tag ${milestoneEvidence.binding.passed ? "neo-tag-green" : "neo-tag-red"}`}>
                            Campaign proof: {milestoneEvidence.binding.status}
                          </span>
                          {milestoneEvidence.binding.proofCode && (
                            <span className="profile-inline-stat">
                              Code {milestoneEvidence.binding.proofCode}
                            </span>
                          )}
                          {milestoneEvidence.binding.previousMilestoneMatches.length > 0 && (
                            <span className="profile-inline-stat">
                              {milestoneEvidence.binding.previousMilestoneMatches.length} prior milestone match{milestoneEvidence.binding.previousMilestoneMatches.length > 1 ? "es" : ""}
                            </span>
                          )}
                        </div>
                      )}
                      {milestoneEvidence.geospatial && (
                        <div className="evidence-summary-row">
                          <span className={`neo-tag ${getGeospatialTone(milestoneEvidence.geospatial.status)}`}>
                            Geospatial review: {milestoneEvidence.geospatial.status}
                          </span>
                          <span className="profile-inline-stat">
                            Confidence {milestoneEvidence.geospatial.confidence}%
                          </span>
                          {typeof milestoneEvidence.geospatial.averageDistanceKm === "number" && (
                            <span className="profile-inline-stat">
                              Avg. distance {milestoneEvidence.geospatial.averageDistanceKm} km
                            </span>
                          )}
                        </div>
                      )}
                      {milestoneEvidence.geospatial?.summary && (
                        <p className="evidence-summary-copy">{milestoneEvidence.geospatial.summary}</p>
                      )}
                      {milestoneEvidence.geospatial?.keyClues?.length ? (
                        <div className="creator-profile-pill-row" style={{ marginTop: 10 }}>
                          {milestoneEvidence.geospatial.keyClues.map((clue) => (
                            <span key={clue} className="profile-inline-stat">{clue}</span>
                          ))}
                        </div>
                      ) : null}
                      {milestoneEvidence.binding?.notes?.length ? (
                        <ul className="evidence-issue-list">
                          {milestoneEvidence.binding.notes.slice(0, 4).map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      ) : null}
                      {milestoneEvidence.authenticity?.notes?.length ? (
                        <ul className="evidence-issue-list">
                          {milestoneEvidence.authenticity.notes.slice(0, 4).map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                  <div className="evidence-summary-card">
                    <div className="evidence-summary-row">
                      <span className="neo-tag neo-tag-outline">Reviewer checks</span>
                      <span className="profile-inline-stat">Current time {currentReviewTime}</span>
                    </div>
                    <p className="evidence-summary-copy">
                      To approve a milestone, VeraFund looks for an original site photo, GPS metadata when
                      available, a fresh capture time, a visible proof code for this campaign and milestone,
                      and visual progress that matches the milestone description.
                    </p>
                  </div>
                  {milestoneUploads.map((upload) => (
                    <div key={upload.cid} className="evidence-location-card">
                      <a
                        href={getPrimaryIpfsUrl(upload.cid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="evidence-image-link"
                      >
                        <img
                          src={getPrimaryIpfsUrl(upload.cid)}
                          alt={upload.fileName}
                          className="evidence-image-preview"
                          loading="lazy"
                        />
                      </a>
                      <div style={{ fontWeight: 700 }}>{upload.fileName}</div>
                      <p style={{ fontSize: 13 }}>
                        View file:{" "}
                        <a
                          className="tx-link"
                          href={getPrimaryIpfsUrl(upload.cid)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {upload.cid.slice(0, 16)}...
                        </a>
                      </p>
                      {upload.location ? (
                        <p style={{ fontSize: 13 }}>
                          Photo GPS:{" "}
                          <a
                            className="tx-link"
                            href={upload.location.googleMapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {upload.location.latitude.toFixed(5)}, {upload.location.longitude.toFixed(5)}
                          </a>
                          {" · "}
                          <a
                            className="tx-link"
                            href={upload.location.satelliteViewUrl || getSatelliteViewUrl(upload.location.latitude, upload.location.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Satellite view
                          </a>
                        </p>
                      ) : (
                        <p style={{ fontSize: 13 }}>
                          No GPS EXIF data was found in the original file. Ask the organiser to upload the
                          original phone-camera image with location services enabled, not a screenshot or edited export.
                        </p>
                      )}

                      <p style={{ fontSize: 13 }}>
                        Captured at:{" "}
                        <strong>{formatEvidenceTimestamp(upload.authenticity?.capturedAt)}</strong>
                        {upload.authenticity?.captureTiming?.status && (
                          <>
                            {" · "}
                            Review timing: <strong>{upload.authenticity.captureTiming.status}</strong>
                          </>
                        )}
                      </p>

                      {upload.location?.localityLabel && (
                        <p style={{ fontSize: 13 }}>
                          Reverse-geocoded locality: <strong>{upload.location.localityLabel}</strong>
                        </p>
                      )}

                      {upload.comparison?.claimedLocation?.googleMapsUrl && (
                        <p style={{ fontSize: 13 }}>
                          Claimed location:{" "}
                          <a
                            className="tx-link"
                            href={upload.comparison.claimedLocation.googleMapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {upload.comparison.claimedLocation.label || "Project site"}
                          </a>
                          {upload.comparison.claimedLocation.latitude !== undefined &&
                            upload.comparison.claimedLocation.longitude !== undefined && (
                              <>
                                {" · "}
                                <a
                                  className="tx-link"
                                  href={
                                    upload.comparison.claimedLocation.satelliteViewUrl ||
                                    getSatelliteViewUrl(
                                      upload.comparison.claimedLocation.latitude,
                                      upload.comparison.claimedLocation.longitude
                                    )
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Claimed site satellite view
                                </a>
                              </>
                            )}
                          {typeof upload.comparison.distanceKm === "number" && (
                            <>
                              {" · "}
                              {upload.comparison.distanceKm} km away
                            </>
                          )}
                        </p>
                      )}

                      {(upload.authenticity?.geospatial || upload.authenticity?.failureReasons?.length) && (
                        <div className="evidence-inline-notes">
                          {upload.authenticity?.geospatial && (
                            <p style={{ fontSize: 13 }}>
                              Locality match:{" "}
                              <strong>
                                {upload.authenticity.geospatial.localityMatch === true
                                  ? "Matched"
                                  : upload.authenticity.geospatial.localityMatch === false
                                  ? "Mismatch"
                                  : "Unknown"}
                              </strong>
                              {typeof upload.authenticity.geospatial.localityConfidence === "number" && (
                                <> · confidence {upload.authenticity.geospatial.localityConfidence}%</>
                              )}
                            </p>
                          )}
                          {upload.authenticity?.failureReasons?.length ? (
                            <ul className="evidence-issue-list compact">
                              {upload.authenticity.failureReasons.slice(0, 4).map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Voting stats */}
              {isVoting && (
                <>
                  <div className="milestone-votes">
                    <div className="vote-bar">
                      <div className="vote-bar-label">
                        <span>Approve</span>
                        <span>{approvePercent}%</span>
                      </div>
                      <div className="neo-progress" style={{ height: 16 }}>
                        <div
                          className="neo-progress-bar"
                          style={{ width: `${approvePercent}%`, background: "var(--bg-green)" }}
                        />
                      </div>
                    </div>
                    <div className="vote-bar">
                      <div className="vote-bar-label">
                        <span>Challenge</span>
                        <span>{challengePercent}%</span>
                      </div>
                      <div className="neo-progress" style={{ height: 16 }}>
                        <div
                          className="neo-progress-bar"
                          style={{ width: `${challengePercent}%`, background: "var(--color-ink)" }}
                        />
                      </div>
                    </div>
                  </div>

                  {votingOpen && (
                    <div className="voting-countdown" style={{ marginTop: 12 }}>
                      Voting ends{" "}
                      {new Date(m.votingDeadline * 1000).toLocaleString()}
                    </div>
                  )}

                  {isVoting && allVotingWeightCast && (
                    <div className="voting-countdown" style={{ marginTop: 12 }}>
                      All donor voting weight has been cast. This milestone can be resolved now.
                    </div>
                  )}

                  {/* Vote buttons */}
                  {votingOpen && wallet.account && !isNGO && (
                    <div className="voting-actions">
                      <button
                        className="neo-btn neo-btn-primary"
                        onClick={() => handleVote(m.id, true)}
                        disabled={votingId === m.id || hasCurrentWalletVoted}
                      >
                        {hasCurrentWalletVoted ? "Vote submitted" : "Approve"}
                      </button>
                      <button
                        className="neo-btn neo-btn-danger"
                        onClick={() => handleVote(m.id, false)}
                        disabled={votingId === m.id || hasCurrentWalletVoted}
                      >
                        Challenge
                      </button>
                    </div>
                  )}

                  {votingOpen && wallet.account && !isNGO && hasCurrentWalletVoted && (
                    <div className="milestone-gate-banner" style={{ marginTop: 12 }}>
                      This wallet has already voted on this milestone. A second vote is not allowed.
                    </div>
                  )}

                  {/* Resolve button */}
                  {votingClosed && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="neo-btn neo-btn-outline"
                        onClick={() => handleResolve(m.id)}
                      >
                        Resolve Vote
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* AI Score badge */}
              {m.aiScore > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className={`neo-tag ${m.aiScore >= 70 ? "neo-tag-green" : "neo-tag-red"}`}>
                    AI Score: {m.aiScore}/100
                  </span>
                  {m.resolvedByAI && (
                    <span className="neo-tag neo-tag-purple" style={{ marginLeft: 8 }}>
                      AI Tiebreaker
                    </span>
                  )}
                </div>
              )}

              {/* NGO: Submit evidence */}
              {isNGO &&
                ((m.status === 4 && campaign.status === 1) ||
                  isMilestoneReadyForSubmission(m, campaign, milestones)) && (
                <div style={{ marginTop: 12, padding: 16, background: "var(--bg)", borderRadius: 8, border: "2px solid var(--border-color)" }}>
                  <p style={{ fontWeight: 700, marginBottom: 8 }}>Submit Evidence</p>
                  {address && (
                    <div className="milestone-gate-banner" style={{ marginBottom: 12 }}>
                      <strong>Show this milestone marker in at least one photo:</strong>{" "}
                      <span style={{ fontFamily: "var(--font-mono)" }}>
                        {buildProofMarker(address, m.id, m.title)}
                      </span>
                      . This marker is unique to Milestone {m.id} and should be visible on a
                      board, paper, or printed sign at the site.
                      <div style={{ marginTop: 8 }}>
                        <strong>Backup proof code:</strong>{" "}
                        <span style={{ fontFamily: "var(--font-mono)" }}>
                          {buildProofCode(address, m.id)}
                        </span>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        Use wording tied to this exact update, such as the milestone title{" "}
                        <strong>{m.title}</strong>, so images cannot be reused across different
                        milestone submissions for this campaign.
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                    <button
                      className="neo-btn neo-btn-outline"
                      type="button"
                      onClick={handleUseCurrentLocation}
                      disabled={locating}
                      style={{ fontSize: 14, padding: "8px 16px" }}
                    >
                      {locating ? "Getting location..." : "Use current location"}
                    </button>
                    <span style={{ fontSize: 13, color: "var(--text-muted)", alignSelf: "center" }}>
                      Uses your browser GPS to fill precise coordinates.
                    </span>
                  </div>
                  <div className="form-row" style={{ marginBottom: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Claimed latitude</label>
                      <input
                        className="neo-input"
                        value={claimedLatitude}
                        onChange={(e) => setClaimedLatitude(e.target.value)}
                        placeholder="28.6139"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Claimed longitude</label>
                      <input
                        className="neo-input"
                        value={claimedLongitude}
                        onChange={(e) => setClaimedLongitude(e.target.value)}
                        placeholder="77.2090"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Claimed project location label</label>
                    <input
                      className="neo-input"
                      value={claimedLocationLabel}
                      onChange={(e) => setClaimedLocationLabel(e.target.value)}
                      placeholder="Village borewell site"
                    />
                  </div>
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const validation = validateSelectedImages(e.target.files);
                      if (!validation.ok) {
                        toast.error(validation.error, { id: "submit" });
                        setSubmitFiles(null);
                        e.target.value = "";
                        return;
                      }

                      setSubmitFiles(e.target.files);
                      setSubmitMilestoneId(m.id);
                    }}
                    style={{ marginBottom: 8 }}
                  />
                  <button
                    className="neo-btn neo-btn-blue"
                    onClick={handleSubmitMilestone}
                    disabled={submitting || submitMilestoneId !== m.id || !submitFiles?.length}
                    style={{ fontSize: 14, padding: "8px 16px" }}
                  >
                    {submitting ? "Submitting..." : "Upload & Submit"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Contract link */}
      <div className="neo-card" style={{ background: "var(--bg)", marginTop: 16 }}>
        <p style={{ fontSize: 14 }}>
          Contract:{" "}
          <a
            className="tx-link"
            href={`https://sepolia.etherscan.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {address}
          </a>
        </p>
      </div>
    </div>
  );
}
