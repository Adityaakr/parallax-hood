"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CHAIN, NETWORK_IDS, type NetworkId } from "./config";

const Ctx = createContext<{ chainId: NetworkId; setChainId: (c: NetworkId) => void }>({ chainId: DEFAULT_CHAIN, setChainId: () => {} });
const KEY = "parallax-hood:chain";

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, set] = useState<NetworkId>(DEFAULT_CHAIN);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if ((NETWORK_IDS as readonly number[]).includes(saved)) set(saved as NetworkId);
    } catch {}
  }, []);
  const setChainId = (c: NetworkId) => {
    set(c);
    try {
      localStorage.setItem(KEY, String(c));
    } catch {}
  };
  return <Ctx.Provider value={{ chainId, setChainId }}>{children}</Ctx.Provider>;
}
export const useNetwork = () => useContext(Ctx);
