import { useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useCampaign } from "../hooks/useCampaign";
import { CAMPAIGN_ABI, CAMPAIGN_STATUS, MILESTONE_STATUS, API_BASE } from "../constants";
import type { WalletState, MilestoneInfo } from "../types";

interface DetailProps {
  wallet: WalletState;
}

const MILESTONE_TAG_COLORS: Record<number, string> = {
  0: "neo-tag-yellow",   // Pending
  1: "neo-tag-blue",     // Submitted
  2: "neo-tag-purple",   // Voting
  3: "neo-tag-green",    // Approved
  4: "neo-tag-red",      // Rejected
};

export default function CampaignDetail({ wallet }: DetailProps) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, error, refetch } = useCampaign(wallet.provider, address);

  const [donateAmount, setDonateAmount] = useState("");
  const [donating, setDonating] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Milestone submission
  const [submitMilestoneId, setSubmitMilestoneId] = useState<number | null>(null);
  const [submitFiles, setSubmitFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Voting
  const [votingId, setVotingId] = useState<number | null>(null);

  const isNGO = wallet.account?.toLowerCase() === campaign?.ngoAddress.toLowerCase();

  // ── Donate ──
  const handleDonate = async () => {
    if (!wallet.signer || !address || !donateAmount) return;
    setDonating(true);
    setTxHash(null);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.donate({
        value: ethers.parseEther(donateAmount),
      });
      setTxHash(tx.hash);
      toast.loading("Waiting for confirmation...", { id: "donate" });
      await tx.wait();
      toast.success("Donation confirmed! 🎉", { id: "donate" });
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
    setSubmitting(true);
    try {
      // 1. Upload to IPFS
      toast.loading("Uploading evidence to IPFS...", { id: "submit" });
      const formData = new FormData();
      for (let i = 0; i < submitFiles.length; i++) {
        formData.append("files", submitFiles[i]);
      }
      const uploadRes = await fetch(`${API_BASE}/upload-evidence`, {
        method: "POST",
        body: formData,
      });
      const { cids } = await uploadRes.json();

      // 2. Submit on-chain (use first CID as the hash)
      toast.loading("Submitting on-chain...", { id: "submit" });
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(submitMilestoneId, cids[0]);
      await tx.wait();

      // 3. Trigger AI verification
      toast.loading("Running AI verification...", { id: "submit" });
      const milestone = milestones.find((m) => m.id === submitMilestoneId);
      await fetch(`${API_BASE}/verify-milestone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestoneId: submitMilestoneId,
          campaignAddress: address,
          cids,
          milestoneDescription: milestone?.description || "",
        }),
      });

      toast.success("Milestone submitted + AI verified! ✅", { id: "submit" });
      setSubmitMilestoneId(null);
      setSubmitFiles(null);
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
    setVotingId(milestoneId);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.vote(milestoneId, approve);
      toast.loading("Submitting vote...", { id: "vote" });
      await tx.wait();
      toast.success(approve ? "Voted Approve ✅" : "Voted Challenge ❌", { id: "vote" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Vote failed", { id: "vote" });
    } finally {
      setVotingId(null);
    }
  };

  // ── Resolve Vote ──
  const handleResolve = async (milestoneId: number) => {
    try {
      toast.loading("Resolving vote...", { id: "resolve" });
      const res = await fetch(`${API_BASE}/resolve-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignAddress: address, milestoneId }),
      });
      const data = await res.json();
      toast.success(
        `Vote resolved: ${data.outcome}${data.resolvedByAI ? " (AI tiebreaker)" : ""}`,
        { id: "resolve" }
      );
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Resolution failed", { id: "resolve" });
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        <p>Loading campaign from blockchain...</p>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="page-container">
        <div className="neo-card" style={{ background: "var(--bg-red)" }}>
          <p><strong>Error:</strong> {error || "Campaign not found"}</p>
        </div>
      </div>
    );
  }

  const goal = ethers.formatEther(campaign.goalAmount);
  const raised = ethers.formatEther(campaign.raisedAmount);
  const percent = campaign.goalAmount > 0n
    ? Number((campaign.raisedAmount * 100n) / campaign.goalAmount)
    : 0;
  const deadline = new Date(campaign.campaignDeadline * 1000);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="detail-header">
        <h1 className="page-title">{campaign.title}</h1>
        <div className="detail-meta">
          <span className={`neo-tag ${MILESTONE_TAG_COLORS[campaign.status] || "neo-tag-yellow"}`}>
            {CAMPAIGN_STATUS[campaign.status]}
          </span>
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

      {/* Stats */}
      <div className="detail-stats">
        <div className="stat-card">
          <div className="stat-value">{raised}</div>
          <div className="stat-label">ETH Raised</div>
        </div>
        <div className="stat-card" style={{ background: "var(--bg-accent)" }}>
          <div className="stat-value">{goal}</div>
          <div className="stat-label">ETH Goal</div>
        </div>
        <div className="stat-card" style={{ background: "var(--bg-blue)" }}>
          <div className="stat-value">{percent}%</div>
          <div className="stat-label">Funded</div>
        </div>
      </div>

      {/* Progress */}
      <div className="neo-progress" style={{ marginBottom: 32 }}>
        <div className="neo-progress-bar" style={{ width: `${Math.min(percent, 100)}%` }}>
          {percent}%
        </div>
      </div>

      {/* Donate Box (only during Fundraising) */}
      {campaign.status === 0 && wallet.account && (
        <div className="detail-section">
          <h3 className="detail-section-title">💰 Donate</h3>
          <div className="donate-box">
            <div className="donate-info">
              ℹ️ When the goal is reached, <strong>{campaign.bootstrapPercent}%</strong> ({(Number(goal) * campaign.bootstrapPercent / 100).toFixed(4)} ETH) will be released immediately as a bootstrap grant.
            </div>
            <div className="donate-input-row">
              <input
                type="number"
                className="neo-input"
                placeholder="Amount in ETH"
                step="0.01"
                min="0.001"
                value={donateAmount}
                onChange={(e) => setDonateAmount(e.target.value)}
              />
              <button
                className="neo-btn neo-btn-primary"
                onClick={handleDonate}
                disabled={donating || !donateAmount}
              >
                {donating ? "Confirming..." : "🤝 Donate"}
              </button>
            </div>
            {donateAmount && Number(donateAmount) > 0 && (
              <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                Your voting weight: <strong>{donateAmount} ETH</strong>
              </p>
            )}
            {txHash && (
              <div className="tx-confirmation tx-success">
                <p>✅ Transaction submitted!</p>
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
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="detail-section">
        <h3 className="detail-section-title">📋 Milestones</h3>
        {milestones.map((m: MilestoneInfo) => {
          const isVoting = m.status === 2;
          const votingOpen = isVoting && Date.now() / 1000 <= m.votingDeadline;
          const votingClosed = isVoting && Date.now() / 1000 > m.votingDeadline;
          const totalVotes = m.votesFor + m.votesAgainst;
          const approvePercent = totalVotes > 0n ? Number((m.votesFor * 100n) / totalVotes) : 0;

          return (
            <div className="milestone-card" key={m.id}>
              <div className="milestone-card-header">
                <div>
                  <span className="milestone-card-title">
                    {m.id === 0 ? "🏁 " : `#${m.id} `}
                    {m.title}
                  </span>
                  <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    ({m.fundPercent}%)
                  </span>
                </div>
                <span className={`neo-tag ${MILESTONE_TAG_COLORS[m.status]}`}>
                  {MILESTONE_STATUS[m.status]}
                </span>
              </div>

              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>
                {m.description}
              </p>

              {m.ipfsHash && (
                <p style={{ fontSize: 13 }}>
                  📎 Evidence:{" "}
                  <a
                    className="tx-link"
                    href={`https://ipfs.io/ipfs/${m.ipfsHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.ipfsHash.slice(0, 16)}...
                  </a>
                </p>
              )}

              {/* Voting stats */}
              {isVoting && (
                <>
                  <div className="milestone-votes">
                    <div className="vote-bar">
                      <div className="vote-bar-label">
                        <span>👍 Approve</span>
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
                        <span>👎 Challenge</span>
                        <span>{100 - approvePercent}%</span>
                      </div>
                      <div className="neo-progress" style={{ height: 16 }}>
                        <div
                          className="neo-progress-bar"
                          style={{ width: `${100 - approvePercent}%`, background: "var(--bg-red)" }}
                        />
                      </div>
                    </div>
                  </div>

                  {votingOpen && (
                    <div className="voting-countdown" style={{ marginTop: 12 }}>
                      ⏰ Voting ends{" "}
                      {new Date(m.votingDeadline * 1000).toLocaleString()}
                    </div>
                  )}

                  {/* Vote buttons */}
                  {votingOpen && wallet.account && !isNGO && (
                    <div className="voting-actions">
                      <button
                        className="neo-btn neo-btn-primary"
                        onClick={() => handleVote(m.id, true)}
                        disabled={votingId === m.id}
                      >
                        👍 Approve
                      </button>
                      <button
                        className="neo-btn neo-btn-red"
                        onClick={() => handleVote(m.id, false)}
                        disabled={votingId === m.id}
                      >
                        👎 Challenge
                      </button>
                    </div>
                  )}

                  {/* Resolve button */}
                  {votingClosed && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="neo-btn neo-btn-yellow"
                        onClick={() => handleResolve(m.id)}
                      >
                        ⚖️ Resolve Vote
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* AI Score badge */}
              {m.aiScore > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className={`neo-tag ${m.aiScore >= 70 ? "neo-tag-green" : "neo-tag-red"}`}>
                    🤖 AI Score: {m.aiScore}/100
                  </span>
                  {m.resolvedByAI && (
                    <span className="neo-tag neo-tag-purple" style={{ marginLeft: 8 }}>
                      AI Tiebreaker
                    </span>
                  )}
                </div>
              )}

              {/* NGO: Submit evidence */}
              {isNGO && (m.status === 0 || m.status === 4) && m.id > 0 && campaign.status === 1 && (
                <div style={{ marginTop: 12, padding: 16, background: "var(--bg)", borderRadius: 8, border: "2px solid var(--border-color)" }}>
                  <p style={{ fontWeight: 700, marginBottom: 8 }}>📤 Submit Evidence</p>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => {
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
          📜 Contract:{" "}
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
