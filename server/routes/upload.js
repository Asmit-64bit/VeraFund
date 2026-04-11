const express = require("express");
const multer = require("multer");
const PinataSDK = require("@pinata/sdk");
const fs = require("fs");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

/**
 * POST /upload-evidence
 *
 * Upload one or more image files to IPFS via Pinata.
 * Request: multipart/form-data, field name "files" (multiple allowed)
 * Response: { cids: ["QmXyz123...", "QmAbc456..."] }
 */
router.post("/upload-evidence", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const pinata = new PinataSDK(
      process.env.PINATA_API_KEY,
      process.env.PINATA_SECRET
    );

    const cids = [];

    for (const file of req.files) {
      const readableStream = fs.createReadStream(file.path);
      const result = await pinata.pinFileToIPFS(readableStream, {
        pinataMetadata: {
          name: file.originalname,
        },
      });
      cids.push(result.IpfsHash);

      // Clean up temp file
      fs.unlinkSync(file.path);
    }

    res.json({ cids });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: "Failed to upload to IPFS: " + err.message });
  }
});

module.exports = router;
