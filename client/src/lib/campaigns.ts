export const CAMPAIGN_CATEGORIES = [
  "Education",
  "Water",
  "Healthcare",
  "Infrastructure",
  "Climate",
  "Food Security",
  "Livelihoods",
  "Disaster Relief",
  "Others",
] as const;

export type CampaignCategory = (typeof CAMPAIGN_CATEGORIES)[number];

const CATEGORY_PREFIX = "[Category:";
const LEGACY_CATEGORIES_PREFIX = "[Categories:";

function matchKnownCategory(value: string | null | undefined): CampaignCategory | null {
  if (!value) return null;

  const matchedCategory = CAMPAIGN_CATEGORIES.find(
    (entry) => entry.toLowerCase() === value.trim().toLowerCase()
  );

  return matchedCategory ?? "Others";
}

export function normalizeCampaignCategory(value: unknown): CampaignCategory | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const matchedCategory = matchKnownCategory(String(entry || ""));
      if (matchedCategory) {
        return matchedCategory;
      }
    }

    return null;
  }

  if (typeof value === "string") {
    const firstCandidate = value.split(/\r?\n|,/).map((entry) => entry.trim()).find(Boolean);
    return matchKnownCategory(firstCandidate);
  }

  return null;
}

export function normalizeCampaignCategories(value: unknown): CampaignCategory[] {
  const category = normalizeCampaignCategory(value);
  return category ? [category] : [];
}

export function serializeCampaignDescription(description: string, category: CampaignCategory | null) {
  const normalizedCategory = normalizeCampaignCategory(category);
  if (!normalizedCategory) {
    return description.trim();
  }

  return `${CATEGORY_PREFIX} ${normalizedCategory}]\n\n${description.trim()}`;
}

export function parseCampaignDescription(rawDescription: string): {
  category: CampaignCategory | null;
  description: string;
} {
  const prefix = rawDescription.startsWith(CATEGORY_PREFIX)
    ? CATEGORY_PREFIX
    : rawDescription.startsWith(LEGACY_CATEGORIES_PREFIX)
      ? LEGACY_CATEGORIES_PREFIX
      : null;

  if (!prefix) {
    return {
      category: null,
      description: rawDescription,
    };
  }

  const closingBracketIndex = rawDescription.indexOf("]");
  if (closingBracketIndex === -1) {
    return {
      category: null,
      description: rawDescription,
    };
  }

  const category = normalizeCampaignCategory(
    rawDescription.slice(prefix.length, closingBracketIndex).trim()
  );

  return {
    category,
    description: rawDescription.slice(closingBracketIndex + 1).trim(),
  };
}
