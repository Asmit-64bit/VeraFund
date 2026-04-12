import { Link } from "react-router-dom";
import { useMemo, useState, type SyntheticEvent } from "react";
import { useAllCampaigns } from "../hooks/useCampaign";
import { CAMPAIGN_STATUS } from "../constants";
import { formatEth, formatPercent } from "../lib/format";
import {
  CAMPAIGN_CATEGORIES,
  type CampaignCategory,
  normalizeCampaignCategory,
} from "../lib/campaigns";
import type { WalletState, CampaignInfo } from "../types";

interface HomeProps {
  wallet: WalletState;
}

const STATUS_TAG_COLORS: Record<number, string> = {
  0: "neo-tag-yellow",
  1: "neo-tag-blue",
  2: "neo-tag-blue",
  3: "neo-tag-outline",
};

const STATUS_CARD_ACCENT: Record<number, string> = {
  0: "var(--color-accent)",
  1: "var(--color-primary)",
  2: "var(--color-primary)",
  3: "var(--color-ink)",
};

function CampaignCard({ campaign, index }: { campaign: CampaignInfo; index: number }) {
  const goal = formatEth(campaign.goalAmount);
  const raised = formatEth(campaign.raisedAmount);
  const percentLabel = formatPercent(campaign.raisedAmount, campaign.goalAmount);
  const percent = Number(percentLabel);
  const deadline = new Date(campaign.campaignDeadline * 1000);
  const isExpired = deadline.getTime() < Date.now();
  const deadlineLabel = isExpired ? "Closed" : deadline.toLocaleDateString();
  const bannerSource =
    campaign.profile?.coverImageDataUrl ||
    campaign.profile?.coverImageUrl ||
    campaign.profile?.galleryImages?.[0]?.url ||
    null;
  const [bannerMissing, setBannerMissing] = useState(!bannerSource);
  const categoryLabel = normalizeCampaignCategory(campaign.profile?.category);

  const handleBannerError = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.display = "none";
    setBannerMissing(true);
  };

  const handleBannerLoad = () => {
    if (bannerMissing) {
      setBannerMissing(false);
    }
  };

  return (
    <Link
      to={`/campaign/${campaign.address}`}
      className="campaign-card animate-slideup"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className={`campaign-card-banner ${bannerMissing ? "is-fallback" : ""}`}>
        {!bannerMissing && bannerSource ? (
          <img
            src={bannerSource}
            alt={`${campaign.title} banner`}
            className="campaign-card-banner-image"
            onLoad={handleBannerLoad}
            onError={handleBannerError}
          />
        ) : (
          <div className="campaign-card-banner-fallback">
            <span>No Banner</span>
          </div>
        )}
      </div>
      <div
        className="campaign-card-header"
        style={{ borderBottom: `3px solid ${STATUS_CARD_ACCENT[campaign.status] || "var(--bg)"}` }}
      >
        <div>
          <div className="campaign-card-title">{campaign.title}</div>
          <div className="campaign-card-ngo">by {campaign.ngoName}</div>
          {campaign.profile?.creatorProfile?.displayName && (
            <div className="campaign-card-meta-line">
              <span>Created by {campaign.profile.creatorProfile.displayName}</span>
            </div>
          )}
          {(categoryLabel || campaign.profile?.locationLabel) && (
            <div className="campaign-card-meta-line">
              {categoryLabel && <span>{categoryLabel}</span>}
              {campaign.profile?.locationLabel && <span>{campaign.profile.locationLabel}</span>}
            </div>
          )}
        </div>
        <span className={`neo-tag ${STATUS_TAG_COLORS[campaign.status]}`}>
          {CAMPAIGN_STATUS[campaign.status]}
        </span>
      </div>

      <div className="campaign-card-body">
        <div className="campaign-card-description">
          {campaign.profile?.summary || campaign.description}
        </div>
        <div className="neo-progress">
          <div
            className="neo-progress-bar"
            style={{ width: `${Math.min(percent, 100)}%` }}
          >
            {percent >= 3 ? `${percentLabel}%` : ""}
          </div>
        </div>
      </div>

      <div className="campaign-card-footer">
        <div>
          <div className="campaign-card-amount">
            {raised} ETH
          </div>
          <div className="campaign-card-goal">of {goal} ETH goal</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="campaign-card-amount">
            {campaign.milestoneCount} milestones
          </div>
          <div className="campaign-card-goal">
            {isExpired ? deadlineLabel : `${campaign.bootstrapPercent}% bootstrap`}
          </div>
        </div>
      </div>
    </Link>
  );
}

