const exifr = require("exifr");
const crypto = require("crypto");

const SUSPICIOUS_SOFTWARE_PATTERNS = [
  /photoshop/i,
  /lightroom/i,
  /midjourney/i,
  /stable diffusion/i,
  /\bgpt\b/i,
  /dall-e/i,
  /firefly/i,
  /canva/i,
  /pixelmator/i,
  /gimp/i,
];

const PROVENANCE_MARKERS = [
  { label: "C2PA manifest", pattern: /c2pa/i },
  { label: "Content Credentials", pattern: /content credentials/i },
  { label: "SynthID marker", pattern: /synthid/i },
  { label: "DigitalSourceType", pattern: /digitalsourcetype/i },
  { label: "Extended XMP", pattern: /xmpnote:hasextendedxmp/i },
];
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://w3s.link/ipfs/",
];
const NETWORK_TIMEOUT_MS = 9000;
const STALE_CAPTURE_HOURS = 24 * 21;
const VERY_STALE_CAPTURE_HOURS = 24 * 45;

function buildMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function buildSatelliteUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}&t=k`;
}

function buildProofCode(campaignAddress, milestoneId, when = new Date()) {
  const utcDate = when.toISOString().slice(0, 10).replace(/-/g, "");
  const compactAddress = String(campaignAddress || "")
    .replace(/^0x/i, "")
    .slice(0, 6)
    .toUpperCase();
  return `VERA-${compactAddress}-M${milestoneId}-${utcDate}`;
}

function toMarkerWords(value, maxWords = 4) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, maxWords);
}

function buildProofMarker(campaignAddress, milestoneId, milestoneTitle, when = new Date()) {
  const utcDate = when.toISOString().slice(0, 10).replace(/-/g, "");
  const compactAddress = String(campaignAddress || "")
    .replace(/^0x/i, "")
    .slice(0, 6)
    .toUpperCase();
  const titleMarker = toMarkerWords(milestoneTitle, 4).join(" ");
  return `VERAFUND ${compactAddress} M${milestoneId} ${titleMarker} ${utcDate}`.trim();
}

function normalizeProofCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function assessCaptureTiming(capturedAt) {
  if (!capturedAt) {
    return {
      status: "Missing",
      ageHours: null,
      notes: ["Original capture timestamp missing from image metadata"],
    };
  }

  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.getTime())) {
    return {
      status: "Invalid",
      ageHours: null,
      notes: ["Original capture timestamp could not be parsed"],
    };
  }

  const ageHours = (Date.now() - capturedDate.getTime()) / 36e5;

  if (ageHours < -3) {
    return {
      status: "Future",
      ageHours: Number(ageHours.toFixed(1)),
      notes: ["Image metadata says the photo was captured in the future"],
    };
  }

  if (ageHours > VERY_STALE_CAPTURE_HOURS) {
    return {
      status: "VeryStale",
      ageHours: Number(ageHours.toFixed(1)),
      notes: ["Photo appears much older than a normal live milestone update"],
    };
  }

  if (ageHours > STALE_CAPTURE_HOURS) {
    return {
      status: "Stale",
      ageHours: Number(ageHours.toFixed(1)),
      notes: ["Photo was not captured recently relative to submission time"],
    };
  }

  return {
    status: "Fresh",
    ageHours: Number(ageHours.toFixed(1)),
    notes: [],
  };
}

function getIpfsUrls(cid) {
  return IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
}

async function fetchIpfsBuffer(cid) {
  let lastError = null;

  for (const url of getIpfsUrls(cid)) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, contentType, url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Failed to fetch CID ${cid}`);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchIpfsImageContent(cid) {
  const { buffer, contentType } = await fetchIpfsBuffer(cid);
  return {
    type: "image_url",
    image_url: {
      url: `data:${contentType};base64,${buffer.toString("base64")}`,
    },
  };
}

function tokenizeLocation(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !["road", "district", "state", "city", "village"].includes(token));
}

function compareLocationLabels(claimedLabel, resolvedLabel) {
  const claimedTokens = tokenizeLocation(claimedLabel);
  const resolvedTokens = new Set(tokenizeLocation(resolvedLabel));

  if (claimedTokens.length === 0 || resolvedTokens.size === 0) {
    return {
      matched: null,
      confidence: 0,
      matchedTokens: [],
    };
  }

  const matchedTokens = claimedTokens.filter((token) => resolvedTokens.has(token));
  const confidence = Math.round((matchedTokens.length / claimedTokens.length) * 100);

  return {
    matched: matchedTokens.length > 0,
    confidence,
    matchedTokens,
  };
}

