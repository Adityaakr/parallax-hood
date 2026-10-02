"use client";
export const COLORS: Record<string, string> = { bstock: "var(--brand)", ondo: "var(--ink)", xstock: "var(--muted-2)" };

export function IssuerBar({ mix }: { mix: { platform: string; bps: number }[] }) {
  const total = mix.reduce((a, m) => a + m.bps, 0);
  if (!total) return <div className="bar" />;
  return (
    <div className="bar">
      {mix.map((m) => (
        <span key={m.platform} style={{ width: `${m.bps / 100}%`, background: COLORS[m.platform] ?? "var(--muted)" }} title={`${m.platform} ${m.bps / 100}%`} />
      ))}
    </div>
  );
}
