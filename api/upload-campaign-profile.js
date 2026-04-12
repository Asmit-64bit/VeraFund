const PinataSDK = require("@pinata/sdk");
const { IncomingForm } = require("formidable");
const fs = require("fs");
const { Readable } = require("stream");
const { saveCampaignProfileToStore } = require("../lib/campaignProfileStore");
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
    if (file?.filepath && fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }
  }
}

async function pinDataUrlToIpfs(pinata, dataUrl, fallbackName) {
  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return null;

  const { mimeType, buffer } = parsed;
  const extension = mimeType.split("/")[1] || "png";
  const stream = Readable.from(buffer);
  stream.path = `${fallbackName}.${extension}`;

  const upload = await pinata.pinFileToIPFS(stream, {
    pinataMetadata: {
      name: `${fallbackName}.${extension}`,
    },
  });

  return `ipfs://${upload.IpfsHash}`;
}

async function pinUploadedFile(pinata, file, fallbackName) {
  if (!file?.filepath) return null;

  const stream = fs.createReadStream(file.filepath);
  const upload = await pinata.pinFileToIPFS(stream, {
    pinataMetadata: {
      name: file.originalFilename || fallbackName,
    },
  });

  return {
    cid: upload.IpfsHash,
    url: `ipfs://${upload.IpfsHash}`,
  };
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

  let parsedFiles = {};

  try {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFiles: 9,
      maxFileSize: MAX_IMAGE_SIZE_BYTES,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });
    parsedFiles = files;

    const pinata = new PinataSDK(
      process.env.PINATA_API_KEY,
      process.env.PINATA_SECRET
    );

    const coverImage = Array.isArray(files.coverImage) ? files.coverImage[0] : files.coverImage;
    const uploadedFiles = [
      ...(coverImage ? [coverImage] : []),
      ...(Array.isArray(files.galleryImages)
        ? files.galleryImages
        : files.galleryImages
          ? [files.galleryImages]
          : []),
    ];

    for (const file of uploadedFiles) {
      if (!isAllowedImageMimeType(file.mimetype) || file.size > MAX_IMAGE_SIZE_BYTES) {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({
          error: "Only JPEG, PNG, and WEBP images up to 10 MB are allowed.",
        });
      }
    }

    const coverImageUpload = await pinUploadedFile(pinata, coverImage, "campaign-cover");
    const galleryImages = Array.isArray(files.galleryImages)
      ? files.galleryImages
      : files.galleryImages
        ? [files.galleryImages]
        : [];
    const galleryUploads = [];

    for (const [index, image] of galleryImages.entries()) {
      const uploaded = await pinUploadedFile(pinata, image, `campaign-gallery-${index + 1}`);
      if (uploaded) {
        galleryUploads.push({
          cid: uploaded.cid,
          url: uploaded.url,
          alt: image.originalFilename || `Campaign image ${index + 1}`,
        });
      }
    }

    const proofLinks = typeof fields.proofLinks === "string"
      ? fields.proofLinks.split("\n").map((entry) => entry.trim()).filter(Boolean)
      : [];

    let creatorProfile = null;
    if (typeof fields.creatorProfile === "string") {
      try {
        creatorProfile = JSON.parse(fields.creatorProfile);
      } catch {
        creatorProfile = null;
      }
    }

    if (creatorProfile?.profileImageDataUrl) {
      creatorProfile.profileImageUrl = await pinDataUrlToIpfs(
        pinata,
        creatorProfile.profileImageDataUrl,
        `${fields.title || "campaign"}-creator`
      );
    }

    if (creatorProfile) {
      delete creatorProfile.profileImageDataUrl;
    }

    const categories = parseCategories(fields.categories || fields.category);

    const profile = {
      category: categories[0] || "",
      categories,
      summary: fields.summary || "",
      locationLabel: fields.locationLabel || "",
      beneficiary: fields.beneficiary || "",
      organizationType: fields.organizationType || "",
      foundedYear: fields.foundedYear || "",
      website: fields.website || "",
      instagram: fields.instagram || "",
      facebook: fields.facebook || "",
      twitter: fields.twitter || "",
      linkedin: fields.linkedin || "",
      organizationBio: fields.organizationBio || "",
      useOfFunds: fields.useOfFunds || "",
      proofLinks,
      coverImageCid: coverImageUpload?.cid || null,
      coverImageUrl: coverImageUpload?.url || null,
      galleryImages: galleryUploads,
      creatorProfile,
    };

    const result = await pinata.pinJSONToIPFS(profile, {
      pinataMetadata: {
        name: `${fields.title || "campaign"}-profile`,
      },
    });

    try {
      saveCampaignProfileToStore(result.IpfsHash, profile);
    } catch {
      // Local cache is best-effort only.
    }

    return res.status(200).json({
      cid: result.IpfsHash,
      uri: `ipfs://${result.IpfsHash}`,
      profile: { ...profile },
    });
  } catch (err) {
    console.error("Campaign profile upload error:", err.message);
    return res.status(500).json({ error: "Failed to upload campaign profile: " + err.message });
  } finally {
    cleanupFiles([
      ...(Array.isArray(parsedFiles?.coverImage) ? parsedFiles.coverImage : parsedFiles?.coverImage ? [parsedFiles.coverImage] : []),
      ...(Array.isArray(parsedFiles?.galleryImages) ? parsedFiles.galleryImages : parsedFiles?.galleryImages ? [parsedFiles.galleryImages] : []),
    ]);
  }
};
