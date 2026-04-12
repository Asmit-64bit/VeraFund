const { fetchIpfsBuffer } = require("../lib/enhancements");

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
    const cid = String(req.query.cid || "").trim();
    if (!cid) {
      return res.status(400).json({ error: "cid is required" });
    }

    const { buffer, contentType } = await fetchIpfsBuffer(cid);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("IPFS asset proxy error:", error.message);
    return res.status(502).json({ error: "Failed to load media from IPFS" });
  }
};
