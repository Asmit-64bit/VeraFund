const express = require("express");
const { ethers } = require("ethers");

const router = express.Router();

// In-memory verdict cache: key = "${campaignAddress}_${milestoneId}"
const verdictCache = {};

// Campaign ABI — only the functions we need
const CAMPAIGN_ABI = [
  "function setAIScore(uint256 milestoneId, uint8 score) external",
  "function resolveVote(uint256 milestoneId) external",
  "function getMilestone(uint256 milestoneId) external view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string ipfsHash, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst, bool resolvedByAI, uint8 aiScore))",
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
    const { milestoneId, campaignAddress, cids, milestoneDescription } = req.body;

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

    // Fetch images from IPFS and convert to base64
    const imageContents = [];
    for (const cid of cids) {
      try {
        const response = await fetch(`https://ipfs.io/ipfs/${cid}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const contentType = response.headers.get("content-type") || "image/jpeg";
        imageContents.push({
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${base64}`,
          },
        });
      } catch (fetchErr) {
        console.warn(`Failed to fetch CID ${cid}:`, fetchErr.message);
      }
    }

    if (imageContents.length === 0) {
      return res.status(400).json({ error: "Could not fetch any images from IPFS" });
    }

    // Call OpenAI GPT-4o with vision
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an independent evidence verifier for a charitable donation platform.
You will receive images submitted by an NGO as proof of milestone completion.
Analyze the images against the milestone description provided.
Return ONLY a JSON object. No preamble, no markdown, no explanation outside the JSON.

Return format: { "score": <integer 0-100>, "verdict": "<Verified|Inconclusive|Flagged>", "summary": "<2-3 sentences max>" }

Scoring guide:
80-100: Strong visual evidence clearly matching the milestone description
60-79: Moderate evidence, some alignment with description
40-59: Weak or ambiguous evidence
0-39: No meaningful evidence, likely unrelated or stock images

Flag if: images appear to be stock photos, duplicates, or completely unrelated to the stated milestone.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Milestone description: ${milestoneDescription}\nPlease analyze the attached images.`,
              },
              ...imageContents,
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${openaiResponse.status} — ${errBody}`);
    }

    const openaiData = await openaiResponse.json();
    let content = openaiData.choices[0].message.content.trim();

    // Strip markdown fences if present
    content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

    const verdict = JSON.parse(content);

    // Validate response shape
    if (
      typeof verdict.score !== "number" ||
      !["Verified", "Inconclusive", "Flagged"].includes(verdict.verdict) ||
      typeof verdict.summary !== "string"
    ) {
      throw new Error("Invalid AI response format");
    }

    // Cache the result
    verdictCache[cacheKey] = verdict;

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

/**
 * POST /resolve-vote
 *
 * Called after the 7-day voting window closes.
 * Calls resolveVote(milestoneId) on the campaign contract using backend signer.
 *
 * Body: { campaignAddress, milestoneId }
 * Response: { txHash, outcome, resolvedByAI }
 */
router.post("/resolve-vote", async (req, res) => {
  try {
    const { campaignAddress, milestoneId } = req.body;

    if (!campaignAddress || (!milestoneId && milestoneId !== 0)) {
      return res.status(400).json({ error: "campaignAddress and milestoneId required" });
    }

    const signer = getBackendSigner();
    const campaignContract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, signer);

    // Call resolveVote
    const tx = await campaignContract.resolveVote(milestoneId);
    const receipt = await tx.wait();

    // Read the milestone state after resolution to determine outcome
    const milestone = await campaignContract.getMilestone(milestoneId);
    // MilestoneStatus enum: 0=Pending, 1=Submitted, 2=Voting, 3=Approved, 4=Rejected
    const outcome = milestone.status === 3n ? "approved" : "rejected";

    res.json({
      txHash: tx.hash,
      outcome,
      resolvedByAI: milestone.resolvedByAI,
    });
  } catch (err) {
    console.error("Resolve vote error:", err.message);
    res.status(500).json({ error: "Failed to resolve vote: " + err.message });
  }
});

module.exports = router;
