import { normalizeCampaignCategories } from "./campaigns";
import type { CampaignProfile, CreatorProfile } from "../types";

const PROFILE_CID_MARKER = "[PROFILE_CID:";
const CREATOR_PROFILE_STORAGE_PREFIX = "verafund:creator-profile:";
const CAMPAIGN_PROFILE_STORAGE_PREFIX = "verafund:campaign-profile:";
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://w3s.link/ipfs/",
] as const;
const IPFS_FETCH_TIMEOUT_MS = 1800;
const profileCache = new Map<string, CampaignProfile>();
const MEDIA_PROXY_PATH = "/api/ipfs-asset";

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function firstSuccessful<T>(tasks: Array<() => Promise<T>>) {
  const errors: unknown[] = [];

  for (const task of tasks) {
    try {
      return await task();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors[0] instanceof Error) {
    throw errors[0];
  }

  throw new Error("All attempts failed");
}

export function attachProfileCidToDescription(description: string, profileCid: string | null) {
  const cleanDescription = stripProfileCidFromDescription(description).trim();

  if (!profileCid) {
    return cleanDescription;
  }

  return `${cleanDescription}\n\n${PROFILE_CID_MARKER}${profileCid}]`;
}

export function extractProfileCid(rawDescription: string) {
  const match = rawDescription.match(/\[PROFILE_CID:([^\]]+)\]/i);
  return match?.[1]?.trim() || null;
}

export function stripProfileCidFromDescription(rawDescription: string) {
  return rawDescription.replace(/\n?\n?\[PROFILE_CID:[^\]]+\]/i, "").trim();
}

export function getIpfsUrls(cid: string) {
  return IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
}

function getIpfsPath(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("ipfs://")) {
    return trimmed.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
  }

  const match = trimmed.match(/\/ipfs\/(.+)$/i);
  return match?.[1] || null;
}

export function getIpfsPathFromValue(value: string | null | undefined) {
  return getIpfsPath(value);
}

export function getMediaProxyUrl(value: string | null | undefined, cid?: string | null) {
  const ipfsPath = cid || getIpfsPath(value);
  if (!ipfsPath) {
    return value || null;
  }

  return `${MEDIA_PROXY_PATH}?cid=${encodeURIComponent(ipfsPath)}`;
}

export function getIpfsAssetUrls(value: string | null | undefined) {
  const ipfsPath = getIpfsPath(value);
  if (!ipfsPath) {
    return value ? [value] : [];
  }

  return IPFS_GATEWAYS.map((gateway) => `${gateway}${ipfsPath}`);
}

export function normalizeIpfsAssetUrl(value: string | null | undefined) {
  return getIpfsAssetUrls(value)[0] || null;
}

function getCampaignProfileStorageKey(profileCid: string) {
  return `${CAMPAIGN_PROFILE_STORAGE_PREFIX}${profileCid}`;
}

function loadCachedCampaignProfile(profileCid: string) {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(getCampaignProfileStorageKey(profileCid));
    if (!stored) return null;
    return JSON.parse(stored) as CampaignProfile;
  } catch {
    return null;
  }
}

function persistCampaignProfile(profileCid: string, profile: CampaignProfile) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getCampaignProfileStorageKey(profileCid), JSON.stringify(profile));
  } catch {
    // Ignore storage quota failures. The app can still rely on the in-memory cache.
  }
}

/** Safely coerce a value that might be a string or a single-element array into a plain string. */
function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value ? String(value) : "";
}

export function normalizeCampaignProfile(
  profile: CampaignProfile | null | undefined
): CampaignProfile | null {
  if (!profile) return null;

  const creatorProfile = profile.creatorProfile || null;
  const categories = normalizeCampaignCategories(profile.categories ?? profile.category);

  return {
    ...profile,
    categories,
    category: categories[0] || "",
    summary: coerceString(profile.summary),
    locationLabel: coerceString(profile.locationLabel),
    beneficiary: coerceString(profile.beneficiary),
    organizationType: coerceString(profile.organizationType),
    foundedYear: coerceString(profile.foundedYear),
    website: coerceString(profile.website),
    instagram: coerceString(profile.instagram),
    facebook: coerceString(profile.facebook),
    twitter: coerceString(profile.twitter),
    linkedin: coerceString(profile.linkedin),
    organizationBio: coerceString(profile.organizationBio),
    useOfFunds: coerceString(profile.useOfFunds),
    proofLinks: normalizeStringList(profile.proofLinks),
    coverImageCid: profile.coverImageCid || getIpfsPath(profile.coverImageUrl) || null,
    coverImageUrl: getMediaProxyUrl(profile.coverImageUrl, profile.coverImageCid),
    coverImageDataUrl: profile.coverImageDataUrl || null,
    galleryImages: Array.isArray(profile.galleryImages)
      ? profile.galleryImages
          .map((image) => ({
            cid: image?.cid || getIpfsPath(image?.url) || null,
            url: getMediaProxyUrl(image?.url, image?.cid || null),
            alt: image?.alt || null,
          }))
          .filter((image) => image.cid || image.url)
      : [],
    creatorProfile: creatorProfile
      ? {
          displayName: coerceString(creatorProfile.displayName).trim(),
          roleTitle: coerceString(creatorProfile.roleTitle).trim(),
          location: coerceString(creatorProfile.location).trim(),
          aboutMe: coerceString(creatorProfile.aboutMe).trim(),
          causes: normalizeStringList(creatorProfile.causes),
          associatedOrganizations: normalizeStringList(creatorProfile.associatedOrganizations),
          website: creatorProfile.website || "",
          instagram: creatorProfile.instagram || "",
          facebook: creatorProfile.facebook || "",
          twitter: creatorProfile.twitter || "",
          linkedin: creatorProfile.linkedin || "",
          profileImageUrl: normalizeIpfsAssetUrl(creatorProfile.profileImageUrl),
          profileImageDataUrl: creatorProfile.profileImageDataUrl || null,
        }
      : null,
  };
}

