const fs = require("fs");
const path = require("path");

const STORE_DIR = path.join(process.cwd(), "cache");
const STORE_FILE = path.join(STORE_DIR, "evidence-store.json");

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(STORE_FILE, "utf8");
    if (!raw.trim()) {
      return {};
    }

    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store) {
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function normalizeCampaignAddress(address) {
  return String(address || "").toLowerCase();
}

function sanitizeUploads(uploads) {
  return (Array.isArray(uploads) ? uploads : []).map((upload) => ({
    cid: upload.cid,
    fileName: upload.fileName,
    location: upload.location || null,
    comparison: upload.comparison || null,
    authenticity: upload.authenticity || null,
  }));
}

function loadCampaignEvidenceHistory(campaignAddress) {
  if (!campaignAddress) return { milestones: {} };
  const store = readStore();
  return store[normalizeCampaignAddress(campaignAddress)] || { milestones: {} };
}

function loadMilestoneEvidenceFromStore(campaignAddress, milestoneId) {
  const history = loadCampaignEvidenceHistory(campaignAddress);
  return history.milestones?.[String(milestoneId)] || null;
}

function saveMilestoneEvidence({
  campaignAddress,
  milestoneId,
  campaignTitle,
  milestoneTitle,
  claimedLocation,
  uploads,
  authenticity,
  geospatial,
  binding,
  aiReview,
}) {
  if (!campaignAddress && campaignAddress !== "") return;
  if (milestoneId === undefined || milestoneId === null) return;

  const store = readStore();
  const key = normalizeCampaignAddress(campaignAddress);
  const existingCampaign = store[key] || { milestones: {} };

  existingCampaign.campaignTitle = campaignTitle || existingCampaign.campaignTitle || null;
  existingCampaign.milestones = existingCampaign.milestones || {};
  existingCampaign.milestones[String(milestoneId)] = {
    milestoneId,
    milestoneTitle: milestoneTitle || null,
    claimedLocation: claimedLocation || null,
    uploads: sanitizeUploads(uploads),
    authenticity: authenticity || null,
    geospatial: geospatial || null,
    binding: binding || null,
    aiReview: aiReview || null,
    verifiedAt: new Date().toISOString(),
  };

  store[key] = existingCampaign;
  writeStore(store);
}

function findPreviousEvidenceMatches(campaignAddress, milestoneId, uploads) {
  const history = loadCampaignEvidenceHistory(campaignAddress);
  const hashes = new Map();

  for (const upload of Array.isArray(uploads) ? uploads : []) {
    const sha = upload?.authenticity?.sha256;
    if (sha) {
      hashes.set(sha, upload.fileName || "Submitted image");
    }
  }

  const matches = [];
  for (const [storedMilestoneId, entry] of Object.entries(history.milestones || {})) {
    if (Number(storedMilestoneId) === Number(milestoneId)) {
      continue;
    }

    for (const upload of entry.uploads || []) {
      const sha = upload?.authenticity?.sha256;
      if (!sha || !hashes.has(sha)) continue;

      matches.push({
        previousMilestoneId: Number(storedMilestoneId),
        previousMilestoneTitle: entry.milestoneTitle || `Milestone ${storedMilestoneId}`,
        fileName: hashes.get(sha),
        matchedFileName: upload.fileName || "Stored evidence",
        sha256: sha,
      });
    }
  }

  return matches;
}

function summarizeEvidenceHistory(campaignAddress, currentMilestoneId) {
  const history = loadCampaignEvidenceHistory(campaignAddress);
  const entries = Object.values(history.milestones || {})
    .filter((entry) => Number(entry.milestoneId) !== Number(currentMilestoneId))
    .sort((left, right) => Number(left.milestoneId) - Number(right.milestoneId))
    .map((entry) => {
      const firstUpload = (entry.uploads || [])[0] || null;
      const locationLabel =
        entry.claimedLocation?.label ||
        firstUpload?.location?.localityLabel ||
        "unknown location";
      const capturedAt =
        firstUpload?.authenticity?.capturedAt || entry.verifiedAt || "unknown time";

      return `Milestone ${entry.milestoneId} (${entry.milestoneTitle || "Untitled"}): ${locationLabel}, captured ${capturedAt}`;
    });

  return entries.length > 0
    ? entries.join(" | ")
    : "No earlier verified milestone evidence is stored for this campaign.";
}

module.exports = {
  findPreviousEvidenceMatches,
  loadCampaignEvidenceHistory,
  loadMilestoneEvidenceFromStore,
  saveMilestoneEvidence,
  summarizeEvidenceHistory,
};
