import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { READONLY_SEPOLIA_RPC } from "./constants";

const rawWalletConnectProjectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

export const hasWalletConnectProjectId =
  rawWalletConnectProjectId.length > 0 &&
  rawWalletConnectProjectId !== "verafund-dev" &&
  rawWalletConnectProjectId !== "your_walletconnect_project_id";

const walletConnectProjectId = hasWalletConnectProjectId
  ? rawWalletConnectProjectId
  : "walletconnect-not-configured";

const walletMetadata = {
  name: "VeraFund",
  description: "Transparent milestone-based crowdfunding for social impact.",
  url: "https://verafund.vercel.app",
  icons: ["https://verafund.vercel.app/assets/veraFundLogo.png"],
};

const recommendedWallets = [
  injectedWallet,
  coinbaseWallet,
  ...(hasWalletConnectProjectId
    ? [metaMaskWallet, rainbowWallet, walletConnectWallet]
    : []),
];

export const walletConfig = getDefaultConfig({
  appName: "VeraFund",
  appDescription: walletMetadata.description,
  appUrl: walletMetadata.url,
  appIcon: walletMetadata.icons[0],
  projectId: walletConnectProjectId,
  walletConnectParameters: {
    metadata: walletMetadata,
  },
  wallets: [
    {
      groupName: hasWalletConnectProjectId ? "Popular" : "Installed",
      wallets: recommendedWallets,
    },
  ],
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(READONLY_SEPOLIA_RPC),
  },
  ssr: false,
});
