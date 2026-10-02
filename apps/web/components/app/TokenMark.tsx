/* Round mark for a settlement or index token. USDT is Tether's own ₮; the three Parallax indices share an ink
   tile with one accent glyph each (a seven, a die, a breakout), drawn in public/tokens. Anything unknown falls
   back to a brand dot, so a new index renders before it has art. */
const MARKS: Record<string, string> = {
  USDT: "/tokens/usdt.svg",
  PXMAG7: "/tokens/pxmag7.svg",
  PXAI: "/tokens/pxai.svg",
  PXNEW: "/tokens/pxnew.svg",
};

export function TokenMark({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const src = MARKS[symbol.toUpperCase()];
  if (!src) return <span className="rounded-full shrink-0" style={{ width: size, height: size, background: "var(--brand)" }} />;
  // plain <img>: these are local static SVGs, next/image would only add a request
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className="rounded-full shrink-0" style={{ width: size, height: size }} />;
}
