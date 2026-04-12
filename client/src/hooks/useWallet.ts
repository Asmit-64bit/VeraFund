import { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import {
  READONLY_SEPOLIA_RPC,
  READONLY_SEPOLIA_RPCS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
} from "../constants";
import type { WalletState } from "../types";

export function useWallet(): WalletState {
  const { address, isConnected, isConnecting } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const readonlyProvider = useMemo(() => {
    const providers = READONLY_SEPOLIA_RPCS.map(
      (url) =>
        new ethers.JsonRpcProvider(url, undefined, {
          staticNetwork: ethers.Network.from(SEPOLIA_CHAIN_ID),
        })
    );

    return new ethers.FallbackProvider(
      providers.map((provider, index) => ({
        provider,
        priority: index + 1,
        stallTimeout: 1200,
        weight: 1,
      })),
      undefined,
      {
        quorum: 1,
      }
    );
  }, []);

  const [provider, setProvider] = useState<ethers.BrowserProvider | ethers.FallbackProvider | null>(
    () => readonlyProvider
  );
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = isConnected && address ? address : null;
  const isWrongNetwork = !!account && chainId !== SEPOLIA_CHAIN_ID;

  const connect = useCallback(async () => {
    try {
      setError(null);
      if (!openConnectModal) {
        throw new Error("Wallet modal unavailable. Refresh and try again.");
      }
      openConnectModal();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [openConnectModal]);

  const disconnect = useCallback(() => {
    setError(null);
    wagmiDisconnect();
    setProvider(readonlyProvider);
    setSigner(null);
  }, [readonlyProvider, wagmiDisconnect]);

  const switchToSepolia = useCallback(async () => {
    try {
      if (switchChainAsync) {
        await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
        return;
      }

      if (!window.ethereum) return;
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (err: unknown) {
      const switchErr = err as { code?: number };
      if (switchErr.code === 4902) {
        await window.ethereum!.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: SEPOLIA_CHAIN_ID_HEX,
              chainName: "Sepolia Testnet",
              nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [READONLY_SEPOLIA_RPC],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      }
    }
  }, [switchChainAsync]);

  useEffect(() => {
    let cancelled = false;

    async function syncWalletState() {
      try {
        if (walletClient?.transport) {
          const browserProvider = new ethers.BrowserProvider(walletClient.transport as ethers.Eip1193Provider);
          const userSigner = await browserProvider.getSigner();
          if (!cancelled) {
            setProvider(readonlyProvider);
            setSigner(userSigner);
          }
          return;
        }

        if (!cancelled) {
          setProvider(readonlyProvider);
          setSigner(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to initialize wallet");
          setProvider(readonlyProvider);
          setSigner(null);
        }
      }
    }

    syncWalletState();
    return () => {
      cancelled = true;
    };
  }, [readonlyProvider, walletClient]);

  return {
    account,
    provider,
    signer,
    chainId: chainId ?? null,
    isConnecting,
    isWrongNetwork,
    error,
    connect,
    disconnect,
    switchToSepolia,
  };
}
