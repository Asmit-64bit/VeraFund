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

const CATEGORIES_PREFIX = "[Categories:";
const LEGACY_CATEGORY_PREFIX = "[Category:";

function matchKnownCategory(value: string | null | undefined): CampaignCategory | null {
  if (!value) return null;

  const matchedCategory = CAMPAIGN_CATEGORIES.find(
    (entry) => entry.toLowerCase() === value.trim().toLowerCase()
  );

  return matchedCategory ?? "Others";
}

export function normalizeCampaignCategories(value: unknown): CampaignCategory[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((entry) => matchKnownCategory(String(entry || ""))).filter(Boolean))
    ).slice(0, 2) as CampaignCategory[];
  }

  if (typeof value === "string") {
    const categories = value
      .split(/\r?\n|,/)
      .map((entry) => matchKnownCategory(entry))
      .filter(Boolean);

    return Array.from(new Set(categories)).slice(0, 2) as CampaignCategory[];
  }

  return [];
}

export function serializeCampaignDescription(
  description: string,
  categories: CampaignCategory[]
): string {
  const normalizedCategories = normalizeCampaignCategories(categories);
  if (normalizedCategories.length === 0) {
    return description.trim();
  }

  return `${CATEGORIES_PREFIX} ${normalizedCategories.join(", ")}]\n\n${description.trim()}`;
}

export function parseCampaignDescription(rawDescription: string): {
  categories: CampaignCategory[];
  category: CampaignCategory | null;
  description: string;
} {
  const prefix = rawDescription.startsWith(CATEGORIES_PREFIX)
    ? CATEGORIES_PREFIX
    : rawDescription.startsWith(LEGACY_CATEGORY_PREFIX)
      ? LEGACY_CATEGORY_PREFIX
      : null;

  if (!prefix) {
    return {
      categories: [],
      category: null,
      description: rawDescription,
    };
  }

  const closingBracketIndex = rawDescription.indexOf("]");
  if (closingBracketIndex === -1) {
    return {
      categories: [],
      category: null,
      description: rawDescription,
    };
  }

  const candidateCategory = rawDescription
    .slice(prefix.length, closingBracketIndex)
    .trim();
  const categories = normalizeCampaignCategories(candidateCategory);

  return {
    categories,
    category: categories[0] ?? null,
    description: rawDescription.slice(closingBracketIndex + 1).trim(),
  };
}

export function normalizeCampaignCategory(value: string | null | undefined): CampaignCategory | null {
  return normalizeCampaignCategories(value)[0] || null;
}
