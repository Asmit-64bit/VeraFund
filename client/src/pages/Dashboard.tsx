import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { useAllCampaigns } from "../hooks/useCampaign";
import { CAMPAIGN_STATUS, CAMPAIGN_ABI } from "../constants";
import type { WalletState, CampaignInfo } from "../types";
import { useState } from "react";
import toast from "react-hot-toast";

interface DashboardProps {
  wallet: WalletState;
}

export default function Dashboard({ wallet }: DashboardProps) {
  const { campaigns, loading } = useAllCampaigns(wallet.provider);
  const [refunding, setRefunding] = useState<string | null>(null);

  if (!wallet.account) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">🦊</div>
          <div className="empty-state-title">Connect your wallet</div>
          <div className="empty-state-subtitle">
            Connect MetaMask to see your campaigns and donations.
          </div>
          <button className="neo-btn neo-btn-primary" onClick={wallet.connect}>
            🦊 Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const addr = wallet.account.toLowerCase();

  // Campaigns where user is NGO
  const myCampaigns = campaigns.filter(
    (c) => c.ngoAddress.toLowerCase() === addr
  );

  // Campaigns where user has donated (has raisedAmount > 0 and they're not the NGO)
  // We can't know directly from this data — we'll show all non-NGO campaigns
  const donatedCampaigns = campaigns.filter(
    (c) => c.ngoAddress.toLowerCase() !== addr
  );

  const handleRefund = async (campaignAddress: string) => {
    if (!wallet.signer) return;
    setRefunding(campaignAddress);
    try {
      const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.refund();
      toast.loading("Processing refund...", { id: "refund" });
      await tx.wait();
      toast.success("Refund successful! 💰", { id: "refund" });
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Refund failed",
        { id: "refund" }
      );
    } finally {
      setRefunding(null);
    }
  };

  const CampaignRow = ({ c, showRefund }: { c: CampaignInfo; showRefund: boolean }) => {
    const goal = ethers.formatEther(c.goalAmount);
    const raised = ethers.formatEther(c.raisedAmount);
    const percent = c.goalAmount > 0n
      ? Number((c.raisedAmount * 100n) / c.goalAmount)
      : 0;
    const deadlinePassed = c.campaignDeadline * 1000 < Date.now();
    const canRefund = showRefund && (c.status === 3 || (c.status === 0 && deadlinePassed));

    return (
      <div className="milestone-card" key={c.address}>
        <div className="milestone-card-header">
          <Link
            to={`/campaign/${c.address}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="milestone-card-title">{c.title}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              by {c.ngoName}
            </div>
          </Link>
          <span
            className={`neo-tag ${
              c.status === 0
                ? "neo-tag-yellow"
                : c.status === 1
                ? "neo-tag-green"
                : c.status === 2
                ? "neo-tag-blue"
                : "neo-tag-red"
            }`}
          >
            {CAMPAIGN_STATUS[c.status]}
          </span>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="neo-progress" style={{ height: 16 }}>
              <div
                className="neo-progress-bar"
                style={{ width: `${Math.min(percent, 100)}%` }}
              >
                {percent}%
              </div>
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>
            {raised} / {goal} ETH
          </div>
        </div>

        {canRefund && (
          <button
            className="neo-btn neo-btn-red"
            style={{ marginTop: 12, fontSize: 14, padding: "8px 16px" }}
            onClick={() => handleRefund(c.address)}
            disabled={refunding === c.address}
          >
            {refunding === c.address ? "Refunding..." : "💸 Claim Refund"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">
        Manage your campaigns and track your donations.
      </p>

      {/* My Campaigns (NGO) */}
      <div className="detail-section">
        <h3 className="detail-section-title">🏗️ My Campaigns (as NGO)</h3>
        {loading ? (
          <div className="loading-spinner">
            <div className="spinner" />
          </div>
        ) : myCampaigns.length === 0 ? (
          <div
            className="neo-card"
            style={{ textAlign: "center", background: "var(--bg)" }}
          >
            <p>You haven't created any campaigns yet.</p>
            <Link
              to="/create"
              className="neo-btn neo-btn-primary"
              style={{ marginTop: 12, display: "inline-flex" }}
            >
              ✨ Create Campaign
            </Link>
          </div>
        ) : (
          myCampaigns.map((c) => (
            <CampaignRow key={c.address} c={c} showRefund={false} />
          ))
        )}
      </div>

      {/* Donated Campaigns */}
      <div className="detail-section">
        <h3 className="detail-section-title">💰 Campaigns I Can Donate To</h3>
        {loading ? (
          <div className="loading-spinner">
            <div className="spinner" />
          </div>
        ) : donatedCampaigns.length === 0 ? (
          <div
            className="neo-card"
            style={{ textAlign: "center", background: "var(--bg)" }}
          >
            <p>No campaigns available to donate to.</p>
          </div>
        ) : (
          donatedCampaigns.map((c) => (
            <CampaignRow key={c.address} c={c} showRefund={true} />
          ))
        )}
      </div>
    </div>
  );
}