export function cacheCampaignProfile(profileCid: string | null | undefined, profile: CampaignProfile | null | undefined) {
  if (!profileCid) return null;

  const normalized = normalizeCampaignProfile(profile);
  if (!normalized) return null;

  profileCache.set(profileCid, normalized);
  persistCampaignProfile(profileCid, normalized);
  return normalized;
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchCampaignProfile(profileCid: string) {
  if (profileCache.has(profileCid)) {
    return profileCache.get(profileCid)!;
  }

  const cachedProfile = loadCachedCampaignProfile(profileCid);
  if (cachedProfile) {
    const normalized = normalizeCampaignProfile(cachedProfile);
    if (normalized) {
      profileCache.set(profileCid, normalized);
      return normalized;
    }
  }

  let lastStatus = 0;
  const profileUrls = [
    `${MEDIA_PROXY_PATH}?cid=${encodeURIComponent(profileCid)}`,
    ...getIpfsUrls(profileCid),
  ];

  const data = await firstSuccessful(
    profileUrls.map((url) => async () => {
      const response = await fetchJsonWithTimeout(url).catch(() => null);
      if (!response) {
        throw new Error("Campaign profile fetch timed out");
      }

      if (!response.ok) {
        lastStatus = response.status;
        throw new Error(`Campaign profile fetch failed with HTTP ${response.status}`);
      }

      const payload = normalizeCampaignProfile((await response.json()) as CampaignProfile);
      if (!payload) {
        throw new Error("Campaign profile payload missing");
      }

      return payload;
    })
  ).catch(() => null);

  if (data) {
    cacheCampaignProfile(profileCid, data);
    return data;
  }

  throw new Error(`Failed to fetch campaign profile: HTTP ${lastStatus || 0}`);
}

export function normalizeOptionalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getCreatorProfileStorageKey(account: string) {
  return `${CREATOR_PROFILE_STORAGE_PREFIX}${account.toLowerCase()}`;
}

export function loadCreatorProfileDraft(account: string | null) {
  if (!account || typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(getCreatorProfileStorageKey(account));
    if (!stored) return null;
    return JSON.parse(stored) as CreatorProfile;
  } catch {
    return null;
  }
}

export function saveCreatorProfileDraft(account: string | null, profile: CreatorProfile) {
  if (!account || typeof window === "undefined") return;
  window.localStorage.setItem(getCreatorProfileStorageKey(account), JSON.stringify(profile));
}

export async function resizeProfileImage(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });

  const maxSize = 320;
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare image canvas");
  }

  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

export function trySaveCreatorProfileDraft(account: string | null, profile: CreatorProfile) {
  if (!account || typeof window === "undefined") return false;

  try {
    saveCreatorProfileDraft(account, profile);
    return true;
  } catch {
    return false;
  }
}

export function splitLinesToList(value: string) {
  return normalizeStringList(value);
}

export function joinListToMultiline(values?: string[] | string | null) {
  return normalizeStringList(values).join("\n");
}

export function sanitizeCreatorProfile(profile: CreatorProfile) {
  const normalizedLinks = {
    website: normalizeOptionalUrl(profile.website || ""),
    instagram: normalizeOptionalUrl(profile.instagram || ""),
    facebook: normalizeOptionalUrl(profile.facebook || ""),
    twitter: normalizeOptionalUrl(profile.twitter || ""),
    linkedin: normalizeOptionalUrl(profile.linkedin || ""),
  };

  return {
    displayName: profile.displayName?.trim() || "",
    roleTitle: profile.roleTitle?.trim() || "",
    location: profile.location?.trim() || "",
    aboutMe: profile.aboutMe?.trim() || "",
    causes: normalizeStringList(profile.causes),
    associatedOrganizations: normalizeStringList(profile.associatedOrganizations),
    ...normalizedLinks,
    profileImageUrl: profile.profileImageUrl || null,
    profileImageDataUrl: profile.profileImageDataUrl || null,
  } satisfies CreatorProfile;
}

export function getCreatorProfileCompletion(profile: CreatorProfile | null | undefined) {
  if (!profile) return { isComplete: false, missing: ["displayName", "aboutMe", "causes"] };

  const sanitized = sanitizeCreatorProfile(profile);
  const missing = [
    !sanitized.displayName && "displayName",
    !sanitized.aboutMe && "aboutMe",
    !(sanitized.causes && sanitized.causes.length > 0) && "causes",
  ].filter(Boolean) as string[];

  return {
    isComplete: missing.length === 0,
    missing,
    profile: sanitized,
  };
}

export function getSatelliteViewUrl(latitude?: number | string, longitude?: number | string) {
  if (latitude === undefined || longitude === undefined || latitude === "" || longitude === "") {
    return "";
  }

  return `https://www.google.com/maps?q=${latitude},${longitude}&t=k`;
}
