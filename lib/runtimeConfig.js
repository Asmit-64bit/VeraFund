const DEFAULT_FACTORY_ADDRESS = "0x6A837595E2592d699d48eB2DAcF47Df9493035d2";
const DEFAULT_ETHERSCAN_API_URL = "https://api-sepolia.etherscan.io/api";
const DEFAULT_SEPOLIA_RPCS = [
  "https://gateway.tenderly.co/public/sepolia",
  "https://1rpc.io/sepolia",
  "https://ethereum-sepolia-rpc.publicnode.com",
];
const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://w3s.link/ipfs/",
];

function splitCsvEnv(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

const FACTORY_ADDRESS = (process.env.FACTORY_ADDRESS || DEFAULT_FACTORY_ADDRESS).trim();
const FACTORY_ADDRESSES = uniqueValues([
  FACTORY_ADDRESS,
  ...splitCsvEnv(process.env.FACTORY_ADDRESSES),
]);
const READONLY_SEPOLIA_RPCS = uniqueValues([
  process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPCS[0],
  ...splitCsvEnv(process.env.SEPOLIA_RPC_FALLBACKS),
  ...DEFAULT_SEPOLIA_RPCS,
]);
const IPFS_GATEWAYS = uniqueValues([
  ...splitCsvEnv(process.env.IPFS_GATEWAYS),
  ...DEFAULT_IPFS_GATEWAYS,
]);

module.exports = {
  FACTORY_ADDRESS,
  FACTORY_ADDRESSES,
  READONLY_SEPOLIA_RPCS,
  SEPOLIA_CHAIN_ID: 11155111,
  ETHERSCAN_API_URL: process.env.ETHERSCAN_API_URL || DEFAULT_ETHERSCAN_API_URL,
  ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || "",
  IPFS_GATEWAYS,
};
