import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useWalletCampaigns } from "../hooks/useCampaign";
import { CAMPAIGN_ABI, CAMPAIGN_STATUS } from "../constants";
import {
  getCreatorProfileCompletion,
  joinListToMultiline,
  loadCreatorProfileDraft,
  resizeProfileImage,
  sanitizeCreatorProfile,
  splitLinesToList,
  trySaveCreatorProfileDraft,
} from "../lib/campaignProfile";
import { formatEth, formatPercent } from "../lib/format";
import type { WalletState, CampaignInfo, CreatorProfile, MilestoneInfo } from "../types";

interface ProfileProps {
  wallet: WalletState;
}

interface CampaignInsight {
  donorCount: number;
  approvedMilestones: number;
  totalExecutionMilestones: number;
  votingMilestones: number;
  rejectedMilestones: number;
  pendingMilestones: number;
  nextDeadline: number | null;
  isStale: boolean;
}

async function loadCampaignMilestones(contract: ethers.Contract): Promise<MilestoneInfo[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allMilestones = await contract.getAllMilestones();
    return allMilestones as MilestoneInfo[];
  } catch {
    const count = Number(await contract.getMilestoneCount().catch(() => 0));
    if (!count) return [];

    const milestoneResults = await Promise.all(
      Array.from({ length: count }, (_, index) => contract.getMilestone(index).catch(() => null))
    );

    return milestoneResults.filter((milestone): milestone is MilestoneInfo => Boolean(milestone));
  }
}

const emptyCreatorProfile: CreatorProfile = {
  displayName: "",
  roleTitle: "",
  location: "",
  aboutMe: "",
  causes: [],
  associatedOrganizations: [],
  website: "",
  instagram: "",
  facebook: "",
  twitter: "",
  linkedin: "",
  profileImageUrl: null,
  profileImageDataUrl: null,
};

const CREATOR_FIELD_LABELS: Record<string, string> = {
  displayName: "public name",
  aboutMe: "about section",
  causes: "focus causes",
};

function RequiredLabel({ children }: { children: string }) {
  return (
    <label className="form-label">
      {children} <span className="required-star" aria-label="required">*</span>
    </label>
  );
}

function OptionalLabel({ children }: { children: string }) {
  return (
    <label className="form-label">
      {children} <span className="optional-label">(optional)</span>
    </label>
  );
}

function getCampaignAttentionLabel(campaign: CampaignInfo, insight?: CampaignInsight) {
  if (!insight) return "Loading campaign health";
  if (campaign.status === 2) return "All milestones completed";
  if (campaign.status === 3 && insight.isStale) return "Marked stale and refund-ready";
  if (campaign.status === 3) return "Cancelled";
  if (insight.isStale) return "Needs attention: stale refund eligible";
  if (campaign.status === 0) return "Needs more funding before execution begins";
  if (insight.votingMilestones > 0) return "Donor vote in progress";
  if (insight.rejectedMilestones > 0) return "Milestone resubmission required";
  if (insight.pendingMilestones > 0) return "Next milestone ready for submission";
  return "Operating normally";
}

function formatDeadline(timestamp: number | null) {
  if (!timestamp) return "No deadline pending";
  return new Date(timestamp * 1000).toLocaleDateString();
}

