import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from "../constants";
import type { WalletState } from "../types";

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

// Public Sepolia RPC for read-only access (no wallet needed)
const SEPOLIA_RPC = "https://rpc.sepolia.org";

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | ethers.JsonRpcProvider | null>(
    () => new ethers.JsonRpcProvider(SEPOLIA_RPC)
  );
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWrongNetwork = chainId !== null && chainId !== SEPOLIA_CHAIN_ID;

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask not found. Please install MetaMask.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const network = await browserProvider.getNetwork();
      const userSigner = await browserProvider.getSigner();

      setProvider(browserProvider);
      setAccount(accounts[0]);
      setSigner(userSigner);
      setChainId(Number(network.chainId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
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
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      }
    }
  }, []);

  // Auto-connect if previously connected
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
        if ((accounts as string[]).length > 0) connect();
      });
    }
  }, [connect]);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      if ((accounts as string[]).length === 0) {
        setAccount(null);
        setSigner(null);
      } else {
        connect();
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, [connect]);

  return {
    account,
    provider,
    signer,
    chainId,
    isConnecting,
    isWrongNetwork,
    error,
    connect,
    switchToSepolia,
  };
}
