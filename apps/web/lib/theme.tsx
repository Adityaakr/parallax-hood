"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    let t: Theme = "light";
    try {
      const saved = localStorage.getItem("parallax:theme") as Theme | null;
      // The design system is light-only (Zenvaro template); a saved dark preference is ignored.
      t = saved === "light" ? saved : "light";
    } catch {}
    setTheme(t);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("parallax:theme", theme);
    } catch {}
  }, [theme]);
  return <Ctx.Provider value={{ theme, toggle: () => setTheme((x) => (x === "dark" ? "light" : "dark")) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