function CampaignCard({
  campaign,
  insight,
}: {
  campaign: CampaignInfo;
  insight?: CampaignInsight;
}) {
  const goal = formatEth(campaign.goalAmount);
  const raised = formatEth(campaign.raisedAmount);
  const donated = campaign.userDonation ? formatEth(campaign.userDonation) : "0";
  const percentLabel = formatPercent(campaign.raisedAmount, campaign.goalAmount);
  const percent = Number(percentLabel);
  const amountRemaining = formatEth(campaign.goalAmount - campaign.raisedAmount);
  const campaignHealthLabel = getCampaignAttentionLabel(campaign, insight);

  return (
    <div className="milestone-card profile-campaign-card">
      <div className="milestone-card-header">
        <div>
          <Link to={`/campaign/${campaign.address}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="milestone-card-title">{campaign.title}</div>
          </Link>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>by {campaign.ngoName}</div>
        </div>
        <span
          className={`neo-tag ${
            campaign.status === 0
              ? "neo-tag-yellow"
              : campaign.status === 1
              ? "neo-tag-blue"
              : campaign.status === 2
              ? "neo-tag-blue"
              : "neo-tag-outline"
          }`}
        >
          {CAMPAIGN_STATUS[campaign.status]}
        </span>
      </div>

      <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 14 }}>
        {campaign.description}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="neo-progress" style={{ height: 16 }}>
            <div className="neo-progress-bar" style={{ width: `${Math.min(percent, 100)}%` }}>
              {percentLabel}%
            </div>
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {raised} / {goal} ETH
        </div>
      </div>

      <div className="profile-campaign-insights">
        <div className="profile-campaign-metric">
          <span className="profile-campaign-metric-label">Funding status</span>
          <strong>{percentLabel}% raised</strong>
          <span>{amountRemaining} ETH remaining</span>
        </div>
        <div className="profile-campaign-metric">
          <span className="profile-campaign-metric-label">Backers</span>
          <strong>{insight?.donorCount ?? "—"}</strong>
          <span>Unique donor wallets</span>
        </div>
        <div className="profile-campaign-metric">
          <span className="profile-campaign-metric-label">Milestones</span>
          <strong>
            {insight ? `${insight.approvedMilestones}/${insight.totalExecutionMilestones}` : "—"}
          </strong>
          <span>Approved for release</span>
        </div>
        <div className="profile-campaign-metric">
          <span className="profile-campaign-metric-label">Next checkpoint</span>
          <strong>{formatDeadline(insight?.nextDeadline ?? null)}</strong>
          <span>{campaignHealthLabel}</span>
        </div>
      </div>

      <div className="profile-campaign-summary">
        <span className="profile-inline-stat">{campaignHealthLabel}</span>
        {insight && insight.votingMilestones > 0 && (
          <span className="profile-inline-stat">
            {insight.votingMilestones} milestone vote{insight.votingMilestones > 1 ? "s" : ""} open
          </span>
        )}
        {insight && insight.rejectedMilestones > 0 && (
          <span className="profile-inline-stat">
            {insight.rejectedMilestones} milestone{insight.rejectedMilestones > 1 ? "s" : ""} need updates
          </span>
        )}
      </div>

      {campaign.userDonation !== undefined && campaign.userDonation > 0n && (
        <div className="profile-inline-stat">
          Your donation: <strong>{donated} ETH</strong>
        </div>
      )}
    </div>
  );
}

export default function Profile({ wallet }: ProfileProps) {
  const { campaigns, loading, error } = useWalletCampaigns(wallet.provider, wallet.account);
  const [campaignInsights, setCampaignInsights] = useState<Record<string, CampaignInsight>>({});
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile>(emptyCreatorProfile);
  const [causesInput, setCausesInput] = useState("");
  const [organizationsInput, setOrganizationsInput] = useState("");

  useEffect(() => {
    const storedProfile = loadCreatorProfileDraft(wallet.account);
    const normalized = sanitizeCreatorProfile(storedProfile || emptyCreatorProfile);
    setCreatorProfile(normalized);
    setCausesInput(joinListToMultiline(normalized.causes));
    setOrganizationsInput(joinListToMultiline(normalized.associatedOrganizations));
  }, [wallet.account]);

  const addr = wallet.account?.toLowerCase() || "";
  const createdCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.ngoAddress.toLowerCase() === addr),
    [campaigns, addr]
  );
  const donatedCampaigns = useMemo(
    () => campaigns.filter((campaign) => (campaign.userDonation || 0n) > 0n),
    [campaigns]
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchCampaignInsights() {
      if (!wallet.provider || createdCampaigns.length === 0) {
        setCampaignInsights({});
        return;
      }

      try {
        const settledEntries = await Promise.allSettled(
          createdCampaigns.map(async (campaign) => {
            const contract = new ethers.Contract(campaign.address, CAMPAIGN_ABI, wallet.provider);
            const [donors, milestones, stale] = await Promise.all([
              contract.getDonors().catch(() => []) as Promise<string[]>,
              loadCampaignMilestones(contract),
              contract.isStale().catch(() => false) as Promise<boolean>,
            ]);

            const executionMilestones = milestones.slice(1);
            const nextPendingDeadline =
              executionMilestones
                .filter((milestone) => Number(milestone.status) !== 3)
                .map((milestone) =>
                  Number(milestone.status) === 2
                    ? Number(milestone.votingDeadline)
                    : Number(milestone.deadline)
                )
                .filter((deadline) => deadline > 0)
                .sort((a, b) => a - b)[0] ?? null;

            return [
              campaign.address,
              {
                donorCount: donors.length,
                approvedMilestones: executionMilestones.filter((milestone) => Number(milestone.status) === 3).length,
                totalExecutionMilestones: executionMilestones.length,
                votingMilestones: executionMilestones.filter((milestone) => Number(milestone.status) === 2).length,
                rejectedMilestones: executionMilestones.filter((milestone) => Number(milestone.status) === 4).length,
                pendingMilestones: executionMilestones.filter((milestone) => Number(milestone.status) === 0).length,
                nextDeadline: nextPendingDeadline,
                isStale: Boolean(stale),
              } satisfies CampaignInsight,
            ] as const;
          })
        );

        if (!cancelled) {
          setCampaignInsights(
            Object.fromEntries(
              settledEntries.reduce<Array<readonly [string, CampaignInsight]>>((acc, entry) => {
                if (entry.status === "fulfilled") {
                  acc.push(entry.value as readonly [string, CampaignInsight]);
                }
                return acc;
              }, [])
            )
          );
        }
      } catch {
        if (!cancelled) {
          setCampaignInsights({});
        }
      }
    }

    fetchCampaignInsights();
    return () => {
      cancelled = true;
    };
  }, [wallet.provider, createdCampaigns]);

  const totalDonated = donatedCampaigns.reduce((sum, campaign) => sum + (campaign.userDonation || 0n), 0n);
  const createdRaisedTotal = createdCampaigns.reduce((sum, campaign) => sum + campaign.raisedAmount, 0n);
  const activeCreatedCount = createdCampaigns.filter((campaign) => campaign.status === 1).length;
  const atRiskCreatedCount = createdCampaigns.filter((campaign) => campaignInsights[campaign.address]?.isStale).length;
  const totalCreatedDonors = createdCampaigns.reduce(
    (sum, campaign) => sum + (campaignInsights[campaign.address]?.donorCount ?? 0),
    0
  );
  const creatorCompletion = useMemo(() => getCreatorProfileCompletion(creatorProfile), [creatorProfile]);
  const profileStatusLabel = creatorCompletion.isComplete ? "Ready" : "Needs details";
  const missingProfileFieldsLabel = creatorCompletion.missing
    .map((field) => CREATOR_FIELD_LABELS[field] || field)
    .join(", ");

  const handleProfileFieldChange =
    (field: keyof CreatorProfile) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCreatorProfile((current) => ({ ...current, [field]: event.target.value }));
    };

  const handleCreatorImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const profileImageDataUrl = await resizeProfileImage(file);
      setCreatorProfile((current) => ({
        ...current,
        profileImageDataUrl,
      }));
      toast.success("Profile photo added. Save your profile to keep it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to process profile photo");
    } finally {
      event.target.value = "";
    }
  };

  const handleSaveProfile = () => {
    const sanitized = sanitizeCreatorProfile({
      ...creatorProfile,
      causes: splitLinesToList(causesInput),
      associatedOrganizations: splitLinesToList(organizationsInput),
    });

    setCreatorProfile(sanitized);
    const saved = trySaveCreatorProfileDraft(wallet.account, sanitized);
    if (!saved) {
      toast.error("Profile photo is too large to store locally. Try a smaller image.");
      return;
    }

    toast.success("Organizer profile saved. New campaigns will include this identity snapshot.");
  };

  if (!wallet.account) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-title">Connect your wallet</div>
          <div className="empty-state-subtitle">
            Connect a wallet to see your donations, campaigns, and organizer profile.
          </div>
          <button className="neo-btn neo-btn-primary" onClick={wallet.connect}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header-row">
        <div className="page-header-stack">
          <div className="page-title-block">
            <h1 className="page-title">My Profile</h1>
          </div>
          <p className="page-subtitle">
            Build donor trust with a complete organizer profile, then manage the campaigns and contributions tied to this wallet.
          </p>
        </div>
        <button className="neo-btn neo-btn-outline" type="button" onClick={wallet.disconnect}>
          Log Out
        </button>
      </div>

      <div className="detail-section">
        <h3 className="detail-section-title">Organizer Identity</h3>
        <div className="creator-profile-shell">
          <div className="creator-profile-preview">
            <div className="creator-profile-eyebrow">Public donor view</div>
            {creatorProfile.profileImageDataUrl ? (
              <img
                className="creator-profile-avatar"
                src={creatorProfile.profileImageDataUrl}
                alt={creatorProfile.displayName || "Organizer"}
              />
            ) : null}
            <div>
              <h4>{creatorProfile.displayName || "Add your public organizer name"}</h4>
              <p className="creator-profile-preview-role">
                {creatorProfile.roleTitle || "Lead organizer"} {creatorProfile.location ? `· ${creatorProfile.location}` : ""}
              </p>
              <p className="creator-profile-preview-copy">
                {creatorProfile.aboutMe || "Introduce the person or team behind the campaigns so donors understand your mission and credibility."}
              </p>
            </div>
            <div className="creator-profile-pill-row">
              {(creatorProfile.causes || []).length > 0 ? (
                creatorProfile.causes?.map((cause) => (
                  <span key={cause} className="profile-inline-stat">{cause}</span>
                ))
              ) : (
                <span className="creator-profile-empty-copy">No focus causes added yet.</span>
              )}
            </div>
            <div className="creator-completion-note">
              {creatorCompletion.isComplete
                ? "Profile ready. New campaigns will publish this organizer identity to donors."
                : `Only these fields are required before launching campaigns: ${missingProfileFieldsLabel}. Everything else is optional.`}
            </div>
          </div>

          <div className="creator-profile-form">
            <div className="creator-profile-eyebrow">Edit organizer profile</div>
            <div className="form-row">
              <div className="form-group">
                <RequiredLabel>Public name</RequiredLabel>
                <input
                  className="neo-input"
                  value={creatorProfile.displayName || ""}
                  onChange={handleProfileFieldChange("displayName")}
                  placeholder="Your public organizer or team name"
                />
              </div>
              <div className="form-group">
                <OptionalLabel>Role / title</OptionalLabel>
                <input
                  className="neo-input"
                  value={creatorProfile.roleTitle || ""}
                  onChange={handleProfileFieldChange("roleTitle")}
                  placeholder="Founder, Program Lead, Community Organizer"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <OptionalLabel>Location</OptionalLabel>
                <input
                  className="neo-input"
                  value={creatorProfile.location || ""}
                  onChange={handleProfileFieldChange("location")}
                  placeholder="City, state, country"
                />
              </div>
              <div className="form-group">
                <OptionalLabel>Profile photo</OptionalLabel>
                <input
                  className="neo-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleCreatorImageChange}
                />
              </div>
            </div>

            <div className="form-group">
              <RequiredLabel>About me</RequiredLabel>
              <textarea
                className="neo-textarea"
                value={creatorProfile.aboutMe || ""}
                onChange={handleProfileFieldChange("aboutMe")}
                placeholder="Explain your track record, why this work matters to you, and why donors should trust you with milestone-based funding."
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <RequiredLabel>Causes you believe in</RequiredLabel>
                <textarea
                  className="neo-textarea"
                  value={causesInput}
                  onChange={(event) => setCausesInput(event.target.value)}
                  placeholder="One cause per line: Water access, Education equity, Healthcare outreach"
                />
              </div>
              <div className="form-group">
                <OptionalLabel>Associated organisations</OptionalLabel>
                <textarea
                  className="neo-textarea"
                  value={organizationsInput}
                  onChange={(event) => setOrganizationsInput(event.target.value)}
                  placeholder="One organization per line if you want donors to know your affiliations"
                />
              </div>
            </div>

            <div className="profile-link-grid">
              <div className="form-group">
                <OptionalLabel>Website</OptionalLabel>
                <input className="neo-input" value={creatorProfile.website || ""} onChange={handleProfileFieldChange("website")} placeholder="https://yourwebsite.org" />
              </div>
              <div className="form-group">
                <OptionalLabel>Instagram</OptionalLabel>
                <input className="neo-input" value={creatorProfile.instagram || ""} onChange={handleProfileFieldChange("instagram")} placeholder="instagram.com/yourhandle" />
              </div>
              <div className="form-group">
                <OptionalLabel>Facebook</OptionalLabel>
                <input className="neo-input" value={creatorProfile.facebook || ""} onChange={handleProfileFieldChange("facebook")} placeholder="facebook.com/yourpage" />
              </div>
              <div className="form-group">
                <OptionalLabel>Twitter / X</OptionalLabel>
                <input className="neo-input" value={creatorProfile.twitter || ""} onChange={handleProfileFieldChange("twitter")} placeholder="x.com/yourhandle" />
              </div>
              <div className="form-group">
                <OptionalLabel>LinkedIn</OptionalLabel>
                <input className="neo-input" value={creatorProfile.linkedin || ""} onChange={handleProfileFieldChange("linkedin")} placeholder="linkedin.com/in/yourprofile" />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="creator-completion-note">
                Donors will see this profile on future campaigns created from this wallet.
              </div>
              <button className="neo-btn neo-btn-primary" type="button" onClick={handleSaveProfile}>
                Save Organizer Profile
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-stats-grid">
        <div className="stat-card">
          <div className="stat-value">{createdCampaigns.length}</div>
          <div className="stat-label">Campaigns Created</div>
        </div>
        <div className="stat-card stat-card-blue">
          <div className="stat-value">{donatedCampaigns.length}</div>
          <div className="stat-label">Campaigns Supported</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatEth(totalDonated, 3)}</div>
          <div className="stat-label">ETH Donated</div>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-value">{profileStatusLabel}</div>
          <div className="stat-label">Organizer Profile</div>
        </div>
      </div>

      {loading && (
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      )}

      {error && (
        <div className="neo-card" style={{ background: "#fca5a5" }}>
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="detail-section">
            <h3 className="detail-section-title">Fundraising Campaigns Made</h3>
            {createdCampaigns.length === 0 ? (
              <div className="neo-card profile-empty-card">
                <p>You have not created a campaign yet.</p>
                <Link to="/create" className="neo-btn neo-btn-primary" style={{ marginTop: 12 }}>
                  Create Campaign
                </Link>
              </div>
            ) : (
              <>
                <div className="profile-operator-grid">
                  <div className="stat-card">
                    <div className="stat-value">{formatEth(createdRaisedTotal, 3)}</div>
                    <div className="stat-label">ETH Raised Across Your Campaigns</div>
                  </div>
                  <div className="stat-card stat-card-blue">
                    <div className="stat-value">{activeCreatedCount}</div>
                    <div className="stat-label">Campaigns Currently Executing</div>
                  </div>
                  <div className="stat-card stat-card-accent">
                    <div className="stat-value">{totalCreatedDonors}</div>
                    <div className="stat-label">Total Unique Backers Reached</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{atRiskCreatedCount}</div>
                    <div className="stat-label">Campaigns Requiring Immediate Attention</div>
                  </div>
                </div>

                {createdCampaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.address}
                    campaign={campaign}
                    insight={campaignInsights[campaign.address]}
                  />
                ))}
              </>
            )}
          </div>

          <div className="detail-section">
            <h3 className="detail-section-title">Donations Made</h3>
            {donatedCampaigns.length === 0 ? (
              <div className="neo-card profile-empty-card">
                <p>You have not donated to any campaigns yet.</p>
                <Link to="/" className="neo-btn neo-btn-outline" style={{ marginTop: 12 }}>
                  Explore Campaigns
                </Link>
              </div>
            ) : (
              donatedCampaigns.map((campaign) => (
                <CampaignCard key={campaign.address} campaign={campaign} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
