import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { useAllCampaigns } from "../hooks/useCampaign";
import { CAMPAIGN_STATUS } from "../constants";
import type { WalletState, CampaignInfo } from "../types";

interface HomeProps {
  wallet: WalletState;
}

const STATUS_TAG_COLORS: Record<number, string> = {
  0: "neo-tag-yellow",
  1: "neo-tag-green",
  2: "neo-tag-blue",
  3: "neo-tag-red",
};

function CampaignCard({ campaign }: { campaign: CampaignInfo }) {
  const goal = ethers.formatEther(campaign.goalAmount);
  const raised = ethers.formatEther(campaign.raisedAmount);
  const percent =
    campaign.goalAmount > 0n
      ? Number((campaign.raisedAmount * 100n) / campaign.goalAmount)
      : 0;
  const deadline = new Date(campaign.campaignDeadline * 1000);
  const isExpired = deadline.getTime() < Date.now();

  return (
    <Link to={`/campaign/${campaign.address}`} className="campaign-card">
      <div className="campaign-card-header">
        <div>
          <div className="campaign-card-title">{campaign.title}</div>
          <div className="campaign-card-ngo">by {campaign.ngoName}</div>
        </div>
        <span className={`neo-tag ${STATUS_TAG_COLORS[campaign.status]}`}>
          {CAMPAIGN_STATUS[campaign.status]}
        </span>
      </div>

      <div className="campaign-card-body">
        <div className="campaign-card-description">{campaign.description}</div>
        <div className="neo-progress">
          <div
            className="neo-progress-bar"
            style={{ width: `${Math.min(percent, 100)}%` }}
          >
            {percent}%
          </div>
        </div>
      </div>

      <div className="campaign-card-footer">
        <div>
          <div className="campaign-card-amount">{raised} ETH</div>
          <div className="campaign-card-goal">of {goal} ETH goal</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="campaign-card-amount">
            {campaign.milestoneCount} milestones
          </div>
          <div className="campaign-card-goal">
            {isExpired ? "Deadline passed" : `${campaign.bootstrapPercent}% bootstrap`}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Home({ wallet }: HomeProps) {
  const { campaigns, loading, error } = useAllCampaigns(wallet.provider);

  const totalRaised = campaigns.reduce(
    (sum, c) => sum + c.raisedAmount,
    0n
  );

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <h1 className="hero-title">
          Donate with{" "}
          <span className="hero-highlight">accountability.</span>
          <br />
          Every milestone verified.
        </h1>
        <p className="hero-subtitle">
          Fund real-world projects on the blockchain. Your ETH locked in escrow
          until NGOs prove progress — verified by donors and AI.
        </p>
        <div className="hero-actions">
          {!wallet.account ? (
            <button className="neo-btn neo-btn-primary" onClick={wallet.connect}>
              🦊 Connect Wallet to Start
            </button>
          ) : (
            <Link to="/create" className="neo-btn neo-btn-primary">
              ✨ Create a Campaign
            </Link>
          )}
          <a href="#campaigns" className="neo-btn neo-btn-outline">
            ↓ Explore Campaigns
          </a>
        </div>
      </section>

      {/* Stats */}
      <div className="page-container">
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{campaigns.length}</div>
            <div className="stat-label">Campaigns</div>
          </div>
          <div className="stat-card" style={{ background: "var(--bg-accent)" }}>
            <div className="stat-value">
              {Number(ethers.formatEther(totalRaised)).toFixed(3)}
            </div>
            <div className="stat-label">ETH Raised</div>
          </div>
          <div className="stat-card" style={{ background: "var(--bg-blue)" }}>
            <div className="stat-value">
              {campaigns.filter((c) => c.status === 1).length}
            </div>
            <div className="stat-label">Active</div>
          </div>
          <div className="stat-card" style={{ background: "var(--bg-yellow)" }}>
            <div className="stat-value">
              {campaigns.filter((c) => c.status === 2).length}
            </div>
            <div className="stat-label">Completed</div>
          </div>
        </div>

        {/* Campaign Grid */}
        <div id="campaigns">
          <h2 className="page-title" style={{ fontSize: 32, marginBottom: 24 }}>
            All Campaigns
          </h2>

          {loading && (
            <div className="loading-spinner">
              <div className="spinner" />
              <p>Loading campaigns from blockchain...</p>
            </div>
          )}

          {error && (
            <div className="neo-card" style={{ background: "var(--bg-red)" }}>
              <p>
                <strong>Error:</strong> {error}
              </p>
              <p style={{ fontSize: 14, marginTop: 8 }}>
                Make sure MetaMask is connected to Sepolia.
              </p>
            </div>
          )}

          {!loading && !error && campaigns.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">🌍</div>
              <div className="empty-state-title">No campaigns yet</div>
              <div className="empty-state-subtitle">
                Be the first to create a campaign and start making an impact.
              </div>
              <Link to="/create" className="neo-btn neo-btn-primary">
                ✨ Create First Campaign
              </Link>
            </div>
          )}

          <div className="campaign-grid">
            {campaigns.map((c) => (
              <CampaignCard key={c.address} campaign={c} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
