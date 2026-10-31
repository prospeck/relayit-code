import { useMemo } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, Coffee, Mail, Package, Sparkles, Sunrise } from "lucide-react";
import { api } from "../lib/api";
import { cx, fmtTime, formatInr, relTime, timeOfDay } from "../lib/format";
import { navigate } from "../lib/router";
import { Composer } from "../components/Composer";
import { Button, Card, SectionTitle, ServiceMark } from "../components/ui";

const SUGGESTIONS: Record<string, string[]> = {
  morning: ["What needs me today?", "Summarise my unread mail", "Book a cab to work"],
  afternoon: ["Order lunch from Meghana Foods", "What's left on my calendar?", "Reply to my manager"],
  evening: ["Order something from California Pizza", "Plan tomorrow for me", "Find a train to Chennai on Friday"],
  night: ["What's on tomorrow?", "Order dessert from Corner House", "Set a routine for my morning brief"],
};

export function Today() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const pending = useQuery({ queryKey: ["actions", "pending"], queryFn: () => api.actions("pending") });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks, retry: false });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, retry: false, refetchInterval: 60_000 });

  const start = useMutation({
    mutationFn: async (text: string) => {
      const c = await api.createConversation();
      await api.send(c.id, text);
      return c;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`chat/${c.id}`);
    },
  });
  const brief = useMutation({
    mutationFn: () => api.brief(false),
    onSuccess: (r) => navigate(`chat/${r.conversationId}`),
  });

  const name = state.data?.profile?.name ?? "";
  const tod = timeOfDay();
  const greeting = tod === "night" ? "Good night" : `Good ${tod}`;
  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const needsYouTasks = (tasks.data ?? []).filter((t) => t.status === "needs_you");
  const working = (tasks.data ?? []).filter((t) => t.status === "working" || t.status === "review");
  const events = useMemo(() => today.data?.events ?? [], [today.data?.events]);
  const orders = useMemo(() => today.data?.orders ?? [], [today.data?.orders]);
  const needCount = (pending.data?.length ?? 0) + needsYouTasks.length;

  const summary = useMemo(() => {
    const bits: string[] = [];
    if (needCount) bits.push(`${needCount} thing${needCount === 1 ? "" : "s"} need${needCount === 1 ? "s" : ""} you`);
    const upcoming = events.filter((e) => new Date(e.end) > new Date());
    if (today.data?.calendarConnected) bits.push(upcoming.length ? `${upcoming.length} more event${upcoming.length === 1 ? "" : "s"} today` : "your calendar is clear");
    if (orders.length) bits.push(`${orders.length} order${orders.length === 1 ? "" : "s"} on the way`);
    return bits.length ? `${bits.join(" · ")}.` : "All quiet. What can I take off your plate?";
  }, [needCount, events, orders, today.data?.calendarConnected]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[920px] mx-auto px-10 pt-16 pb-20">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted mb-3">{dateLine}</div>
          <h1 className="font-display text-[52px] leading-[1] tracking-[-0.01em]">
            {greeting}
            {name && (
              <>
                , <span className="italic text-accent-text">{name}</span>
              </>
            )}
            .
          </h1>
          <p className="text-[15.5px] text-ink-2 mt-4">{summary}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }} className="mt-9">
          <Composer size="hero" autoFocus busy={start.isPending} onSend={(t) => start.mutate(t)} placeholder="Say it once… “Order something from California Pizza”" />
          <div className="flex flex-wrap gap-2 mt-3.5">
            {SUGGESTIONS[tod]!.map((s) => (
              <button
                key={s}
                onClick={() => start.mutate(s)}
                className="h-8 px-3.5 rounded-full border border-line bg-surface/70 text-[13px] text-ink-2 hover:text-ink hover:border-line-strong hover:bg-surface transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6 mt-14">
          <section>
            <SectionTitle
              action={
                <Button size="sm" variant="ghost" icon={<Sunrise className="size-3.5" />} onClick={() => brief.mutate()} loading={brief.isPending}>
                  Morning brief
                </Button>
              }
            >
              Needs you
            </SectionTitle>
            {needCount === 0 ? (
              <Card className="px-5 py-8 flex flex-col items-center text-center">
                <CheckCircle2 className="size-7 text-success mb-2.5" strokeWidth={1.6} />
                <div className="text-[14.5px] font-medium">Nothing needs you right now</div>
                <div className="text-[13px] text-muted mt-1">When something does, it shows up here first.</div>
              </Card>
            ) : (
              <div className="space-y-2">
                {(pending.data ?? []).map((a, i) => (
                  <motion.button
                    key={a.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => navigate(`chat/${a.conversationId}`)}
                    className="w-full group flex items-center gap-3.5 bg-surface border border-line rounded-[14px] px-4 py-3.5 text-left shadow-sm hover:border-line-strong hover:shadow-md transition-all"
                  >
                    <span className="relative">
                      <ServiceMark service={a.service} size={30} />
                      <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-medium truncate">{a.title}</span>
                      <span className="block text-[12.5px] text-muted truncate">Waiting for your OK · {relTime(a.createdAt)}</span>
                    </span>
                    {a.amountInr ? <span className="text-[15px] font-semibold tnum">{formatInr(a.amountInr)}</span> : null}
                    <ArrowRight className="size-4 text-faint group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
                  </motion.button>
                ))}
                {needsYouTasks.slice(0, 6).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate("tasks")}
                    className="w-full flex items-start gap-3.5 bg-surface border border-line rounded-[14px] px-4 py-3.5 text-left shadow-sm hover:border-line-strong transition-all"
                  >
                    <span className="size-[30px] rounded-[8px] bg-surface-2 border border-line flex items-center justify-center text-muted shrink-0">
                      <Mail className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-medium truncate">{t.title}</span>
                      <span className="block text-[12.5px] text-muted line-clamp-1">{t.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {working.length > 0 && (
              <div className="mt-8">
                <SectionTitle>In progress</SectionTitle>
                <div className="space-y-1.5">
                  {working.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-1 py-1.5 text-[13.5px]">
                      <span className={cx("size-1.5 rounded-full", t.status === "working" ? "bg-accent animate-pulse" : "bg-info")} />
                      <span className="flex-1 truncate">{t.title}</span>
                      <span className="text-[12px] text-muted">{t.status === "review" ? "Ready for review" : "Working"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-8">
            <div>
              <SectionTitle>Today</SectionTitle>
              {!today.data?.calendarConnected ? (
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="size-9 rounded-[10px] bg-info-soft text-info flex items-center justify-center">
                      <CalendarDays className="size-[18px]" />
                    </span>
                    <div className="flex-1">
                      <div className="text-[13.5px] font-medium">Connect your calendar</div>
                      <div className="text-[12.5px] text-muted">See your day here and let RelayIt plan around it.</div>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="mt-4 w-full" onClick={() => navigate("connections")}>
                    Connect Google
                  </Button>
                </Card>
              ) : events.length === 0 ? (
                <Card className="px-5 py-6 flex items-center gap-3 text-[13.5px] text-muted">
                  <Coffee className="size-5" strokeWidth={1.6} /> No events today. Enjoy the space.
                </Card>
              ) : (
                <Card className="p-2">
                  {events.map((e) => {
                    const now = new Date();
                    const live = new Date(e.start) <= now && new Date(e.end) > now;
                    const past = new Date(e.end) <= now;
                    return (
                      <div key={e.id} className={cx("flex gap-3 px-3 py-2.5 rounded-[10px]", live && "bg-accent-softer")}>
                        <div className={cx("w-[62px] shrink-0 text-[12.5px] tnum pt-px", past ? "text-faint" : "text-muted")}>{fmtTime(e.start)}</div>
                        <div className={cx("w-[3px] rounded-full shrink-0", live ? "bg-accent" : past ? "bg-line-strong" : "bg-info/60")} />
                        <div className="min-w-0">
                          <div className={cx("text-[13.5px] font-medium truncate", past && "text-muted line-through decoration-faint")}>{e.title}</div>
                          {e.location && <div className="text-[12px] text-muted truncate">{e.location}</div>}
                        </div>
                      </div>
                    );
                  })}
                </Card>
              )}
            </div>

            {orders.length > 0 && (
              <div>
                <SectionTitle>Orders</SectionTitle>
                <Card className="divide-y divide-line">
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 px-4 py-3">
                      <Package className="size-4 text-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium truncate">{o.title}</div>
                        <div className="text-[12px] text-muted capitalize">{o.status.replace(/_/g, " ")}</div>
                      </div>
                      <span className="text-[13.5px] font-semibold tnum">{formatInr(o.amountInr)}</span>
                    </div>
                  ))}
                </Card>
              </div>
            )}

            <Card className="p-5 bg-gradient-to-br from-accent-softer to-transparent">
              <div className="flex items-start gap-3">
                <Sparkles className="size-[18px] text-accent mt-0.5" />
                <div>
                  <div className="text-[13.5px] font-medium">Try a skill</div>
                  <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed">
                    Type <span className="font-medium text-accent-text">/order-food</span>, <span className="font-medium text-accent-text">/plan-trip</span> or{" "}
                    <span className="font-medium text-accent-text">/reply-to-email</span> in any chat.
                  </div>
                </div>
              </div>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
