const express = require("express");
const {
  listCampaigns,
  getCampaignDetails,
  getAuditTrail,
  getReadableAuditError,
} = require("../../lib/campaignReads");

const router = express.Router();

router.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await listCampaigns(req.query.account || null);
    return res.json({ campaigns });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load campaigns",
    });
  }
});

router.get("/campaign", async (req, res) => {
  if (!req.query.address) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const payload = await getCampaignDetails(req.query.address, req.query.account || null);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load campaign details",
    });
  }
});

router.get("/campaign-audit", async (req, res) => {
  if (!req.query.address) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const entries = await getAuditTrail(req.query.address);
    return res.json({ entries });
  } catch (error) {
    return res.status(500).json({
      error: getReadableAuditError(error),
    });
  }
});

module.exports = router;
