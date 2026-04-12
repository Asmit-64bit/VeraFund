import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  API_BASE,
  FACTORY_ADDRESS,
  FACTORY_ABI,
  CAMPAIGN_ABI,
  READONLY_FACTORY_ADDRESSES,
  READONLY_SEPOLIA_RPCS,
  SEPOLIA_CHAIN_ID,
} from "../constants";
import type { CampaignInfo, MilestoneInfo } from "../types";
import {
  cacheCampaignProfile,
  extractProfileCid,
  fetchCampaignProfile,
  normalizeCampaignProfile,
  stripProfileCidFromDescription,
} from "../lib/campaignProfile";

type AnyProvider =
  | ethers.BrowserProvider
  | ethers.JsonRpcProvider
  | ethers.FallbackProvider
  | null;

const READ_TIMEOUT_MS = 2800;
const READONLY_PROVIDERS = READONLY_SEPOLIA_RPCS.map(
  (url) =>
    new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: ethers.Network.from(SEPOLIA_CHAIN_ID),
    })
);

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

async function fetchJsonWithTimeout(url: string, label: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(new Error(`${label} timed out`)),
    READ_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, { signal: controller.signal }).catch(() => null);
    if (!response?.ok) return null;
    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label} timed out`)), READ_TIMEOUT_MS)
    ),
  ]);
}

function getReadableContractError(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("CALL_EXCEPTION") || message.includes("missing revert data")) {
    return fallback;
  }

  return message || fallback;
}

function parseMilestoneResponse(rawMilestone: {
  id: number;
  title: string;
  description: string;
  fundPercent: number;
  deadline: number;
  status: number;
  ipfsHash: string;
  votingDeadline: number;
  votesFor: string;
  votesAgainst: string;
  resolvedByAI: boolean;
  aiScore: number;
}): MilestoneInfo {
  return {
    id: Number(rawMilestone.id),
    title: rawMilestone.title,
    description: rawMilestone.description,
    fundPercent: Number(rawMilestone.fundPercent),
    deadline: Number(rawMilestone.deadline),
    status: Number(rawMilestone.status),
    ipfsHash: rawMilestone.ipfsHash,
    votingDeadline: Number(rawMilestone.votingDeadline),
    votesFor: BigInt(rawMilestone.votesFor),
    votesAgainst: BigInt(rawMilestone.votesAgainst),
    resolvedByAI: Boolean(rawMilestone.resolvedByAI),
    aiScore: Number(rawMilestone.aiScore),
  };
}

function parseCampaignResponse(rawCampaign: {
  address: string;
  factoryAddress?: string | null;
  ngoAddress: string;
  title: string;
  description: string;
  profileCid?: string | null;
  profile?: CampaignInfo["profile"];
  ngoName: string;
  goalAmount: string;
  raisedAmount: string;
  campaignDeadline: number;
  bootstrapPercent: number;
  status: number;
  milestoneCount: number;
  bootstrapReleased?: boolean;
  userDonation?: string;
}): CampaignInfo {
  const profileCid = rawCampaign.profileCid || null;

  return {
    address: rawCampaign.address,
    factoryAddress: rawCampaign.factoryAddress || null,
    ngoAddress: rawCampaign.ngoAddress,
    title: rawCampaign.title,
    description: rawCampaign.description,
    profileCid,
    profile: profileCid
      ? cacheCampaignProfile(profileCid, normalizeCampaignProfile(rawCampaign.profile || null))
      : normalizeCampaignProfile(rawCampaign.profile || null),
    ngoName: rawCampaign.ngoName,
    goalAmount: BigInt(rawCampaign.goalAmount),
    raisedAmount: BigInt(rawCampaign.raisedAmount),
    campaignDeadline: Number(rawCampaign.campaignDeadline),
    bootstrapPercent: Number(rawCampaign.bootstrapPercent),
    bootstrapReleased: Boolean(rawCampaign.bootstrapReleased),
    status: Number(rawCampaign.status),
    milestoneCount: Number(rawCampaign.milestoneCount),
    ...(rawCampaign.userDonation !== undefined
      ? { userDonation: BigInt(rawCampaign.userDonation) }
      : {}),
  };
}

async function hydrateCampaignResponse(rawCampaign: Parameters<typeof parseCampaignResponse>[0]) {
  const parsed = parseCampaignResponse(rawCampaign);

  const shouldHydrateProfile =
    !!parsed.profileCid &&
    (!parsed.profile ||
      (!parsed.profile.coverImageDataUrl &&
        !parsed.profile.coverImageUrl &&
        !parsed.profile.summary &&
        !parsed.profile.creatorProfile?.displayName));

  if (shouldHydrateProfile && parsed.profileCid) {
    parsed.profile = await fetchCampaignProfile(parsed.profileCid).catch(() => parsed.profile || null);
  }

  return parsed;
}

function getReadonlyCandidates(provider: AnyProvider) {
  if (
    !provider ||
    provider instanceof ethers.BrowserProvider ||
    provider instanceof ethers.FallbackProvider
  ) {
    return READONLY_PROVIDERS;
  }

  return [provider, ...READONLY_PROVIDERS.filter((candidate) => candidate !== provider)];
}

async function readWithFallback<T>(
  label: string,
  provider: AnyProvider,
  runner: (readProvider: ethers.AbstractProvider) => Promise<T>
): Promise<T> {
  const candidates = getReadonlyCandidates(provider);
  return firstSuccessful(
    candidates.map((candidate) => async () =>
      withTimeout(runner(candidate), label).catch((error) => {
        throw error instanceof Error ? error : new Error(`${label} failed`);
      })
    )
  );
}

function formatMilestone(
  milestone: {
    title: string;
    description: string;
    fundPercent: bigint | number;
    deadline: bigint | number;
    status: bigint | number;
    ipfsHash: string;
    votingDeadline: bigint | number;
    votesFor: bigint;
    votesAgainst: bigint;
    resolvedByAI: boolean;
    aiScore: bigint | number;
  },
  index: number
): MilestoneInfo {
  return {
    id: index,
    title: milestone.title,
    description: milestone.description,
    fundPercent: Number(milestone.fundPercent),
    deadline: Number(milestone.deadline),
    status: Number(milestone.status),
    ipfsHash: milestone.ipfsHash,
    votingDeadline: Number(milestone.votingDeadline),
    votesFor: milestone.votesFor,
    votesAgainst: milestone.votesAgainst,
    resolvedByAI: milestone.resolvedByAI,
    aiScore: Number(milestone.aiScore),
  };
}

async function loadMilestones(
  campaignAddress: string,
  provider: AnyProvider
): Promise<MilestoneInfo[]> {
  try {
    const allMilestones = await readWithFallback("Milestone fetch", provider, async (readProvider) => {
      const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, readProvider);
      return contract.getAllMilestones();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return allMilestones.map((milestone: any, index: number) => formatMilestone(milestone, index));
  } catch {
    const count = Number(
      await readWithFallback("Milestone count fetch", provider, async (readProvider) => {
        const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, readProvider);
        return contract.getMilestoneCount();
      }).catch(() => 0)
    );

    if (!count) return [];

    const milestoneCalls = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        readWithFallback(`Milestone ${index + 1} fetch`, provider, async (readProvider) => {
          const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, readProvider);
          return contract.getMilestone(index);
        }).catch(() => null)
      )
    );

    return milestoneCalls
      .map((milestone, index) => (milestone ? formatMilestone(milestone, index) : null))
      .filter((milestone): milestone is MilestoneInfo => Boolean(milestone));
  }
}

async function loadCampaignSnapshot(
  address: string,
  provider: AnyProvider,
  account?: string | null,
  factoryAddress?: string | null
): Promise<CampaignInfo> {
  const { info, donation } = await readWithFallback(
    account ? `Wallet campaign ${address.slice(0, 8)} fetch` : `Campaign ${address.slice(0, 8)} fetch`,
    provider,
    async (readProvider) => {
      const campaign = new ethers.Contract(address, CAMPAIGN_ABI, readProvider);
      const info = await campaign.getCampaign();

      const donation = account ? await campaign.getDonation(account) : undefined;

      return { info, donation };
    }
  );

  const bootstrapReleased = await readWithFallback(
    `Bootstrap state ${address.slice(0, 8)} fetch`,
    provider,
    async (readProvider) => {
      const campaign = new ethers.Contract(address, CAMPAIGN_ABI, readProvider);
      return campaign.bootstrapReleased();
    }
  ).catch(() => Number(info.status) !== 0);

  const profileCid = extractProfileCid(info.description);
  const profile = profileCid ? await fetchCampaignProfile(profileCid).catch(() => null) : null;

  return {
    address,
    factoryAddress: factoryAddress || null,
    ngoAddress: info.ngoAddress,
    title: info.title,
    description: stripProfileCidFromDescription(info.description),
    profileCid,
    profile,
    ngoName: info.ngoName,
    goalAmount: info.goalAmount,
    raisedAmount: info.raisedAmount,
    campaignDeadline: Number(info.campaignDeadline),
    bootstrapPercent: Number(info.bootstrapPercent),
    bootstrapReleased: Boolean(bootstrapReleased),
    status: Number(info.status),
    milestoneCount: Number(info.milestoneCount),
    ...(account ? { userDonation: donation as bigint } : {}),
  };
}

async function loadAllFactoryCampaignAddresses(
  provider: AnyProvider
): Promise<Array<{ address: string; factoryAddress: string }>> {
  const results = await Promise.allSettled(
    READONLY_FACTORY_ADDRESSES.map((factoryAddress) =>
      readWithFallback(`Campaign list fetch ${factoryAddress.slice(0, 8)}`, provider, async (readProvider) => {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, readProvider);
        const addresses = (await factory.getAllCampaigns()) as string[];
        return addresses.map((address) => ({ address, factoryAddress }));
      })
    )
  );

  const deduped = new Map<string, { address: string; factoryAddress: string }>();

  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((entry) => {
      if (!deduped.has(entry.address.toLowerCase())) {
        deduped.set(entry.address.toLowerCase(), entry);
      }
    });
  });

  return Array.from(deduped.values());
}

export function useAllCampaigns(provider: AnyProvider) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = await fetchJsonWithTimeout(`${API_BASE}/campaigns`, "Campaign API fetch");
      if (payload) {
        const hydratedCampaigns = await Promise.all(
          (payload.campaigns || []).map(hydrateCampaignResponse)
        );
        setCampaigns(hydratedCampaigns);
        setLoading(false);
        return;
      }

      const addresses = await loadAllFactoryCampaignAddresses(provider);

      const campaignResults = await Promise.allSettled(
        addresses.map((entry) =>
          loadCampaignSnapshot(entry.address, provider, undefined, entry.factoryAddress)
        )
      );

      const loadedCampaigns = campaignResults.reduce<CampaignInfo[]>((acc, result) => {
        if (result.status === "fulfilled") {
          acc.push(result.value);
        }

        return acc;
      }, []);

      setCampaigns(loadedCampaigns);
      if (addresses.length > 0 && loadedCampaigns.length === 0) {
        setError("Campaign data is temporarily unavailable. Please retry in a moment.");
      }
    } catch (err: unknown) {
      setCampaigns([]);
      setError(getReadableContractError(err, "Failed to load campaigns from Sepolia"));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}

export function useWalletCampaigns(provider: AnyProvider, account: string | null) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    if (!account) {
      setCampaigns([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await fetchJsonWithTimeout(
        `${API_BASE}/campaigns?account=${encodeURIComponent(account)}`,
        "Wallet campaign API fetch"
      );
      if (payload) {
        const hydratedCampaigns = await Promise.all(
          (payload.campaigns || []).map(hydrateCampaignResponse)
        );
        setCampaigns(hydratedCampaigns);
        setLoading(false);
        return;
      }

      const addresses = await loadAllFactoryCampaignAddresses(provider);

      const campaignResults = await Promise.allSettled(
        addresses.map((entry) =>
          loadCampaignSnapshot(entry.address, provider, account, entry.factoryAddress)
        )
      );

      const loadedCampaigns = campaignResults.reduce<CampaignInfo[]>((acc, result) => {
        if (result.status === "fulfilled") {
          acc.push(result.value);
        }

        return acc;
      }, []);

      setCampaigns(loadedCampaigns);
      if (addresses.length > 0 && loadedCampaigns.length === 0) {
        setError("Donation history is temporarily unavailable. Please retry in a moment.");
      }
    } catch (err: unknown) {
      setCampaigns([]);
      setError(getReadableContractError(err, "Failed to load wallet campaigns"));
    } finally {
      setLoading(false);
    }
  }, [provider, account]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}

export function useCampaign(provider: AnyProvider, address: string | undefined) {
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [milestones, setMilestones] = useState<MilestoneInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaign = useCallback(async () => {
    if (!address) {
      setCampaign(null);
      setMilestones([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await fetchJsonWithTimeout(
        `${API_BASE}/campaign?address=${encodeURIComponent(address)}`,
        "Campaign detail API fetch"
      );
      if (payload) {
        setCampaign(payload?.campaign ? await hydrateCampaignResponse(payload.campaign) : null);
        setMilestones((payload?.milestones || []).map(parseMilestoneResponse));
        setLoading(false);
        return;
      }

      const sourceFactory =
        (
          await loadAllFactoryCampaignAddresses(provider)
        ).find((entry) => entry.address.toLowerCase() === address.toLowerCase())?.factoryAddress ||
        FACTORY_ADDRESS;

      const [campaignInfo, allMilestones] = await Promise.all([
        loadCampaignSnapshot(address, provider, undefined, sourceFactory),
        loadMilestones(address, provider),
      ]);

      setCampaign(campaignInfo);
      setMilestones(allMilestones);
    } catch (err: unknown) {
      setCampaign(null);
      setMilestones([]);
      setError(getReadableContractError(err, "Failed to load campaign details"));
    } finally {
      setLoading(false);
    }
  }, [provider, address]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  return { campaign, milestones, loading, error, refetch: fetchCampaign };
}
