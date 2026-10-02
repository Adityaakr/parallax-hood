"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CHAIN, type NetworkId } from "./config";

const Ctx = createContext<{ chainId: NetworkId; setChainId: (c: NetworkId) => void }>({ chainId: DEFAULT_CHAIN, setChainId: () => {} });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, set] = useState<NetworkId>(DEFAULT_CHAIN);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("parallax:chain"));
      if ([56, 97, 31337, 1337].includes(saved)) set(saved as NetworkId);
    } catch {}
  }, []);
  const setChainId = (c: NetworkId) => {
    set(c);
    try {
      localStorage.setItem("parallax:chain", String(c));
    } catch {}
  };
  return <Ctx.Provider value={{ chainId, setChainId }}>{children}</Ctx.Provider>;
}
export const useNetwork = () => useContext(Ctx);
