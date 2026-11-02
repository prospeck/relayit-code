import { SIMPLE_CARD } from "./SettingsPrimitives";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function UsageSummaryCard({ kind, title, percent, label, note, children }: {
  kind: "cloud" | "plan";
  title: string;
  percent: number;
  label: string;
  note: ReactNode;
  children?: ReactNode;
}) {
  const band = percent >= 100 ? "full" : percent >= 80 ? "near" : "ok";
  return (
    <section data-usage-summary={kind} data-band={band} aria-label={label} className={cn(SIMPLE_CARD, "px-4 py-3.5")}>
      <p className="text-[13px] leading-[18px] text-ink">{title}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[22px] font-medium leading-7 tracking-[-0.012em] text-ink tabular-nums">{percent}%</span>
        <span className="text-[13px] text-ink-secondary">{t("settings.simple.billing.used")}</span>
      </p>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink/[0.04]">
        <div className={cn("h-full rounded-full", { ok: "bg-ink/80", near: "bg-warning", full: "bg-danger" }[band])} style={{ width: `${percent > 0 ? Math.max(percent, 1) : 0}%` }} />
      </div>
      <p className="mt-2 text-[12px] leading-4 text-ink-secondary">{note}</p>
      {children}
    </section>
  );
}
