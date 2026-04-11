import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { FACTORY_ADDRESS, FACTORY_ABI } from "../constants";
import type { WalletState } from "../types";

interface CreateProps {
  wallet: WalletState;
}

interface MilestoneInput {
  title: string;
  description: string;
  fundPercent: string;
  deadline: string;
}

const STEPS = ["Basic Info", "Bootstrap %", "Milestones", "Review & Deploy"];

const emptyMilestone = (): MilestoneInput => ({
  title: "",
  description: "",
  fundPercent: "",
  deadline: "",
});

export default function CreateCampaign({ wallet }: CreateProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ngoName, setNgoName] = useState("");
  const [goalEth, setGoalEth] = useState("");
  const [campaignDeadline, setCampaignDeadline] = useState("");
  const [bootstrapPercent, setBootstrapPercent] = useState(5);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    emptyMilestone(),
    emptyMilestone(),
  ]);

  const milestonePercentSum = milestones.reduce(
    (sum, m) => sum + (Number(m.fundPercent) || 0),
    0
  );

  const updateMilestone = (index: number, field: keyof MilestoneInput, value: string) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  };

  const addMilestone = () => {
    if (milestones.length >= 5) return;
    setMilestones((prev) => [...prev, emptyMilestone()]);
  };

  const removeMilestone = (index: number) => {
    if (milestones.length <= 2) return;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  };

  // Validate each step
  const canProceed = (): boolean => {
    if (step === 0) return !!title && !!description && !!ngoName && !!goalEth && !!campaignDeadline;
    if (step === 1) return bootstrapPercent >= 1 && bootstrapPercent <= 15;
    if (step === 2) {
      return (
        milestonePercentSum === 100 &&
        milestones.every((m) => m.title && m.description && Number(m.fundPercent) > 0 && m.deadline)
      );
    }
    return true;
  };

  // Deploy
  const handleDeploy = async () => {
    if (!wallet.signer) {
      toast.error("Connect your wallet first");
      return;
    }

    setDeploying(true);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.signer);

      const deadlineTimestamp = Math.floor(new Date(campaignDeadline).getTime() / 1000);
      const milestoneInputs = milestones.map((m) => ({
        title: m.title,
        description: m.description,
        fundPercent: Number(m.fundPercent),
        deadline: Math.floor(new Date(m.deadline).getTime() / 1000),
      }));

      toast.loading("Deploying campaign to Sepolia...", { id: "deploy" });

      const tx = await factory.createCampaign(
        title,
        description,
        ngoName,
        bootstrapPercent,
        milestoneInputs,
        ethers.parseEther(goalEth),
        deadlineTimestamp
      );

      const receipt = await tx.wait();

      // Get campaign address from event
      const event = receipt.logs.find(
        (log: ethers.Log) => {
          try {
            return factory.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "CampaignCreated";
          } catch {
            return false;
          }
        }
      );

      let campaignAddress = "";
      if (event) {
        const parsed = factory.interface.parseLog({
          topics: [...event.topics],
          data: event.data,
        });
        campaignAddress = parsed?.args[0] || "";
      }

      toast.success("Campaign deployed! 🎉", { id: "deploy" });

      if (campaignAddress) {
        navigate(`/campaign/${campaignAddress}`);
      } else {
        navigate("/");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Deployment failed", {
        id: "deploy",
      });
    } finally {
      setDeploying(false);
    }
  };

  if (!wallet.account) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">🦊</div>
          <div className="empty-state-title">Connect your wallet</div>
          <div className="empty-state-subtitle">
            You need to connect MetaMask to create a campaign.
          </div>
          <button className="neo-btn neo-btn-primary" onClick={wallet.connect}>
            🦊 Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 700 }}>
      <h1 className="page-title">Create Campaign</h1>
      <p className="page-subtitle">
        Deploy a new escrow campaign to Sepolia. Set your goal, milestones, and
        bootstrap grant.
      </p>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`stepper-step ${i === step ? "active" : ""} ${
              i < step ? "completed" : ""
            }`}
          >
            {i < step ? "✓ " : ""}
            {s}
          </div>
        ))}
      </div>

      {/* Step 0: Basic Info */}
      {step === 0 && (
        <div className="neo-card">
          <div className="form-group">
            <label className="form-label">Campaign Title</label>
            <input
              className="neo-input"
              placeholder="e.g. Build 3 Water Wells"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="neo-textarea"
              placeholder="Describe what this campaign will achieve..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">NGO Name</label>
            <input
              className="neo-input"
              placeholder="e.g. WaterAid India"
              value={ngoName}
              onChange={(e) => setNgoName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Goal (ETH)</label>
              <input
                className="neo-input"
                type="number"
                step="0.01"
                placeholder="1.0"
                value={goalEth}
                onChange={(e) => setGoalEth(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Fundraising Deadline</label>
              <input
                className="neo-input"
                type="date"
                value={campaignDeadline}
                onChange={(e) => setCampaignDeadline(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Bootstrap */}
      {step === 1 && (
        <div className="neo-card" style={{ textAlign: "center" }}>
          <h3 style={{ marginBottom: 8 }}>Bootstrap Grant Percentage</h3>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
            This % is released to the NGO immediately when the funding goal is
            hit. It gives them operating capital to start work.
          </p>
          <div className="bootstrap-value">{bootstrapPercent}%</div>
          <input
            type="range"
            className="bootstrap-slider"
            min={1}
            max={15}
            value={bootstrapPercent}
            onChange={(e) => setBootstrapPercent(Number(e.target.value))}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--text-muted)",
              marginTop: 8,
            }}
          >
            <span>1% min</span>
            <span>15% max</span>
          </div>
          {goalEth && (
            <div className="donate-info" style={{ marginTop: 16 }}>
              💰 Bootstrap amount:{" "}
              <strong>
                {(Number(goalEth) * bootstrapPercent / 100).toFixed(4)} ETH
              </strong>{" "}
              of {goalEth} ETH goal
            </div>
          )}
        </div>
      )}

      {/* Step 2: Milestones */}
      {step === 2 && (
        <div>
          <div className="donate-info">
            Milestone percentages must sum to <strong>100%</strong> (of the
            remaining {100 - bootstrapPercent}% after bootstrap). Currently:{" "}
            <strong
              style={{
                color:
                  milestonePercentSum === 100
                    ? "green"
                    : milestonePercentSum > 100
                    ? "red"
                    : "inherit",
              }}
            >
              {milestonePercentSum}%
            </strong>
          </div>

          {milestones.map((m, i) => (
            <div className="milestone-builder-item" key={i}>
              <div className="milestone-builder-header">
                <span className="milestone-builder-number">
                  Milestone {i + 1}
                </span>
                {milestones.length > 2 && (
                  <button
                    className="remove-milestone"
                    onClick={() => removeMilestone(i)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="form-group">
                <input
                  className="neo-input"
                  placeholder="Milestone title"
                  value={m.title}
                  onChange={(e) => updateMilestone(i, "title", e.target.value)}
                />
              </div>
              <div className="form-group">
                <textarea
                  className="neo-textarea"
                  placeholder="What will be accomplished?"
                  value={m.description}
                  onChange={(e) =>
                    updateMilestone(i, "description", e.target.value)
                  }
                  style={{ minHeight: 60 }}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Fund %</label>
                  <input
                    className="neo-input"
                    type="number"
                    min={1}
                    max={100}
                    placeholder="30"
                    value={m.fundPercent}
                    onChange={(e) =>
                      updateMilestone(i, "fundPercent", e.target.value)
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Deadline</label>
                  <input
                    className="neo-input"
                    type="date"
                    value={m.deadline}
                    onChange={(e) =>
                      updateMilestone(i, "deadline", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          ))}

          {milestones.length < 5 && (
            <button
              className="neo-btn neo-btn-outline"
              onClick={addMilestone}
              style={{ width: "100%" }}
            >
              + Add Milestone
            </button>
          )}
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="neo-card">
          <h3 style={{ marginBottom: 16 }}>Review Your Campaign</h3>
          <table style={{ width: "100%", fontSize: 15 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>Title</td>
                <td>{title}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>NGO</td>
                <td>{ngoName}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>Goal</td>
                <td>{goalEth} ETH</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>Bootstrap</td>
                <td>
                  {bootstrapPercent}% (
                  {(Number(goalEth) * bootstrapPercent / 100).toFixed(4)} ETH)
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>
                  Deadline
                </td>
                <td>{new Date(campaignDeadline).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>
                  Milestones
                </td>
                <td>{milestones.length}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            {milestones.map((m, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  background: "var(--bg)",
                  borderRadius: 8,
                  border: "2px solid var(--border-color)",
                  marginBottom: 8,
                  fontSize: 14,
                }}
              >
                <strong>
                  #{i + 1} {m.title}
                </strong>{" "}
                — {m.fundPercent}%
              </div>
            ))}
          </div>

          <button
            className="neo-btn neo-btn-primary"
            style={{ width: "100%", marginTop: 16, justifyContent: "center" }}
            onClick={handleDeploy}
            disabled={deploying}
          >
            {deploying ? "Deploying to Sepolia..." : "🚀 Deploy Campaign"}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 24,
        }}
      >
        <button
          className="neo-btn neo-btn-outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          ← Back
        </button>
        {step < 3 && (
          <button
            className="neo-btn neo-btn-primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canProceed()}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
