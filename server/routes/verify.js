const express = require("express");
const { ethers } = require("ethers");
const {
  buildProofCode,
  buildProofMarker,
  fetchIpfsImageContent,
  summarizeAuthenticityChecks,
  summarizeCampaignBindingChecks,
  summarizeGeospatialChecks,
} = require("../../lib/enhancements");
const {
  findPreviousEvidenceMatches,
  loadMilestoneEvidenceFromStore,
  saveMilestoneEvidence,
  summarizeEvidenceHistory,
} = require("../../lib/evidenceStore");

const router = express.Router();

// In-memory verdict cache: key = "${campaignAddress}_${milestoneId}"
const verdictCache = {};
const evidenceMetadataCache = {};

function buildBindingSummaryText(bindingSummary) {
  if (!bindingSummary?.notes?.length) {
    return "No campaign-binding concerns were detected.";
  }

  return bindingSummary.notes.join(" | ");
}

function parseJsonResponse(content) {
  const cleaned = String(content || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

async function requestOpenAIJson(messages) {
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 500,
    }),
  });

  if (!openaiResponse.ok) {
    const errBody = await openaiResponse.text();
    throw new Error(`OpenAI API error: ${openaiResponse.status} — ${errBody}`);
  }

  const openaiData = await openaiResponse.json();
  return parseJsonResponse(openaiData.choices?.[0]?.message?.content);
}

// Campaign ABI — only the functions we need
const CAMPAIGN_ABI = [
  "function setAIScore(uint256 milestoneId, uint8 score) external",
];

/**
 * Get ethers signer for backend wallet
 */
function getBackendSigner() {
  if (!process.env.BACKEND_SIGNER_PRIVATE_KEY || !process.env.SEPOLIA_RPC_URL) {
    throw new Error("Missing BACKEND_SIGNER_PRIVATE_KEY or SEPOLIA_RPC_URL");
  }
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  return new ethers.Wallet(process.env.BACKEND_SIGNER_PRIVATE_KEY, provider);
}

/**
 * POST /verify-milestone
 *
 * Analyze submitted evidence with GPT-4o vision.
 * Stores result, writes AI score on-chain via setAIScore().
 *
 * Body: { milestoneId, campaignAddress, cids, milestoneDescription }
 * Response: { score, verdict, summary }
 */
