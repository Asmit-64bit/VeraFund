const express = require("express");
const multer = require("multer");
const PinataSDK = require("@pinata/sdk");
const fs = require("fs");
const { Readable } = require("stream");
const { saveCampaignProfileToStore } = require("../../lib/campaignProfileStore");

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

function parseDataUrlImage(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;

  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;

  const mimeType = String(match[1] || "").toLowerCase();
  if (!isAllowedImageMimeType(mimeType)) {
    throw new Error("Only JPEG, PNG, and WEBP images are allowed.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Images must be 10 MB or smaller.");
  }

  return { mimeType, buffer };
}

function parseCategories(rawValue) {
  if (Array.isArray(rawValue)) {
    return Array.from(new Set(rawValue.map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, 2);
  }

  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, 2);
      }
    } catch {
      // Fall through to plain text parsing.
    }

    return Array.from(
      new Set(rawValue.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean))
    ).slice(0, 2);
  }

  return [];
}

function cleanupFiles(files) {
  for (const file of files) {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 9,
  },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedImageMimeType(file.mimetype)) {
      callback(new Error("Only JPEG, PNG, and WEBP images are allowed."));
      return;
    }

    callback(null, true);
  },
});

async function pinDataUrlToIpfs(pinata, dataUrl, fallbackName) {
  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return null;

  const { mimeType, buffer } = parsed;
  const extension = mimeType.split("/")[1] || "png";
  const stream = Readable.from(buffer);
  stream.path = `${fallbackName}.${extension}`;

  const uploadResult = await pinata.pinFileToIPFS(stream, {
    pinataMetadata: {
      name: `${fallbackName}.${extension}`,
    },
  });

  return `ipfs://${uploadResult.IpfsHash}`;
}

async function pinUploadedFile(pinata, file, fallbackName) {
  if (!file?.path) return null;

  const stream = fs.createReadStream(file.path);
  const uploadResult = await pinata.pinFileToIPFS(stream, {
    pinataMetadata: {
      name: file.originalname || fallbackName,
    },
  });

  return {
    cid: uploadResult.IpfsHash,
    url: `ipfs://${uploadResult.IpfsHash}`,
  };
}

router.post(
  "/upload-campaign-profile",
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 8 },
  ]),
  async (req, res) => {
  try {
    const pinata = new PinataSDK(
      process.env.PINATA_API_KEY,
      process.env.PINATA_SECRET
    );

    const coverImage = Array.isArray(req.files?.coverImage) ? req.files.coverImage[0] : null;
    const coverImageUpload = await pinUploadedFile(pinata, coverImage, "campaign-cover");
    const galleryImages = Array.isArray(req.files?.galleryImages) ? req.files.galleryImages : [];
    const galleryUploads = [];

    for (const [index, image] of galleryImages.entries()) {
      const uploaded = await pinUploadedFile(pinata, image, `campaign-gallery-${index + 1}`);
      if (uploaded) {
        galleryUploads.push({
          cid: uploaded.cid,
          url: uploaded.url,
          alt: image.originalname || `Campaign image ${index + 1}`,
        });
      }
    }

    const proofLinks = typeof req.body.proofLinks === "string"
      ? req.body.proofLinks.split("\n").map((entry) => entry.trim()).filter(Boolean)
      : [];

    let creatorProfile = null;
    if (typeof req.body.creatorProfile === "string") {
      try {
        creatorProfile = JSON.parse(req.body.creatorProfile);
      } catch {
        creatorProfile = null;
      }
    }

    if (creatorProfile?.profileImageDataUrl) {
      creatorProfile.profileImageUrl = await pinDataUrlToIpfs(
        pinata,
        creatorProfile.profileImageDataUrl,
        `${req.body.title || "campaign"}-creator`
      );
    }

    if (creatorProfile) {
      delete creatorProfile.profileImageDataUrl;
    }

    const categories = parseCategories(req.body.categories || req.body.category);

    const profile = {
      category: categories[0] || "",
      categories,
      summary: req.body.summary || "",
      locationLabel: req.body.locationLabel || "",
      beneficiary: req.body.beneficiary || "",
      organizationType: req.body.organizationType || "",
      foundedYear: req.body.foundedYear || "",
      website: req.body.website || "",
      instagram: req.body.instagram || "",
      facebook: req.body.facebook || "",
      twitter: req.body.twitter || "",
      linkedin: req.body.linkedin || "",
      organizationBio: req.body.organizationBio || "",
      useOfFunds: req.body.useOfFunds || "",
      proofLinks,
      coverImageCid: coverImageUpload?.cid || null,
      coverImageUrl: coverImageUpload?.url || null,
      galleryImages: galleryUploads,
      creatorProfile,
    };

    const result = await pinata.pinJSONToIPFS(profile, {
      pinataMetadata: {
        name: `${req.body.title || "campaign"}-profile`,
      },
    });

    try {
      saveCampaignProfileToStore(result.IpfsHash, profile);
    } catch {
      // Local cache is best-effort only.
    }

    return res.json({
      cid: result.IpfsHash,
      uri: `ipfs://${result.IpfsHash}`,
      profile,
    });
  } catch (err) {
    console.error("Campaign profile upload error:", err.message);
    return res.status(500).json({ error: "Failed to upload campaign profile: " + err.message });
  } finally {
    cleanupFiles([
      ...(Array.isArray(req.files?.coverImage) ? req.files.coverImage : []),
      ...(Array.isArray(req.files?.galleryImages) ? req.files.galleryImages : []),
    ]);
  }
});

module.exports = router;
