const { ethers } = require("ethers");
const { fetchIpfsBuffer } = require("./enhancements");
const { loadCampaignProfileFromStore } = require("./campaignProfileStore");

const FACTORY_ADDRESS = "0x6A837595E2592d699d48eB2DAcF47Df9493035d2";
const FACTORY_ADDRESSES = [FACTORY_ADDRESS];
const READONLY_SEPOLIA_RPCS = [
  process.env.SEPOLIA_RPC_URL || "https://gateway.tenderly.co/public/sepolia",
  "https://1rpc.io/sepolia",
  "https://ethereum-sepolia-rpc.publicnode.com",
];
const SEPOLIA_CHAIN_ID = 11155111;
const READ_TIMEOUT_MS = 3000;
const MAX_LOG_BLOCK_RANGE = 45_000;
const MAX_FACTORY_LOG_BLOCK_RANGE = 200_000;
const PROFILE_CID_REGEX = /\[PROFILE_CID:([^\]]+)\]/i;
const ETHERSCAN_API_URL = "https://api-sepolia.etherscan.io/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://w3s.link/ipfs/",
];

const FACTORY_ABI = [
  "function getAllCampaigns() external view returns (address[])",
  "event CampaignCreated(address indexed campaignAddress, address indexed ngo, string title)",
];

const CAMPAIGN_ABI = [
  "function getCampaign() external view returns (tuple(address ngoAddress, string title, string description, string ngoName, uint256 goalAmount, uint256 raisedAmount, uint256 campaignDeadline, uint256 bootstrapPercent, uint8 status, uint256 milestoneCount))",
  "function getDonation(address donor) external view returns (uint256)",
  "function getAllMilestones() external view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string ipfsHash, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst, bool resolvedByAI, uint8 aiScore)[])",
  "function getMilestoneCount() external view returns (uint256)",
  "function getMilestone(uint256 milestoneId) external view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string ipfsHash, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst, bool resolvedByAI, uint8 aiScore))",
  "function bootstrapReleased() external view returns (bool)",
  "event DonationReceived(address indexed donor, uint256 amount)",
  "event BootstrapReleased(uint256 amount)",
  "event MilestoneSubmitted(uint256 indexed milestoneId, string ipfsHash)",
  "event VotingOpened(uint256 indexed milestoneId, uint256 votingDeadline)",
  "event VoteCast(address indexed voter, uint256 indexed milestoneId, bool approved)",
  "event FundsReleased(uint256 indexed milestoneId, uint256 amount, bool resolvedByAI)",
  "event MilestoneRejected(uint256 indexed milestoneId, bool resolvedByAI)",
  "event RefundIssued(address indexed donor, uint256 amount)",
  "event CampaignMarkedStale(uint256 indexed milestoneId, uint256 refundPool)",
];

const providers = READONLY_SEPOLIA_RPCS.map(
  (url) =>
    new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: ethers.Network.from(SEPOLIA_CHAIN_ID),
    })
);

const profileCache = new Map();
const campaignStartBlockCache = new Map();

function withTimeout(promise, label, timeoutMs = READ_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    ),
  ]);
}

async function readAny(label, runner) {
  try {
    return await Promise.any(
      providers.map((provider) => withTimeout(runner(provider), label).catch((error) => {
        throw error;
      }))
    );
  } catch (error) {
    if (error instanceof AggregateError && error.errors.length > 0) {
      throw error.errors[0];
    }
    throw error;
  }
}

