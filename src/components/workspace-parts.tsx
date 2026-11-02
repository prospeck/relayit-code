import type { ReactNode } from "react";
import { ChevronLeft, Cloud } from "lucide-react";
import { cloudColorFill } from "@/lib/cloud-look";

export function Heading({ title, sub }: { title: string; sub?: ReactNode }) {
  return <div className="flex flex-col gap-1 pe-10">
    <h2 id="cloud-add-title" tabIndex={-1} className="text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink outline-none! [text-wrap:balance]">{title}</h2>
    {sub && <p className="text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{sub}</p>}
  </div>;
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}
    className="-ms-1.5 inline-flex items-center gap-0.5 self-start rounded-full py-1 pe-2.5 ps-1 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink motion-reduce:transition-none">
    <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" className="rtl:-scale-x-100" />{label}
  </button>;
}

export function CloudTile({ color, size = 22 }: { color: unknown; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, background: cloudColorFill(color) }}
    className="grid shrink-0 place-items-center rounded-[7px] text-white"><Cloud size={Math.round(size * 0.62)} strokeWidth={2.2} /></span>;
}
