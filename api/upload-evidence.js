const PinataSDK = require("@pinata/sdk");
const { IncomingForm } = require("formidable");
const fs = require("fs");
const {
  buildProofCode,
  extractEvidenceMetadata,
  enrichAuthenticityChecks,
  normalizeClaimedLocation,
} = require("../lib/enhancements");

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isAllowedImageMimeType(mimeType) {
  return ALLOWED_IMAGE_MIME_TYPES.has(String(mimeType || "").toLowerCase());
}

function cleanupFiles(files) {
  for (const file of files) {
    if (file?.filepath && fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let uploaded = [];

  try {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFiles: 10,
      maxFileSize: MAX_IMAGE_SIZE_BYTES,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({ fields, files });
      });
    });

    uploaded = Array.isArray(files.files)
      ? files.files
      : files.files
        ? [files.files]
        : [];

    if (uploaded.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    for (const file of uploaded) {
      if (!isAllowedImageMimeType(file.mimetype) || file.size > MAX_IMAGE_SIZE_BYTES) {
        return res.status(400).json({
          error: "Only JPEG, PNG, and WEBP images up to 10 MB are allowed.",
        });
      }
    }

    const pinata = new PinataSDK(
      process.env.PINATA_API_KEY,
      process.env.PINATA_SECRET
    );

    const cids = [];
    const claimedLocation = normalizeClaimedLocation(fields);
    const uploads = [];
    const milestoneId = Array.isArray(fields.milestoneId) ? fields.milestoneId[0] : fields.milestoneId;
    const campaignAddress = Array.isArray(fields.campaignAddress) ? fields.campaignAddress[0] : fields.campaignAddress;
    const proofCode =
      milestoneId !== undefined && campaignAddress
        ? buildProofCode(campaignAddress, milestoneId)
        : null;

    for (const file of uploaded) {
      const evidenceMetadata = await extractEvidenceMetadata(
        file.filepath,
        file.originalFilename || "evidence",
        claimedLocation
      );
      evidenceMetadata.__fileBuffer = await fs.promises.readFile(file.filepath);
      await enrichAuthenticityChecks(evidenceMetadata);
      const stream = fs.createReadStream(file.filepath);
      const result = await pinata.pinFileToIPFS(stream, {
        pinataMetadata: {
          name: file.originalFilename || "evidence",
        },
      });
      cids.push(result.IpfsHash);
      uploads.push({
        cid: result.IpfsHash,
        ...evidenceMetadata,
      });
    }

    return res.status(200).json({ cids, uploads, claimedLocation, proofCode });
  } catch (err) {
    console.error("Upload error:", err.message);
    return res.status(500).json({ error: "Failed to upload to IPFS: " + err.message });
  } finally {
    cleanupFiles(uploaded);
  }
};
