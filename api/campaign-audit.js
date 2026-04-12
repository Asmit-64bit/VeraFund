const { getAuditTrail, getReadableAuditError } = require("../lib/campaignReads");

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

  if (!req.query.address) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const entries = await getAuditTrail(req.query.address);
    return res.status(200).json({ entries });
  } catch (error) {
    return res.status(500).json({
      error: getReadableAuditError(error),
    });
  }
};