async function reverseGeocodeCoordinates(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "14");
  url.searchParams.set("addressdetails", "1");

  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "VeraFund/1.0 geospatial-check",
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null);
  if (!data) return null;

  const address = data.address || {};
  const localityParts = [
    address.suburb,
    address.village,
    address.town,
    address.city,
    address.county,
    address.state_district,
    address.state,
    address.country,
  ].filter(Boolean);

  return {
    displayName: data.display_name || localityParts.join(", ") || null,
    localityLabel: localityParts.join(", ") || null,
  };
}

function normalizeCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeClaimedLocation(input = {}) {
  const latitude = normalizeCoordinate(input.claimedLatitude);
  const longitude = normalizeCoordinate(input.claimedLongitude);
  const label = typeof input.claimedLocationLabel === "string" ? input.claimedLocationLabel.trim() : "";

  if (latitude === null || longitude === null) {
    return label ? { label } : null;
  }

  return {
    label: label || "Claimed project location",
    latitude,
    longitude,
    googleMapsUrl: buildMapsUrl(latitude, longitude),
    satelliteViewUrl: buildSatelliteUrl(latitude, longitude),
  };
}

function haversineDistanceKm(start, end) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const deltaLat = toRadians(end.latitude - start.latitude);
  const deltaLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function extractEvidenceMetadata(filePath, fileName, claimedLocation) {
  const parsed = await exifr.parse(filePath, { xmp: true, icc: true }).catch(() => null);
  const gps = parsed?.latitude && parsed?.longitude
    ? { latitude: parsed.latitude, longitude: parsed.longitude }
    : await exifr.gps(filePath).catch(() => null);
  const fileBuffer = await require("fs").promises.readFile(filePath);
  const bufferText = fileBuffer.toString("latin1");
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const provenanceMarkers = PROVENANCE_MARKERS
    .filter((marker) => marker.pattern.test(bufferText))
    .map((marker) => marker.label);
  const suspiciousSoftware = typeof parsed?.Software === "string" &&
    SUSPICIOUS_SOFTWARE_PATTERNS.some((pattern) => pattern.test(parsed.Software));

  const metadata = {
    fileName,
    location: null,
    comparison: null,
    authenticity: {
      sha256,
      capturedAt: parsed?.DateTimeOriginal?.toISOString?.() || parsed?.CreateDate?.toISOString?.() || null,
      cameraMake: parsed?.Make || null,
      cameraModel: parsed?.Model || null,
      software: parsed?.Software || null,
      hasGps: Boolean(gps?.latitude && gps?.longitude),
      hasCameraMetadata: Boolean(parsed?.Make || parsed?.Model),
      provenanceMarkers,
      suspiciousFlags: suspiciousSoftware ? ["Editing or generative software tag detected"] : [],
      aiGeneratedScore: null,
      aiGeneratedLabel: null,
      reverseImageMatches: [],
      reverseImageMatched: false,
      reverseImageSource: null,
      syntheticWatermarkHints: provenanceMarkers.filter((marker) => /SynthID|Content Credentials|C2PA/i.test(marker)),
      captureTiming: null,
      geospatial: null,
      failureReasons: [],
      passed: true,
    },
  };

  const captureTiming = assessCaptureTiming(metadata.authenticity.capturedAt);
  metadata.authenticity.captureTiming = captureTiming;

  if (captureTiming.notes.length > 0) {
    metadata.authenticity.failureReasons.push(...captureTiming.notes);
  }

  if (!gps?.latitude || !gps?.longitude) {
    metadata.authenticity.failureReasons.push("Missing GPS EXIF data");
  } else {
    const reverseGeocode = await reverseGeocodeCoordinates(gps.latitude, gps.longitude);
    metadata.location = {
      latitude: gps.latitude,
      longitude: gps.longitude,
      googleMapsUrl: buildMapsUrl(gps.latitude, gps.longitude),
      satelliteViewUrl: buildSatelliteUrl(gps.latitude, gps.longitude),
      localityLabel: reverseGeocode?.localityLabel || reverseGeocode?.displayName || null,
    };

    if (reverseGeocode) {
      const labelComparison = compareLocationLabels(claimedLocation?.label, reverseGeocode.localityLabel || reverseGeocode.displayName);
      metadata.authenticity.geospatial = {
        reverseGeocodedLabel: reverseGeocode.localityLabel || reverseGeocode.displayName,
        localityMatch: labelComparison.matched,
        localityConfidence: labelComparison.confidence,
        matchedTokens: labelComparison.matchedTokens,
      };

      if (claimedLocation?.label && labelComparison.matched === false) {
        metadata.authenticity.failureReasons.push("Reverse-geocoded locality does not match the claimed place name");
      }
    }
  }

  if (
    gps?.latitude &&
    gps?.longitude &&
    claimedLocation?.latitude !== undefined &&
    claimedLocation?.longitude !== undefined
  ) {
    metadata.comparison = {
      claimedLocation,
      distanceKm: Number(
        haversineDistanceKm(
          { latitude: gps.latitude, longitude: gps.longitude },
          claimedLocation
        ).toFixed(2)
      ),
    };

    if (metadata.comparison.distanceKm > 2) {
      metadata.authenticity.failureReasons.push(
        `GPS is ${metadata.comparison.distanceKm} km away from the claimed location`
      );
    }
  } else if (claimedLocation?.latitude !== undefined && claimedLocation?.longitude !== undefined) {
    metadata.comparison = {
      claimedLocation,
      distanceKm: null,
    };
  }

  if (!metadata.authenticity.hasCameraMetadata) {
    metadata.authenticity.failureReasons.push("Camera make/model metadata missing");
  }

  if (suspiciousSoftware) {
    metadata.authenticity.failureReasons.push("Image metadata shows editing or generative software");
  }

  metadata.authenticity.passed = metadata.authenticity.failureReasons.length === 0;
  return metadata;
}

