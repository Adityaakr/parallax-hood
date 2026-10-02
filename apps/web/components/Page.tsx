import type { ReactNode } from "react";
import { Tag } from "@/components/site/ui";

/** Product page container. Children rise in with the site's appear effect (see .app-main > * in app.css). */
export function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[10px] min-w-0">{children}</div>;
}

/** Page header in the site's heading grammar: Section Tag, serif title, soft lede; actions on the right. */
export function PageHead({ eyebrow, title, lede, right }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-[20px] pb-[20px]">
      <div className="flex flex-col gap-[15px]" style={{ maxWidth: 640 }}>
        {eyebrow && <div><Tag on={2}>{eyebrow}</Tag></div>}
        <h1 className="h2">{title}</h1>
        {lede && <p className="body-md muted">{lede}</p>}
      </div>
      {right && <div className="text-right">{right}</div>}
    </div>
  );
}
