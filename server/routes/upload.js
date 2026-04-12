const express = require("express");
const multer = require("multer");
const PinataSDK = require("@pinata/sdk");
const fs = require("fs");
const {
  buildProofCode,
  extractEvidenceMetadata,
  enrichAuthenticityChecks,
  normalizeClaimedLocation,
} = require("../../lib/enhancements");

const router = express.Router();
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isAllowedImageMimeType(mimeType) {
  return ALLOWED_IMAGE_MIME_TYPES.has(String(mimeType || "").toLowerCase());
}

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 10,
  },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedImageMimeType(file.mimetype)) {
      callback(new Error("Only JPEG, PNG, and WEBP images are allowed."));
      return;
    }

    callback(null, true);
  },
});

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
    const claimedLocation = normalizeClaimedLocation(req.body);
    const uploads = [];
    const milestoneId = req.body?.milestoneId;
    const campaignAddress = req.body?.campaignAddress;
    const proofCode =
      milestoneId !== undefined && campaignAddress
        ? buildProofCode(campaignAddress, milestoneId)
        : null;

    for (const file of req.files) {
      const evidenceMetadata = await extractEvidenceMetadata(
        file.path,
        file.originalname,
        claimedLocation
      );
      evidenceMetadata.__fileBuffer = await fs.promises.readFile(file.path);
      await enrichAuthenticityChecks(evidenceMetadata);
      const readableStream = fs.createReadStream(file.path);
      const result = await pinata.pinFileToIPFS(readableStream, {
        pinataMetadata: {
          name: file.originalname,
        },
      });
      cids.push(result.IpfsHash);
      uploads.push({
        cid: result.IpfsHash,
        ...evidenceMetadata,
      });
    }

    res.json({ cids, uploads, claimedLocation, proofCode });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: "Failed to upload to IPFS: " + err.message });
  } finally {
    for (const file of req.files || []) {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }
});

module.exports = router;
