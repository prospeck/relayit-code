import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Ban, Check, ChevronRight, Clock, Cog, KeyRound, Plug, Play, Search, ShieldCheck, Wrench, CalendarClock } from "lucide-react";
import type { AuditEvent } from "@relayit/shared";
import { api } from "../lib/api";
import { cx, fmtDay, fmtTime } from "../lib/format";
import { navigate } from "../lib/router";
import { ClassBadge, EmptyState, Input, Page, Segmented } from "../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "action", label: "Approvals" },
  { value: "tool", label: "Tool calls" },
  { value: "settings", label: "Settings" },
  { value: "error", label: "Errors" },
] as const;

function iconFor(kind: AuditEvent["kind"]) {
  switch (kind) {
    case "action.created":
      return { icon: Clock, tone: "text-accent bg-accent-soft" };
    case "action.approved":
      return { icon: ShieldCheck, tone: "text-success bg-success-soft" };
    case "action.executed":
      return { icon: Check, tone: "text-success bg-success-soft" };
    case "action.refused":
    case "action.expired":
      return { icon: Ban, tone: "text-muted bg-surface-2" };
    case "action.failed":
    case "error":
      return { icon: AlertTriangle, tone: "text-danger bg-danger-soft" };
    case "tool.call":
      return { icon: Play, tone: "text-info bg-info-soft" };
    case "tool.result":
      return { icon: Wrench, tone: "text-muted bg-surface-2" };
    case "secret.saved":
    case "secret.deleted":
      return { icon: KeyRound, tone: "text-warning bg-warning-soft" };
    case "connection.changed":
      return { icon: Plug, tone: "text-info bg-info-soft" };
    case "routine.run":
      return { icon: CalendarClock, tone: "text-info bg-info-soft" };
    default:
      return { icon: Cog, tone: "text-muted bg-surface-2" };
  }
}

export function Activity() {
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const audit = useQuery({ queryKey: ["audit", kind, q], queryFn: () => api.audit({ kind, q }) });

  const groups = useMemo(() => {
    const out: { day: string; items: AuditEvent[] }[] = [];
    for (const e of audit.data ?? []) {
      const day = fmtDay(e.ts);
      const g = out[out.length - 1];
      if (g?.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [audit.data]);

  return (
    <Page
      title="Activity"
      subtitle="Everything RelayIt read, prepared and did — with secrets redacted. This log never leaves your computer."
    >
      <div className="flex items-center justify-between gap-4 mb-6">
        <Segmented value={kind as (typeof FILTERS)[number]["value"]} onChange={setKind} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        <div className="relative w-[240px]">
          <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity" className="h-9 pl-9 text-[13px]" />
        </div>
      </div>

      {audit.data && audit.data.length === 0 && <EmptyState icon={<Wrench className="size-5" />} title="Nothing here yet" body="As RelayIt works, every tool call and approval is recorded here." />}

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted mb-2 sticky top-0 bg-bg/90 backdrop-blur py-2 z-10">{g.day}</h2>
            <div className="bg-surface border border-line rounded-[16px] shadow-sm divide-y divide-line overflow-hidden">
              {g.items.map((e) => (
                <Row key={e.id} e={e} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

function Row({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, tone } = iconFor(e.kind);
  const hasData = e.data != null && !(typeof e.data === "object" && Object.keys(e.data as object).length === 0);
  return (
    <div>
      <button onClick={() => hasData && setOpen((v) => !v)} className={cx("w-full flex items-center gap-3 px-4 py-2.5 text-left", hasData && "hover:bg-surface-2/50")}>
        <span className={cx("size-7 rounded-[8px] flex items-center justify-center shrink-0", tone)}>
          <Icon className="size-3.5" />
        </span>
        <span className="flex-1 min-w-0 text-[13.5px] truncate">{e.summary}</span>
        <ClassBadge value={e.toolClass} />
        <span className="w-[62px] text-right text-[12px] text-muted tnum shrink-0">{fmtTime(e.ts)}</span>
        <ChevronRight className={cx("size-3.5 text-faint transition-transform shrink-0", open && "rotate-90", !hasData && "invisible")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 pb-3 pl-14">
              <pre className="selectable text-[11.5px] leading-relaxed font-mono bg-surface-2 border border-line rounded-[10px] p-3 overflow-x-auto max-h-[320px] text-ink-2">{JSON.stringify(e.data, null, 2)}</pre>
              {e.conversationId && (
                <button onClick={() => navigate(`chat/${e.conversationId}`)} className="mt-2 text-[12px] text-accent-text hover:underline">
                  Open the chat
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