router.post("/verify-milestone", async (req, res) => {
  try {
    const {
      milestoneId,
      campaignAddress,
      cids,
      milestoneDescription,
      uploads = [],
      claimedLocation = null,
      campaignTitle = "VeraFund Campaign",
      milestoneTitle = "Milestone",
      proofCode = null,
    } = req.body;

    if (!milestoneId && milestoneId !== 0) {
      return res.status(400).json({ error: "milestoneId is required" });
    }
    if (!campaignAddress || !cids || !milestoneDescription) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check cache
    const cacheKey = `${campaignAddress}_${milestoneId}`;
    if (verdictCache[cacheKey]) {
      return res.json(verdictCache[cacheKey]);
    }

    const authenticitySummary = summarizeAuthenticityChecks(uploads);
    const geospatialSummary = summarizeGeospatialChecks(uploads, claimedLocation);
    const expectedProofCode = proofCode || buildProofCode(campaignAddress, milestoneId);
    const expectedProofMarker = buildProofMarker(campaignAddress, milestoneId, milestoneTitle);
    const previousMilestoneMatches = findPreviousEvidenceMatches(
      campaignAddress,
      milestoneId,
      uploads
    );
    const evidenceHistorySummary = summarizeEvidenceHistory(campaignAddress, milestoneId);

    // Fetch images from IPFS and convert to base64
    const imageContents = [];
    for (const cid of cids) {
      try {
        imageContents.push(await fetchIpfsImageContent(cid));
      } catch (fetchErr) {
        console.warn(`Failed to fetch CID ${cid}:`, fetchErr.message);
      }
    }

    if (imageContents.length === 0) {
      return res.status(400).json({ error: "Could not fetch any images from IPFS" });
    }

    const bindingReview = await requestOpenAIJson([
      {
        role: "system",
        content: `You review whether milestone evidence appears to be genuinely captured for one specific campaign update.
Return ONLY a JSON object in this format:
{ "status": "<Present|Partial|Missing|Mismatch|Insufficient>", "confidence": <integer 0-100>, "observedProofCode": "<string or empty>", "campaignSpecificity": "<Strong|Moderate|Weak>", "summary": "<2 sentences max>", "notes": ["<note1>", "<note2>"] }

Use these rules:
- "Present" means the exact proof code or exact milestone marker phrase is clearly visible, and the evidence is strongly campaign-specific.
- "Partial" means there are some campaign-specific signals but the proof code or marker phrase is unclear or incomplete.
- "Missing" means there is no visible proof code or marker phrase and the evidence could be generic.
- "Mismatch" means the visible code, marker phrase, or visual context conflicts with the expected campaign or milestone.
- "Insufficient" means the images do not contain enough information to decide.

Be conservative. If the evidence could plausibly be a generic or recycled image, prefer Missing or Insufficient.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Campaign title: ${campaignTitle}
Milestone title: ${milestoneTitle}
Milestone description: ${milestoneDescription}
Expected proof code: ${expectedProofCode}
Expected milestone marker phrase: ${expectedProofMarker}
Earlier verified milestone history: ${evidenceHistorySummary}
Exact duplicate matches against previous milestones: ${
              previousMilestoneMatches.length > 0
                ? previousMilestoneMatches
                    .map(
                      (match) =>
                        `Milestone ${match.previousMilestoneId} (${match.previousMilestoneTitle})`
                    )
                    .join(" | ")
                : "none"
            }
Review whether these images look captured specifically for this campaign milestone and whether the expected proof code or milestone marker phrase is visible.`,
          },
          ...imageContents,
        ],
      },
    ]).catch(() => null);

    const bindingSummary = summarizeCampaignBindingChecks({
      proofCode: expectedProofCode,
      proofMarker: expectedProofMarker,
      bindingReview,
      previousMilestoneMatches,
    });

    // Call OpenAI GPT-4o with vision
    const verdict = await requestOpenAIJson([
      {
        role: "system",
        content: `You are an independent evidence verifier for a charitable donation platform.
You will receive images submitted by an NGO as proof of milestone completion.
Analyze the images against the milestone description provided, while also considering the authenticity pre-checks supplied by the server.
Return ONLY a JSON object. No preamble, no markdown, no explanation outside the JSON.

Return format: { "score": <integer 0-100>, "verdict": "<Verified|Inconclusive|Flagged>", "summary": "<2-3 sentences max>" }

Scoring guide:
80-100: Strong visual evidence clearly matching the milestone description
60-79: Moderate evidence, some alignment with description
40-59: Weak or ambiguous evidence
0-39: No meaningful evidence, likely unrelated or stock images

Flag if: images appear to be stock photos, duplicates, synthetic, downloaded from the web, edited, or completely unrelated to the stated milestone.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Milestone description: ${milestoneDescription}
Claimed location: ${claimedLocation?.label || "Not provided"}
Authenticity pre-check summary: ${authenticitySummary.notes.length > 0 ? authenticitySummary.notes.join(" | ") : "No server-side authenticity flags detected."}
Campaign binding summary: ${buildBindingSummaryText(bindingSummary)}
Please analyze the attached images.`,
          },
          ...imageContents,
        ],
      },
    ]);

    // Validate response shape
    if (
      typeof verdict.score !== "number" ||
      !["Verified", "Inconclusive", "Flagged"].includes(verdict.verdict) ||
      typeof verdict.summary !== "string"
    ) {
      throw new Error("Invalid AI response format");
    }

    const geospatialReview = await requestOpenAIJson([
      {
        role: "system",
        content: `You are a geospatial plausibility reviewer for a charity evidence platform.
Judge whether the submitted milestone photos look consistent with the claimed project setting and location context.
Use visual clues conservatively. If the images do not contain enough location evidence, say so.
Return ONLY a JSON object in this format:
{ "status": "<Consistent|Questionable|Mismatch|Insufficient>", "confidence": <integer 0-100>, "estimatedSetting": "<short phrase>", "keyClues": ["<clue1>", "<clue2>"], "summary": "<2 sentences max>" }`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Claimed location label: ${claimedLocation?.label || "Not provided"}
Claimed coordinates provided: ${geospatialSummary.hasClaimedCoordinates ? "yes" : "no"}
GPS-tagged image count: ${geospatialSummary.gpsImageCount}
Average GPS distance from claimed coordinates: ${geospatialSummary.averageDistanceKm ?? "unknown"} km
Reverse-geocoded locality mismatches: ${geospatialSummary.localityMismatchCount}
Previous milestone evidence history: ${evidenceHistorySummary}
Milestone description: ${milestoneDescription}
Assess whether the scene plausibly matches the claimed project environment and location context.`,
          },
          ...imageContents,
        ],
      },
    ]).catch(() => null);

    if (!authenticitySummary.passed) {
      verdict.score = Math.min(verdict.score, 35);
      verdict.verdict = "Flagged";
      verdict.summary = `Authenticity checks failed before visual review. ${authenticitySummary.notes.slice(0, 2).join(" ")}`.trim();
    }

    verdict.authenticity = authenticitySummary;
    verdict.binding = bindingSummary;
    if (
      geospatialReview &&
      ["Consistent", "Questionable", "Mismatch", "Insufficient"].includes(geospatialReview.status) &&
      typeof geospatialReview.summary === "string"
    ) {
      verdict.geospatial = {
        ...geospatialReview,
        averageDistanceKm: geospatialSummary.averageDistanceKm,
        localityMismatchCount: geospatialSummary.localityMismatchCount,
        gpsImageCount: geospatialSummary.gpsImageCount,
      };

      if (geospatialReview.status === "Mismatch") {
        verdict.score = Math.min(verdict.score, 45);
        verdict.verdict = "Flagged";
        verdict.summary = `${verdict.summary} Geospatial review flagged a likely mismatch with the claimed site.`.trim();
      } else if (geospatialReview.status === "Questionable" && verdict.verdict === "Verified") {
        verdict.score = Math.min(verdict.score, 60);
        verdict.verdict = "Inconclusive";
        verdict.summary = `${verdict.summary} Geospatial review found unresolved location inconsistencies.`.trim();
      }
    }

    if (!bindingSummary.passed) {
      verdict.score = Math.min(verdict.score, 30);
      verdict.verdict = "Flagged";
      verdict.summary = `${verdict.summary} Campaign-specific proof checks were not strong enough for this milestone.`.trim();
    }

    // Cache the result
    verdictCache[cacheKey] = verdict;
    evidenceMetadataCache[cacheKey] = {
      uploads,
      claimedLocation,
      authenticity: authenticitySummary,
      geospatial: verdict.geospatial || null,
      binding: bindingSummary,
      aiReview: {
        score: verdict.score,
        verdict: verdict.verdict,
        summary: verdict.summary,
      },
    };

    saveMilestoneEvidence({
      campaignAddress,
      milestoneId,
      campaignTitle,
      milestoneTitle,
      claimedLocation,
      uploads,
      authenticity: authenticitySummary,
      geospatial: verdict.geospatial || null,
      binding: bindingSummary,
      aiReview: {
        score: verdict.score,
        verdict: verdict.verdict,
        summary: verdict.summary,
      },
    });

    // Write AI score on-chain via backend signer
    try {
      const signer = getBackendSigner();
      const campaignContract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, signer);
      const tx = await campaignContract.setAIScore(milestoneId, verdict.score);
      await tx.wait();
      console.log(`AI score ${verdict.score} written on-chain for ${cacheKey}, tx: ${tx.hash}`);
    } catch (chainErr) {
      console.error("Failed to write AI score on-chain:", chainErr.message);
      // Still return the verdict — on-chain write is best-effort
    }

    res.json(verdict);
  } catch (err) {
    console.error("Verify error:", err.message);
    res.status(500).json({ error: "Verification failed: " + err.message });
  }
});

/**
 * GET /verdict/:campaignAddress/:milestoneId
 *
 * Return cached AI verdict. Returns 404 if not yet verified.
 */
router.get("/verdict/:campaignAddress/:milestoneId", (req, res) => {
  const { campaignAddress, milestoneId } = req.params;
  const cacheKey = `${campaignAddress}_${milestoneId}`;

  if (verdictCache[cacheKey]) {
    return res.json(verdictCache[cacheKey]);
  }

  res.status(404).json({ error: "Verdict not found for this milestone" });
});

router.get("/evidence-metadata", (req, res) => {
  const { campaignAddress, milestoneId } = req.query;
  const cacheKey = `${campaignAddress}_${milestoneId}`;

  if (evidenceMetadataCache[cacheKey]) {
    return res.json(evidenceMetadataCache[cacheKey]);
  }

  const stored = loadMilestoneEvidenceFromStore(campaignAddress, milestoneId);
  if (stored) {
    return res.json(stored);
  }

  return res.status(404).json({ error: "Evidence metadata not found" });
});

module.exports = router;
