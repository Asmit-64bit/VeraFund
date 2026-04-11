import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, FACTORY_ABI, CAMPAIGN_ABI } from "../constants";
import type { CampaignInfo, MilestoneInfo } from "../types";

type AnyProvider = ethers.BrowserProvider | ethers.JsonRpcProvider | null;

export function useAllCampaigns(provider: AnyProvider) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    setError(null);

    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
      const addresses: string[] = await factory.getAllCampaigns();

      const campaignData: CampaignInfo[] = await Promise.all(
        addresses.map(async (addr) => {
          const campaign = new ethers.Contract(addr, CAMPAIGN_ABI, provider);
          const info = await campaign.getCampaign();
          return {
            address: addr,
            ngoAddress: info.ngoAddress,
            title: info.title,
            description: info.description,
            ngoName: info.ngoName,
            goalAmount: info.goalAmount,
            raisedAmount: info.raisedAmount,
            campaignDeadline: Number(info.campaignDeadline),
            bootstrapPercent: Number(info.bootstrapPercent),
            status: Number(info.status),
            milestoneCount: Number(info.milestoneCount),
          };
        })
      );

      setCampaigns(campaignData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [provider]);

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
    if (!provider || !address) return;
    setLoading(true);
    setError(null);

    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
      const info = await contract.getCampaign();
      const allMilestones = await contract.getAllMilestones();

      setCampaign({
        address,
        ngoAddress: info.ngoAddress,
        title: info.title,
        description: info.description,
        ngoName: info.ngoName,
        goalAmount: info.goalAmount,
        raisedAmount: info.raisedAmount,
        campaignDeadline: Number(info.campaignDeadline),
        bootstrapPercent: Number(info.bootstrapPercent),
        status: Number(info.status),
        milestoneCount: Number(info.milestoneCount),
      });

      setMilestones(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allMilestones.map((m: any, i: number) => ({
          id: i,
          title: m.title,
          description: m.description,
          fundPercent: Number(m.fundPercent),
          deadline: Number(m.deadline),
          status: Number(m.status),
          ipfsHash: m.ipfsHash,
          votingDeadline: Number(m.votingDeadline),
          votesFor: m.votesFor,
          votesAgainst: m.votesAgainst,
          resolvedByAI: m.resolvedByAI,
          aiScore: Number(m.aiScore),
        }))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [provider, address]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  return { campaign, milestones, loading, error, refetch: fetchCampaign };
}
