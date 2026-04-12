const express = require("express");
const { fetchIpfsBuffer } = require("../../lib/enhancements");

const router = express.Router();

router.get("/ipfs-asset", async (req, res) => {
  try {
    const cid = String(req.query.cid || "").trim();
    if (!cid) {
      return res.status(400).json({ error: "cid is required" });
    }

    const { buffer, contentType } = await fetchIpfsBuffer(cid);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    return res.send(buffer);
  } catch (error) {
    console.error("IPFS asset proxy error:", error.message);
    return res.status(502).json({ error: "Failed to load media from IPFS" });
  }
});

module.exports = router;
