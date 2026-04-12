const { getCampaignDetails } = require("../lib/campaignReads");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const address = req.query.address;
  if (!address) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const payload = await getCampaignDetails(address, req.query.account || null);
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load campaign details",
    });
  }
};
