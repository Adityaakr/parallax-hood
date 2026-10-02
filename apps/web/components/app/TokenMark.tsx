/* Round mark for a settlement or index token. USDG is the token file from the Global Dollar Network's own brand
   page (globaldollar.com/brand, "USDG Token"), unmodified. The Parallax indices share an ink tile with one accent
   glyph each, drawn in public/tokens. Anything unknown falls back to a lettered tile, so a new index renders
   before it has art. */
const MARKS: Record<string, string> = {
  USDG: "/tokens/usdg.svg",
  PXMAG7: "/tokens/pxmag7.svg",
  PXAI: "/tokens/pxai.svg",
};

export function TokenMark({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const src = MARKS[symbol.toUpperCase()];
  if (!src) {
    return (
      <span className="rounded-full shrink-0 inline-flex items-center justify-center text-white font-semibold" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: "var(--brand)" }} aria-hidden>
        {symbol.replace(/^px/i, "").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  // plain <img>: these are local static SVGs, next/image would only add a request
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className="rounded-full shrink-0" style={{ width: size, height: size }} />;
}
