const { listCampaigns } = require("../lib/campaignReads");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const campaigns = await listCampaigns(req.query.account || null);
    return res.status(200).json({ campaigns });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load campaigns",
    });
  }
};