function joinCreatorCauses(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean).join(" ");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function HowItWorks() {
  const steps = [
    {
      title: "1. Fund",
      desc: "You donate ETH. It goes into a transparent smart contract, not straight into the organiser’s wallet.",
    },
    {
      title: "2. Verify",
      desc: "The organiser uploads progress images and location data. VeraFund checks the proof with AI, metadata, and donor voting.",
    },
    {
      title: "3. Release",
      desc: "Funds unlock milestone by milestone. If the project fails or goes stale, donors can recover the locked balance.",
    },
  ];

  return (
    <section className="how-it-works">
      <h2 className="how-it-works-title">How It Works</h2>
      <div className="how-it-works-grid how-it-works-grid-3">
        {steps.map((step, i) => (
          <div
            className="how-step animate-slideup"
            key={i}
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <div className="how-step-number">{i + 1}</div>
            <div className="how-step-title">{step.title}</div>
            <div className="how-step-desc">{step.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home({ wallet }: HomeProps) {
  const { campaigns, loading, error } = useAllCampaigns(wallet.provider);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CampaignCategory | "All">("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const totalRaised = campaigns.reduce((sum, c) => sum + c.raisedAmount, 0n);
  const availableCategories = useMemo(() => CAMPAIGN_CATEGORIES, []);

  const filteredCampaigns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return campaigns.filter((campaign) => {
      const matchesQuery =
        !query ||
        [
          campaign.title,
          campaign.ngoName,
          campaign.description,
          campaign.profile?.summary,
          campaign.profile?.category,
          campaign.profile?.locationLabel,
          campaign.profile?.beneficiary,
          campaign.profile?.creatorProfile?.displayName,
          campaign.profile?.creatorProfile?.aboutMe,
          joinCreatorCauses(campaign.profile?.creatorProfile?.causes),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      const normalizedCategory = normalizeCampaignCategory(campaign.profile?.category);
      const matchesCategory =
        categoryFilter === "All" || normalizedCategory === categoryFilter;

      const matchesStatus =
        statusFilter === "All" || CAMPAIGN_STATUS[campaign.status] === statusFilter;

      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [campaigns, searchQuery, categoryFilter, statusFilter]);

  const activeCampaigns = filteredCampaigns.filter((campaign) => campaign.status !== 2);
  const completedCampaigns = filteredCampaigns.filter((campaign) => campaign.status === 2);
  const showSplitSections = statusFilter === "All";

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="hero-graphic" aria-hidden="true">
          <span className="hero-graphic-card hero-graphic-card-a" />
          <span className="hero-graphic-card hero-graphic-card-b" />
          <span className="hero-graphic-card hero-graphic-card-c" />
          <span className="hero-graphic-orbit" />
          <span className="hero-graphic-node hero-graphic-node-a" />
          <span className="hero-graphic-node hero-graphic-node-b" />
        </div>
        <h1 className="hero-title">
          DONATE WITH{" "}
          <span className="hero-highlight">accountability.</span>
          <br />
          EVERY MILESTONE VERIFIED.
        </h1>
        <p className="hero-subtitle">
          Fund real-world impact on the blockchain. Your ETH stays locked in
          escrow until NGOs prove progress — verified by donors and AI.
        </p>
        <div className="hero-actions">
          {!wallet.account ? (
            <button
              className="neo-btn neo-btn-primary neo-btn-lg"
              onClick={wallet.connect}
            >
              Connect Wallet to Start
            </button>
          ) : (
            <Link to="/create" className="neo-btn neo-btn-primary neo-btn-lg">
              Create a Campaign
            </Link>
          )}
          <a href="#campaigns" className="neo-btn neo-btn-outline neo-btn-lg">
            Explore Campaigns
          </a>
        </div>
      </section>

      {/* How It Works */}
      <HowItWorks />

      {/* Stats + Grid */}
      <div className="page-container">
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{campaigns.length}</div>
            <div className="stat-label">Campaigns</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {formatEth(totalRaised, 3)}
            </div>
            <div className="stat-label">ETH Raised</div>
          </div>
          <div className="stat-card stat-card-blue">
            <div className="stat-value">
              {campaigns.filter((c) => c.status === 1).length}
            </div>
            <div className="stat-label">In Review</div>
          </div>
          <div className="stat-card stat-card-accent">
            <div className="stat-value">
              {campaigns.filter((c) => c.status === 2).length}
            </div>
            <div className="stat-label">Completed</div>
          </div>
        </div>

        {/* Campaign Grid */}
        <div id="campaigns">
          <div className="page-title-block">
            <h2 className="page-title">
              {showSplitSections ? "Active Campaigns" : statusFilter === "Completed" ? "Completed" : "Campaigns"}
            </h2>
          </div>

          <div className="campaign-filter-bar">
            <div className="campaign-filter-search">
              <label className="campaign-filter-label">Search</label>
              <input
                className="neo-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by campaign, organiser, cause, or location"
              />
            </div>
            <div className="campaign-filter-select">
              <label className="campaign-filter-label">Category</label>
              <select
                className="neo-input"
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value as CampaignCategory | "All")
                }
              >
                <option value="All">All categories</option>
                {availableCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="campaign-filter-select">
              <label className="campaign-filter-label">Status</label>
              <select
                className="neo-input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All statuses</option>
                {CAMPAIGN_STATUS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <div className="loading-spinner">
              <div className="spinner" />
              <p>Loading campaigns from blockchain...</p>
            </div>
          )}

          {error && (
            <div
              className="neo-card"
              style={{
                background: "var(--bg-red)",
                color: "var(--bg-card)",
              }}
            >
              <p>
                <strong>Error:</strong> {error}
              </p>
              <p style={{ fontSize: 14, marginTop: 8 }}>
                VeraFund could not load the latest campaign data right now. Refresh once and it will
                retry automatically.
              </p>
            </div>
          )}

          {!loading && !error && campaigns.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">No campaigns yet</div>
              <div className="empty-state-subtitle">
                Be the first to create a campaign and start making an impact.
              </div>
              <Link to="/create" className="neo-btn neo-btn-primary">
                Create First Campaign
              </Link>
            </div>
          )}

          {!loading && !error && campaigns.length > 0 && filteredCampaigns.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">No matching campaigns</div>
              <div className="empty-state-subtitle">
                Adjust your search or filters to widen the results.
              </div>
            </div>
          )}

          {!loading && !error && filteredCampaigns.length > 0 && showSplitSections && activeCampaigns.length > 0 && (
            <div className="campaign-grid">
              {activeCampaigns.map((c, i) => (
                <CampaignCard key={c.address} campaign={c} index={i} />
              ))}
            </div>
          )}

          {!loading && !error && filteredCampaigns.length > 0 && !showSplitSections && (
            <div className="campaign-grid">
              {filteredCampaigns.map((c, i) => (
                <CampaignCard key={c.address} campaign={c} index={i} />
              ))}
            </div>
          )}

          {!loading && !error && showSplitSections && completedCampaigns.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div className="page-title-block" style={{ marginBottom: 24 }}>
                <h2 className="page-title">Completed</h2>
              </div>
              <div className="campaign-grid">
                {completedCampaigns.map((c, i) => (
                  <CampaignCard key={c.address} campaign={c} index={activeCampaigns.length + i} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
