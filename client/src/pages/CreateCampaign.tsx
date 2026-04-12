import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { API_BASE, FACTORY_ADDRESS, FACTORY_ABI } from "../constants";
import {
  attachProfileCidToDescription,
  cacheCampaignProfile,
  getCreatorProfileCompletion,
  joinListToMultiline,
  loadCreatorProfileDraft,
  normalizeOptionalUrl,
  sanitizeCreatorProfile,
} from "../lib/campaignProfile";
import { CAMPAIGN_CATEGORIES, type CampaignCategory } from "../lib/campaigns";
import type { CreatorProfile, WalletState } from "../types";

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

const getTodayInputValue = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateInputToTimestamp = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000);
};

const addDaysToDateInput = (value: string, days: number) => {
  if (!value) return getTodayInputValue();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

export default function CreateCampaign({ wallet }: CreateProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ngoName, setNgoName] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<CampaignCategory[]>(["Education"]);
  const [summary, setSummary] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [organizationType, setOrganizationType] = useState("");
  const [foundedYear, setFoundedYear] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [twitter, setTwitter] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [organizationBio, setOrganizationBio] = useState("");
  const [useOfFunds, setUseOfFunds] = useState("");
  const [proofLinks, setProofLinks] = useState("");
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<File[]>([]);
  const [galleryPreviewUrls, setGalleryPreviewUrls] = useState<string[]>([]);
  const [goalEth, setGoalEth] = useState("");
  const [campaignDeadline, setCampaignDeadline] = useState("");
  const [bootstrapPercent, setBootstrapPercent] = useState(5);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    emptyMilestone(),
    emptyMilestone(),
  ]);
  const todayInput = getTodayInputValue();

  const milestonePercentSum = milestones.reduce(
    (sum, m) => sum + (Number(m.fundPercent) || 0),
    0
  );

  useEffect(() => {
    if (!wallet.account) {
      setCreatorProfile(null);
      return;
    }

    const storedProfile = loadCreatorProfileDraft(wallet.account);
    setCreatorProfile(storedProfile ? sanitizeCreatorProfile(storedProfile) : null);
  }, [wallet.account]);

  const creatorProfileStatus = useMemo(
    () => getCreatorProfileCompletion(creatorProfile),
    [creatorProfile]
  );

  const basicInfoError = (() => {
    if (!goalEth) return null;
    if (Number(goalEth) <= 0) return "Goal must be greater than 0 ETH.";
    if (!campaignDeadline) return null;
    if (campaignDeadline < todayInput) return "Fundraising deadline cannot be in the past.";
    return null;
  })();

  const milestoneTimelineError = (() => {
    if (!campaignDeadline) return "Choose a fundraising deadline before setting milestone dates.";

    for (let i = 0; i < milestones.length; i++) {
      const milestone = milestones[i];
      if (!milestone.deadline) continue;

      if (milestone.deadline <= campaignDeadline) {
        return `Milestone ${i + 1} deadline must be after the fundraising deadline.`;
      }

      if (i > 0) {
        const previousDeadline = milestones[i - 1].deadline;
        if (previousDeadline && milestone.deadline <= previousDeadline) {
          return `Milestone ${i + 1} deadline must be after milestone ${i}.`;
        }
      }
    }

    return null;
  })();

  const updateMilestone = (index: number, field: keyof MilestoneInput, value: string) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  };

  const toggleCategory = (nextCategory: CampaignCategory) => {
    setSelectedCategories((current) => {
      if (current.includes(nextCategory)) {
        return current.filter((entry) => entry !== nextCategory);
      }

      if (current.length >= 2) {
        return [...current.slice(1), nextCategory];
      }

      return [...current, nextCategory];
    });
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
    if (step === 0) {
      return (
        !!title &&
        !!description &&
        !!ngoName &&
        !!summary &&
        selectedCategories.length > 0 &&
        !!goalEth &&
        !!campaignDeadline &&
        !basicInfoError &&
        creatorProfileStatus.isComplete
      );
    }
    if (step === 1) return bootstrapPercent >= 1 && bootstrapPercent <= 15;
    if (step === 2) {
      return (
        milestonePercentSum === 100 &&
        !milestoneTimelineError &&
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
      if (basicInfoError || milestoneTimelineError) {
        toast.error(basicInfoError || milestoneTimelineError || "Please fix the campaign form");
        return;
      }
      if (!creatorProfileStatus.isComplete || !creatorProfileStatus.profile) {
        toast.error("Complete your organizer profile from My Profile before deploying.");
        return;
      }

      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.signer);
      let profileCid: string | null = null;

      const profileFormData = new FormData();
      profileFormData.append("title", title);
      profileFormData.append("category", selectedCategories[0] || "");
      profileFormData.append("categories", JSON.stringify(selectedCategories));
      profileFormData.append("summary", summary);
      profileFormData.append("locationLabel", locationLabel);
      profileFormData.append("beneficiary", beneficiary);
      profileFormData.append("organizationType", organizationType);
      profileFormData.append("foundedYear", foundedYear);
      profileFormData.append("website", normalizeOptionalUrl(website));
      profileFormData.append("instagram", normalizeOptionalUrl(instagram));
      profileFormData.append("facebook", normalizeOptionalUrl(facebook));
      profileFormData.append("twitter", normalizeOptionalUrl(twitter));
      profileFormData.append("linkedin", normalizeOptionalUrl(linkedin));
      profileFormData.append("organizationBio", organizationBio);
      profileFormData.append("useOfFunds", useOfFunds);
      profileFormData.append("proofLinks", proofLinks);
      profileFormData.append("creatorProfile", JSON.stringify(creatorProfileStatus.profile));
      if (coverImage) {
        profileFormData.append("coverImage", coverImage);
      }
      for (const image of galleryImages) {
        profileFormData.append("galleryImages", image);
      }

      const profileResponse = await fetch(`${API_BASE}/upload-campaign-profile`, {
        method: "POST",
        body: profileFormData,
      });

      if (!profileResponse.ok) {
        const profileError = await profileResponse.json().catch(() => null);
        throw new Error(profileError?.error || "Failed to save campaign profile");
      }

      const profileData = await profileResponse.json();
      profileCid = profileData.cid || null;
      cacheCampaignProfile(profileCid, profileData.profile || {});

      const deadlineTimestamp = parseDateInputToTimestamp(campaignDeadline);
      const milestoneInputs = milestones.map((m) => ({
        title: m.title,
        description: m.description,
        fundPercent: Number(m.fundPercent),
        deadline: parseDateInputToTimestamp(m.deadline),
      }));

      toast.loading("Deploying campaign to Sepolia...", { id: "deploy" });

      const tx = await factory.createCampaign(
        title,
        attachProfileCidToDescription(description, profileCid),
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

      toast.success("Campaign deployed successfully.", { id: "deploy" });

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
          <div className="empty-state-title">Connect your wallet</div>
          <div className="empty-state-subtitle">
            You need to connect a wallet to create a campaign.
          </div>
          <button className="neo-btn neo-btn-primary" onClick={wallet.connect}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1120 }}>
      <div className="page-header-stack">
        <div className="page-title-block">
          <h1 className="page-title">Create Campaign</h1>
        </div>
        <p className="page-subtitle">
          Deploy a new escrow campaign to Sepolia. Set your goal, milestones, and
          bootstrap grant.
        </p>
      </div>
      <div className="detail-section" style={{ marginBottom: 24 }}>
        <h3 className="detail-section-title">Organizer Trust Snapshot</h3>
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          Each campaign now publishes who is behind it. Donors will see your public organizer profile, causes, affiliations, and links before deciding to contribute.
        </p>
        {creatorProfileStatus.isComplete && creatorProfileStatus.profile ? (
          <div className="creator-check-banner">
            <strong>{creatorProfileStatus.profile.displayName}</strong>
            <span>
              {creatorProfileStatus.profile.roleTitle || "Organizer"}{creatorProfileStatus.profile.location ? ` · ${creatorProfileStatus.profile.location}` : ""}
            </span>
            <span>{joinListToMultiline(creatorProfileStatus.profile.causes).replace(/\n/g, ", ")}</span>
          </div>
        ) : (
          <div className="form-error-banner" style={{ marginTop: 0 }}>
            Complete your organizer profile in My Profile before launching this campaign. Missing: {creatorProfileStatus.missing.join(", ")}.
          </div>
        )}
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`stepper-step ${i === step ? "active" : ""} ${
              i < step ? "completed" : ""
            }`}
          >
            {i < step ? "Done · " : ""}
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
              placeholder="Describe the campaign clearly so donors understand the need, plan, and expected outcome."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Short donor summary</label>
            <textarea
              className="neo-textarea"
              placeholder="A concise summary donors can read quickly before deciding to contribute."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              style={{ minHeight: 90 }}
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
              <label className="form-label">Campaign categories</label>
              <div className="category-picker-grid">
                {CAMPAIGN_CATEGORIES.map((categoryOption) => {
                  const isSelected = selectedCategories.includes(categoryOption);

                  return (
                    <button
                      key={categoryOption}
                      type="button"
                      className={`category-chip ${isSelected ? "is-selected" : ""}`}
                      onClick={() => toggleCategory(categoryOption)}
                      aria-pressed={isSelected}
                    >
                      {categoryOption}
                    </button>
                  );
                })}
              </div>
              <p className="form-hint">
                Pick up to 2 categories. Donors will be able to filter by either one.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Project location</label>
              <input
                className="neo-input"
                placeholder="City, state, region, or village"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Primary beneficiary</label>
              <input
                className="neo-input"
                placeholder="Who will benefit from this campaign?"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Organisation type</label>
              <input
                className="neo-input"
                placeholder="NGO, trust, community group, individual organiser"
                value={organizationType}
                onChange={(e) => setOrganizationType(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Founded year</label>
              <input
                className="neo-input"
                placeholder="2018"
                value={foundedYear}
                onChange={(e) => setFoundedYear(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Cover image</label>
              <input
                className="neo-input"
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const nextFile = e.target.files?.[0] || null;
                  setCoverImage(nextFile);

                  if (!nextFile) {
                    setCoverImageDataUrl(null);
                    return;
                  }

                  try {
                    setCoverImageDataUrl(await readFileAsDataUrl(nextFile));
                  } catch {
                    setCoverImageDataUrl(null);
                  }
                }}
              />
              {coverImageDataUrl && (
                <img
                  src={coverImageDataUrl}
                  alt="Campaign cover preview"
                  style={{
                    marginTop: 12,
                    width: "100%",
                    maxHeight: 180,
                    objectFit: "cover",
                    borderRadius: 12,
                    border: "2px solid var(--border-color)",
                  }}
                />
              )}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Additional campaign images</label>
            <input
              className="neo-input"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                setGalleryImages(files);

                if (files.length === 0) {
                  setGalleryPreviewUrls([]);
                  return;
                }

                try {
                  const previews = await Promise.all(files.map((file) => readFileAsDataUrl(file)));
                  setGalleryPreviewUrls(previews);
                } catch {
                  setGalleryPreviewUrls([]);
                }
              }}
            />
            {galleryPreviewUrls.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 12,
                  marginTop: 12,
                }}
              >
                {galleryPreviewUrls.map((preview, index) => (
                  <img
                    key={`${preview}-${index}`}
                    src={preview}
                    alt={`Campaign gallery preview ${index + 1}`}
                    style={{
                      width: "100%",
                      height: 110,
                      objectFit: "cover",
                      borderRadius: 12,
                      border: "2px solid var(--border-color)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Organisation background</label>
            <textarea
              className="neo-textarea"
              placeholder="Describe the organisation, its track record, and why donors should trust it."
              value={organizationBio}
              onChange={(e) => setOrganizationBio(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">How funds will be used</label>
            <textarea
              className="neo-textarea"
              placeholder="Break down how the donated funds will be used across operations and milestones."
              value={useOfFunds}
              onChange={(e) => setUseOfFunds(e.target.value)}
            />
          </div>
          <div className="profile-link-grid">
            <div className="form-group">
              <label className="form-label">Website</label>
              <input className="neo-input" placeholder="https://example.org" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Instagram</label>
              <input className="neo-input" placeholder="instagram.com/yourorg" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Facebook</label>
              <input className="neo-input" placeholder="facebook.com/yourorg" value={facebook} onChange={(e) => setFacebook(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Twitter / X</label>
              <input className="neo-input" placeholder="x.com/yourorg" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">LinkedIn</label>
              <input className="neo-input" placeholder="linkedin.com/company/yourorg" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reference links</label>
            <textarea
              className="neo-textarea"
              placeholder="Paste one link per line for annual reports, registration pages, press mentions, or project documents."
              value={proofLinks}
              onChange={(e) => setProofLinks(e.target.value)}
              style={{ minHeight: 110 }}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Goal (ETH)</label>
              <input
                className="neo-input"
                type="number"
                step="0.01"
                min="0.001"
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
                min={todayInput}
                value={campaignDeadline}
                onChange={(e) => setCampaignDeadline(e.target.value)}
              />
            </div>
          </div>
          {basicInfoError && (
            <div className="form-error-banner">{basicInfoError}</div>
          )}
          {!creatorProfileStatus.isComplete && (
            <div className="form-error-banner">
              This campaign cannot be deployed until your organizer profile is complete in My Profile.
            </div>
          )}
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
              Bootstrap amount:{" "}
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
          {milestoneTimelineError && (
            <div className="form-error-banner" style={{ marginTop: 12 }}>
              {milestoneTimelineError}
            </div>
          )}

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
                    min={
                      i === 0
                        ? addDaysToDateInput(campaignDeadline, 1)
                        : addDaysToDateInput(milestones[i - 1].deadline || campaignDeadline, 1)
                    }
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
                <td style={{ fontWeight: 700, padding: "6px 0" }}>Category</td>
                <td>{selectedCategories.join(", ")}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, padding: "6px 0" }}>Location</td>
                <td>{locationLabel || "Not provided"}</td>
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
            <div className="review-block">
              <strong>Donor summary</strong>
              <p>{summary}</p>
            </div>
            <div className="review-block">
              <strong>Organisation background</strong>
              <p>{organizationBio || "No organisation background added."}</p>
            </div>
            <div className="review-block">
              <strong>Use of funds</strong>
              <p>{useOfFunds || "No use-of-funds notes added."}</p>
            </div>
            {milestones.map((m, i) => (
              <div
                key={i}
                className="review-block"
              >
                <strong>
                  #{i + 1} {m.title}
                </strong>{" "}
                — {m.fundPercent}% · {m.deadline ? new Date(m.deadline).toLocaleDateString() : "No deadline"}
              </div>
            ))}
          </div>

          <button
            className="neo-btn neo-btn-primary"
            style={{ width: "100%", marginTop: 16, justifyContent: "center" }}
            onClick={handleDeploy}
            disabled={deploying}
          >
            {deploying ? "Deploying to Sepolia..." : "Deploy Campaign"}
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