async function detectAiGeneratedImage(fileBuffer, fileName) {
  if (!process.env.SIGHTENGINE_API_USER || !process.env.SIGHTENGINE_API_SECRET) {
    return null;
  }

  const formData = new FormData();
  formData.append("media", new Blob([fileBuffer]), fileName || "evidence.jpg");
  formData.append("models", "genai");
  formData.append("api_user", process.env.SIGHTENGINE_API_USER);
  formData.append("api_secret", process.env.SIGHTENGINE_API_SECRET);

  const response = await fetchWithTimeout("https://api.sightengine.com/1.0/check.json", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Sightengine error: HTTP ${response.status}`);
  }

  const result = await response.json();
  const aiGeneratedScore = Number(result?.type?.ai_generated ?? 0);

  return {
    provider: "Sightengine",
    score: aiGeneratedScore,
    flagged: aiGeneratedScore >= 0.65,
  };
}

async function reverseImageLookup({ imageBase64, fileName, sha256 }) {
  const reverseImageApiUrl = process.env.REVERSE_IMAGE_SEARCH_API_URL;
  if (!reverseImageApiUrl) {
    return null;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  const authHeaderName = process.env.REVERSE_IMAGE_SEARCH_API_KEY_HEADER || "Authorization";
  if (process.env.REVERSE_IMAGE_SEARCH_API_KEY) {
    headers[authHeaderName] = authHeaderName.toLowerCase() === "authorization"
      ? `Bearer ${process.env.REVERSE_IMAGE_SEARCH_API_KEY}`
      : process.env.REVERSE_IMAGE_SEARCH_API_KEY;
  }

  const response = await fetchWithTimeout(reverseImageApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      imageBase64,
      fileName,
      sha256,
    }),
  });

  if (!response.ok) {
    throw new Error(`Reverse image API error: HTTP ${response.status}`);
  }

  const data = await response.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  return {
    provider: data?.provider || "Configured reverse image provider",
    matched: Boolean(data?.matched ?? matches.length > 0),
    matches: matches.slice(0, 5),
  };
}

async function enrichAuthenticityChecks(upload) {
  if (!upload?.authenticity?.sha256 || !upload.__fileBuffer) {
    return upload;
  }

  const fileBuffer = upload.__fileBuffer;
  const aiCheck = await detectAiGeneratedImage(fileBuffer, upload.fileName).catch(() => null);
  const reverseLookup = await reverseImageLookup({
    imageBase64: fileBuffer.toString("base64"),
    fileName: upload.fileName,
    sha256: upload.authenticity.sha256,
  }).catch(() => null);

  if (aiCheck) {
    upload.authenticity.aiGeneratedScore = aiCheck.score;
    upload.authenticity.aiGeneratedLabel = aiCheck.provider;
    if (aiCheck.flagged) {
      upload.authenticity.failureReasons.push(`AI-generated image score is high (${aiCheck.score.toFixed(2)})`);
    }
  }

  if (reverseLookup) {
    upload.authenticity.reverseImageMatched = reverseLookup.matched;
    upload.authenticity.reverseImageSource = reverseLookup.provider;
    upload.authenticity.reverseImageMatches = reverseLookup.matches;
    if (reverseLookup.matched) {
      upload.authenticity.failureReasons.push("Reverse image search found public web matches");
    }
  }

  upload.authenticity.passed = upload.authenticity.failureReasons.length === 0;
  delete upload.__fileBuffer;
  return upload;
}

function summarizeAuthenticityChecks(uploads) {
  const allUploads = Array.isArray(uploads) ? uploads : [];
  const failedUploads = allUploads.filter((upload) => upload?.authenticity?.failureReasons?.length);
  const exactDuplicateHashes = new Set();
  const duplicateHashes = new Set();
  const staleTimingUploads = allUploads.filter((upload) => {
    const status = upload?.authenticity?.captureTiming?.status;
    return status === "Stale" || status === "VeryStale" || status === "Future";
  });

  for (const upload of allUploads) {
    const sha = upload?.authenticity?.sha256;
    if (!sha) continue;
    if (exactDuplicateHashes.has(sha)) {
      duplicateHashes.add(sha);
    } else {
      exactDuplicateHashes.add(sha);
    }
  }

  return {
    passed: failedUploads.length === 0 && duplicateHashes.size === 0,
    duplicateCount: duplicateHashes.size,
    staleTimingCount: staleTimingUploads.length,
    failedUploads: failedUploads.map((upload) => ({
      fileName: upload.fileName,
      reasons: upload.authenticity.failureReasons,
    })),
    notes: [
      duplicateHashes.size > 0 ? "Exact duplicate file hashes were found in the submission." : null,
      staleTimingUploads.length > 0 ? "Some photos appear stale relative to the submission time." : null,
      ...failedUploads.flatMap((upload) =>
        upload.authenticity.failureReasons.map((reason) => `${upload.fileName}: ${reason}`)
      ),
    ].filter(Boolean),
  };
}

function summarizeGeospatialChecks(uploads, claimedLocation) {
  const allUploads = Array.isArray(uploads) ? uploads : [];
  const gpsUploads = allUploads.filter((upload) => upload?.location);
  const distanceValues = gpsUploads
    .map((upload) => upload?.comparison?.distanceKm)
    .filter((value) => typeof value === "number");
  const localityMismatches = gpsUploads.filter(
    (upload) => upload?.authenticity?.geospatial?.localityMatch === false
  ).length;

  return {
    hasClaimedCoordinates: Boolean(claimedLocation?.latitude !== undefined && claimedLocation?.longitude !== undefined),
    gpsImageCount: gpsUploads.length,
    averageDistanceKm: distanceValues.length
      ? Number((distanceValues.reduce((sum, value) => sum + value, 0) / distanceValues.length).toFixed(2))
      : null,
    localityMismatchCount: localityMismatches,
  };
}

function summarizeCampaignBindingChecks({
  proofCode,
  proofMarker,
  bindingReview,
  previousMilestoneMatches,
}) {
  const normalizedProofCode = normalizeProofCode(proofCode);
  const normalizedProofMarker = String(proofMarker || "").trim().toUpperCase() || null;
  const review = bindingReview || null;
  const notes = [];

  if (normalizedProofCode) {
    notes.push(`Expected proof code: ${normalizedProofCode}`);
  }

  if (normalizedProofMarker) {
    notes.push(`Expected milestone marker: ${normalizedProofMarker}`);
  }

  if (review?.summary) {
    notes.push(review.summary);
  }

  if ((previousMilestoneMatches || []).length > 0) {
    notes.push("One or more submitted images exactly match evidence from an earlier milestone.");
  }

  const status = review?.status || "Insufficient";
  const passed =
    ["Present", "Partial"].includes(status) &&
    (previousMilestoneMatches || []).length === 0;

  return {
    passed,
    status,
    proofCode: normalizedProofCode || null,
    proofMarker: normalizedProofMarker,
    notes,
    previousMilestoneMatches: previousMilestoneMatches || [],
  };
}

module.exports = {
  assessCaptureTiming,
  buildProofCode,
  buildProofMarker,
  extractEvidenceMetadata,
  fetchIpfsBuffer,
  fetchIpfsImageContent,
  getIpfsUrls,
  enrichAuthenticityChecks,
  normalizeClaimedLocation,
  summarizeAuthenticityChecks,
  summarizeCampaignBindingChecks,
  summarizeGeospatialChecks,
};