async function readSequential(label, runner, candidateProviders = providers) {
  let lastError = null;

  for (const provider of candidateProviders) {
    try {
      return await withTimeout(runner(provider), label);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${label} failed`);
}

async function fetchEtherscanLogs({
  address,
  topic0,
  fromBlock = 0,
  toBlock = "latest",
}) {
  if (!ETHERSCAN_API_KEY) {
    return [];
  }

  const url = new URL(ETHERSCAN_API_URL);
  url.searchParams.set("module", "logs");
  url.searchParams.set("action", "getLogs");
  url.searchParams.set("address", address);
  url.searchParams.set("fromBlock", String(fromBlock));
  url.searchParams.set("toBlock", String(toBlock));
  if (topic0) {
    url.searchParams.set("topic0", topic0);
  }
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  const response = await fetch(url).catch(() => null);
  if (!response || !response.ok) {
    throw new Error("Etherscan log fetch failed");
  }

  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw new Error("Etherscan log payload missing");
  }

  if (payload.status === "0" && payload.message === "No records found") {
    return [];
  }

  if (payload.status !== "1" || !Array.isArray(payload.result)) {
    throw new Error(payload.result || payload.message || "Etherscan log fetch failed");
  }

  return payload.result;
}

function extractProfileCid(rawDescription = "") {
  return rawDescription.match(PROFILE_CID_REGEX)?.[1]?.trim() || null;
}

function stripProfileCidFromDescription(rawDescription = "") {
  return rawDescription.replace(/\n?\n?\[PROFILE_CID:[^\]]+\]/i, "").trim();
}

function getIpfsUrls(cid) {
  return IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
}

async function fetchJsonWithTimeout(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCampaignProfile(profileCid) {
  if (!profileCid) return null;
  if (profileCache.has(profileCid)) return profileCache.get(profileCid);

  const storedProfile = loadCampaignProfileFromStore(profileCid);
  if (storedProfile) {
    profileCache.set(profileCid, storedProfile);
    return storedProfile;
  }

  try {
    const { buffer } = await fetchIpfsBuffer(profileCid);
    const json = JSON.parse(buffer.toString("utf8"));
    profileCache.set(profileCid, json);
    return json;
  } catch {
    for (const url of getIpfsUrls(profileCid)) {
      try {
        const response = await fetchJsonWithTimeout(url).catch(() => null);
        if (!response || !response.ok) {
          continue;
        }

        const json = await response.json();
        profileCache.set(profileCid, json);
        return json;
      } catch {
        // Try the next gateway.
      }
    }

    return null;
  }
}

async function loadCampaignSnapshot(address, account, factoryAddress = FACTORY_ADDRESS) {
  const { info, donation } = await readAny(`Campaign ${address.slice(0, 8)} fetch`, async (provider) => {
    const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
    const info = await contract.getCampaign();

    const donation = account ? await contract.getDonation(account) : null;
    return { info, donation };
  });

  const bootstrapReleased = await readAny(`Bootstrap state ${address.slice(0, 8)} fetch`, async (provider) => {
    const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
    return contract.bootstrapReleased();
  }).catch(() => Number(info.status) !== 0);

  const profileCid = extractProfileCid(info.description);
  const profile = await fetchCampaignProfile(profileCid);

  return {
    address,
    factoryAddress,
    ngoAddress: info.ngoAddress,
    title: info.title,
    description: stripProfileCidFromDescription(info.description),
    profileCid,
    profile,
    ngoName: info.ngoName,
    goalAmount: info.goalAmount.toString(),
    raisedAmount: info.raisedAmount.toString(),
    campaignDeadline: Number(info.campaignDeadline),
    bootstrapPercent: Number(info.bootstrapPercent),
    bootstrapReleased: Boolean(bootstrapReleased),
    status: Number(info.status),
    milestoneCount: Number(info.milestoneCount),
    ...(account ? { userDonation: (donation || 0n).toString() } : {}),
  };
}

function formatMilestone(milestone, index) {
  return {
    id: index,
    title: milestone.title,
    description: milestone.description,
    fundPercent: Number(milestone.fundPercent),
    deadline: Number(milestone.deadline),
    status: Number(milestone.status),
    ipfsHash: milestone.ipfsHash,
    votingDeadline: Number(milestone.votingDeadline),
    votesFor: milestone.votesFor.toString(),
    votesAgainst: milestone.votesAgainst.toString(),
    resolvedByAI: Boolean(milestone.resolvedByAI),
    aiScore: Number(milestone.aiScore),
  };
}

async function loadMilestones(address) {
  try {
    const allMilestones = await readAny(`Milestones ${address.slice(0, 8)} fetch`, async (provider) => {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
      return contract.getAllMilestones();
    });

    return allMilestones.map((milestone, index) => formatMilestone(milestone, index));
  } catch {
    const count = Number(
      await readAny(`Milestone count ${address.slice(0, 8)} fetch`, async (provider) => {
        const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
        return contract.getMilestoneCount();
      }).catch(() => 0)
    );

    if (!count) return [];

    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, index) =>
        readAny(`Milestone ${index + 1} ${address.slice(0, 8)} fetch`, async (provider) => {
          const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
          return contract.getMilestone(index);
        })
      )
    );

    return results
      .map((result, index) =>
        result.status === "fulfilled" ? formatMilestone(result.value, index) : null
      )
      .filter(Boolean);
  }
}

async function listCampaigns(account) {
  const addressGroups = await Promise.allSettled(
    FACTORY_ADDRESSES.map((factoryAddress) =>
      readAny(`Campaign list fetch ${factoryAddress.slice(0, 8)}`, async (provider) => {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        const addresses = await factory.getAllCampaigns();
        return addresses.map((address) => ({ address, factoryAddress }));
      })
    )
  );

  const dedupedAddresses = new Map();
  addressGroups.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((entry) => {
      const key = entry.address.toLowerCase();
      if (!dedupedAddresses.has(key)) {
        dedupedAddresses.set(key, entry);
      }
    });
  });

  const addresses = Array.from(dedupedAddresses.values());

  if (addresses.length === 0 && ETHERSCAN_API_KEY) {
    for (const factoryAddress of FACTORY_ADDRESSES) {
      try {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, providers[0]);
        const eventFragment = factory.interface.getEvent("CampaignCreated");
        if (!eventFragment) continue;

        const etherscanLogs = await fetchEtherscanLogs({
          address: factoryAddress,
          topic0: eventFragment.topicHash,
        });

        etherscanLogs.forEach((log) => {
          const parsed = factory.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          const campaignAddress = String(parsed?.args?.campaignAddress || parsed?.args?.[0] || "");
          if (!campaignAddress) return;
          const key = campaignAddress.toLowerCase();
          if (!dedupedAddresses.has(key)) {
            dedupedAddresses.set(key, { address: campaignAddress, factoryAddress });
          }
        });
      } catch {
        // Fall through to any other factory or the empty result.
      }
    }
  }

  const results = await Promise.allSettled(
    Array.from(dedupedAddresses.values()).map((entry) =>
      loadCampaignSnapshot(entry.address, account, entry.factoryAddress)
    )
  );

  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

async function getCampaignDetails(address, account) {
  const normalizedAddress = String(address).toLowerCase();
  const addressGroups = await Promise.allSettled(
    FACTORY_ADDRESSES.map((factoryAddress) =>
      readAny(`Campaign detail source ${factoryAddress.slice(0, 8)}`, async (provider) => {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        return {
          factoryAddress,
          addresses: await factory.getAllCampaigns(),
        };
      })
    )
  );

  const sourceFactory =
    addressGroups.find(
      (result) =>
        result.status === "fulfilled" &&
        result.value.addresses.some((candidate) => candidate.toLowerCase() === normalizedAddress)
    )?.value.factoryAddress || FACTORY_ADDRESS;

  const [campaign, milestones] = await Promise.all([
    loadCampaignSnapshot(address, account, sourceFactory),
    loadMilestones(address),
  ]);

  return { campaign, milestones };
}

async function getCampaignStartBlock(campaignAddress) {
  if (campaignStartBlockCache.has(campaignAddress)) {
    return campaignStartBlockCache.get(campaignAddress);
  }

  const latestBlock = await readSequential("Factory latest block fetch", (candidate) =>
    candidate.getBlockNumber()
  ).catch(() => 0);

  for (const factoryAddress of FACTORY_ADDRESSES) {
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, providers[0]);
    const eventFragment = factory.interface.getEvent("CampaignCreated");
    if (!eventFragment) continue;

    const topics = factory.interface.encodeFilterTopics(eventFragment, [campaignAddress]);

    try {
      for (let toBlock = latestBlock; toBlock >= 0; toBlock -= MAX_FACTORY_LOG_BLOCK_RANGE) {
        const fromBlock = Math.max(toBlock - MAX_FACTORY_LOG_BLOCK_RANGE + 1, 0);
        const logs = await readSequential("Campaign start block fetch", (candidate) =>
          candidate.getLogs({
            address: factoryAddress,
            fromBlock,
            toBlock,
            topics,
          })
        );

        if (logs.length > 0) {
          const blockNumber = logs[0].blockNumber || 0;
          campaignStartBlockCache.set(campaignAddress, blockNumber);
          return blockNumber;
        }

        if (fromBlock === 0) break;
      }
    } catch {
      // Try the next factory or fall through to zero.
    }

    try {
      const eventFragment = factory.interface.getEvent("CampaignCreated");
      if (!eventFragment) continue;

      const etherscanLogs = await fetchEtherscanLogs({
        address: factoryAddress,
        topic0: eventFragment.topicHash,
      });
      const matchingLog = etherscanLogs.find((log) => {
        const parsed = factory.interface.parseLog({ topics: log.topics, data: log.data });
        const createdAddress = String(parsed?.args?.campaignAddress || parsed?.args?.[0] || "");
        return createdAddress.toLowerCase() === campaignAddress.toLowerCase();
      });

      if (matchingLog) {
        const blockNumber = Number(matchingLog.blockNumber);
        campaignStartBlockCache.set(campaignAddress, blockNumber);
        return blockNumber;
      }
    } catch {
      // Continue to the next source.
    }
  }

  campaignStartBlockCache.set(campaignAddress, 0);
  return 0;
}

function formatActor(actor) {
  return `${actor.slice(0, 6)}...${actor.slice(-4)}`;
}

function formatEthLabel(value) {
  const raw = ethers.formatEther(value);
  const amount = Number(raw);

  if (!Number.isFinite(amount) || amount === 0) {
    return "0 ETH";
  }

  const absoluteValue = Math.abs(amount);
  let digits = 4;

  if (absoluteValue > 0 && absoluteValue < 1 / 10 ** digits) {
    const fractionPart = raw.split(".")[1] ?? "";
    const firstNonZeroIndex = fractionPart.search(/[1-9]/);

    if (firstNonZeroIndex >= 0) {
      digits = Math.min(Math.max(firstNonZeroIndex + 2, digits), 8);
    }
  } else if (absoluteValue >= 1) {
    digits = 3;
  }

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(amount)} ETH`;
}

async function getAuditTrail(campaignAddress) {
  const provider = providers[0];
  const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, provider);
  const eventNames = [
    "DonationReceived",
    "BootstrapReleased",
    "MilestoneSubmitted",
    "VotingOpened",
    "VoteCast",
    "FundsReleased",
    "MilestoneRejected",
    "RefundIssued",
    "CampaignMarkedStale",
  ];

  const startBlock = await getCampaignStartBlock(campaignAddress);
  const latestBlock = await readSequential("Latest block fetch", (candidate) => candidate.getBlockNumber());

  async function fetchLogsInChunks(eventName) {
    const eventFragment = contract.interface.getEvent(eventName);
    if (!eventFragment) return [];
    const topics = contract.interface.encodeFilterTopics(eventFragment, []);
    const rawLogs = [];

    for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += MAX_LOG_BLOCK_RANGE + 1) {
      const toBlock = Math.min(fromBlock + MAX_LOG_BLOCK_RANGE, latestBlock);
      let chunkLogs;

      try {
        chunkLogs = await readSequential(`${eventName} logs fetch`, (candidate) =>
          candidate.getLogs({
            address: campaignAddress,
            fromBlock,
            toBlock,
            topics: [topics[0]],
          })
        );
      } catch {
        const etherscanLogs = await fetchEtherscanLogs({
          address: campaignAddress,
          topic0: topics[0],
          fromBlock,
          toBlock,
        }).catch(() => []);

        chunkLogs = etherscanLogs.map((log) => ({
          address: log.address,
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
          index: Number(log.logIndex),
          data: log.data,
          topics: log.topics,
        }));
      }

      rawLogs.push(...chunkLogs);
    }

    return rawLogs.map((entry) => {
      const parsed = contract.interface.parseLog(entry);
      return {
        ...entry,
        args: parsed?.args,
        eventName: parsed?.name,
      };
    });
  }

  const eventGroups = [];
  for (const eventName of eventNames) {
    const logs = await fetchLogsInChunks(eventName);
    eventGroups.push(...logs);
  }

  const flattened = eventGroups
    .filter((entry) => entry.args && entry.eventName)
    .sort((a, b) =>
      b.blockNumber === a.blockNumber
        ? (b.index || 0) - (a.index || 0)
        : b.blockNumber - a.blockNumber
    );

  const blockTimeCache = new Map();

  return Promise.all(
    flattened.map(async (event) => {
      let timestamp = blockTimeCache.get(event.blockNumber) ?? null;
      if (!blockTimeCache.has(event.blockNumber)) {
        const block = await readSequential("Block timestamp fetch", (candidate) =>
          candidate.getBlock(event.blockNumber)
        );
        timestamp = block?.timestamp ?? null;
        blockTimeCache.set(event.blockNumber, timestamp);
      }

      const eventArgs = event.args?.toObject?.() || {};
      const args = event.args || [];

      if (event.eventName === "DonationReceived") {
        const donor = String(eventArgs.donor ?? args[0]);
        const amount = formatEthLabel(BigInt(eventArgs.amount ?? args[1]));
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: "Donation received",
          summary: `${formatActor(donor)} donated ${amount}.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "BootstrapReleased") {
        const amount = formatEthLabel(BigInt(eventArgs.amount ?? args[0]));
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: "Bootstrap released",
          summary: `${amount} was released to start work once the bootstrap funding threshold was met.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "MilestoneSubmitted") {
        const milestoneId = Number(eventArgs.milestoneId ?? args[0]);
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: `Milestone ${milestoneId} submitted`,
          summary: `The organiser submitted new proof for Milestone ${milestoneId}.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "VotingOpened") {
        const milestoneId = Number(eventArgs.milestoneId ?? args[0]);
        const votingDeadline = Number(eventArgs.votingDeadline ?? args[1]);
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: `Voting opened for Milestone ${milestoneId}`,
          summary: `Donors can vote until ${new Date(votingDeadline * 1000).toLocaleString()}.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "VoteCast") {
        const voter = String(eventArgs.voter ?? args[0]);
        const milestoneId = Number(eventArgs.milestoneId ?? args[1]);
        const approved = Boolean(eventArgs.approved ?? args[2]);
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: `Vote cast on Milestone ${milestoneId}`,
          summary: `${formatActor(voter)} voted ${approved ? "Approve" : "Challenge"} on Milestone ${milestoneId}.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "FundsReleased") {
        const milestoneId = Number(eventArgs.milestoneId ?? args[0]);
        const amount = formatEthLabel(BigInt(eventArgs.amount ?? args[1]));
        const resolvedByAI = Boolean(eventArgs.resolvedByAI ?? args[2]);
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: `Milestone ${milestoneId} approved`,
          summary: `${amount} was released to the organiser${resolvedByAI ? " after AI tie-break resolution" : ""}.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "MilestoneRejected") {
        const milestoneId = Number(eventArgs.milestoneId ?? args[0]);
        const resolvedByAI = Boolean(eventArgs.resolvedByAI ?? args[1]);
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: `Milestone ${milestoneId} rejected`,
          summary: `Milestone ${milestoneId} was rejected${resolvedByAI ? " after AI tie-break review" : ""} and needs resubmission.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      if (event.eventName === "RefundIssued") {
        const donor = String(eventArgs.donor ?? args[0]);
        const amount = formatEthLabel(BigInt(eventArgs.amount ?? args[1]));
        return {
          id: `${event.transactionHash}-${event.index}`,
          title: "Refund issued",
          summary: `${formatActor(donor)} reclaimed ${amount} from unused locked funds.`,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp,
        };
      }

      const milestoneId = Number(eventArgs.milestoneId ?? args[0]);
      const refundPool = formatEthLabel(BigInt(eventArgs.refundPool ?? args[1]));
      return {
        id: `${event.transactionHash}-${event.index}`,
        title: "Campaign marked stale",
        summary: `Milestone ${milestoneId} became stale and ${refundPool} is now available for donor refunds.`,
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp,
      };
    })
  );
}

function getReadableAuditError(error) {
  const message = error instanceof Error ? error.message : "";

  if (
    message.includes("Too Many Requests") ||
    message.includes("rate limit") ||
    message.includes("timed out") ||
    message.includes("missing response for request")
  ) {
    return "Audit trail is temporarily unavailable because the Sepolia log provider is rate-limiting requests. Please refresh in a moment.";
  }

  return "Audit trail could not be loaded right now. Please refresh and try again.";
}

module.exports = {
  listCampaigns,
  getCampaignDetails,
  getAuditTrail,
  getReadableAuditError,
};
