/* Product routes: the wallet/query providers and the dashboard shell live here, so the marketing pages never load them. */
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/app/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
