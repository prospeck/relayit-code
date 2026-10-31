import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, CalendarClock, Home, ListChecks, MessageCircle, Plug, Settings, SquarePen, Wand2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { cx } from "../lib/format";
import { modKey, platform } from "../lib/tauri";
import { useLive } from "../lib/live";
import { Wordmark } from "./Logo";
import { Tooltip } from "./ui";

const NAV = [
  { id: "today", label: "Today", icon: Home },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "skills", label: "Skills", icon: Wand2 },
  { id: "routines", label: "Routines", icon: CalendarClock },
];

export function Sidebar() {
  const route = useRoute();
  const qc = useQueryClient();
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const pending = useQuery({ queryKey: ["actions", "pending"], queryFn: () => api.actions("pending") });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const runs = useLive((s) => s.runs);
  const connected = useLive((s) => s.connected);
  const newChat = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`chat/${c.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteConversation,
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (route.param === id) navigate("today");
    },
  });

  const needsYou = (pending.data?.length ?? 0) + (tasks.data?.filter((t) => t.status === "needs_you").length ?? 0);
  const chats = (conversations.data ?? []).filter((c) => c.kind === "chat").slice(0, 30);
  const mac = platform() === "mac";

  return (
    <aside className="w-[244px] shrink-0 h-full flex flex-col bg-sidebar border-r border-line">
      <div className={cx("drag flex items-center justify-between px-4", mac ? "h-[52px] pl-[84px]" : "h-[48px]")}>
        {!mac && <Wordmark />}
        {mac && <span />}
        <Tooltip label={`New chat (${modKey()}N)`} side="bottom">
          <button
            onClick={() => newChat.mutate()}
            className="no-drag size-8 rounded-[9px] flex items-center justify-center text-muted hover:text-ink hover:bg-surface-3/70 transition-colors"
            aria-label="New chat"
          >
            <SquarePen className="size-[17px]" />
          </button>
        </Tooltip>
      </div>

      {mac && (
        <div className="px-4 pb-3 -mt-1">
          <Wordmark />
        </div>
      )}

      <nav className="px-2.5 space-y-px">
        {NAV.map((n) => {
          const active = route.screen === n.id;
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              onClick={() => navigate(n.id === "chat" && chats[0] ? `chat/${chats[0].id}` : n.id)}
              className={cx(
                "relative w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[9px] text-[13.5px] transition-colors",
                active ? "text-ink font-medium" : "text-ink-2 hover:bg-surface-3/60 hover:text-ink",
              )}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[9px] bg-surface shadow-sm border border-line" transition={{ type: "spring", bounce: 0.12, duration: 0.35 }} />}
              <Icon className={cx("relative size-[16px]", active ? "text-accent" : "text-muted")} strokeWidth={active ? 2.2 : 1.9} />
              <span className="relative">{n.label}</span>
              {n.id === "today" && needsYou > 0 && (
                <span className="relative ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-on-accent text-[11px] font-semibold flex items-center justify-center tnum">{needsYou}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-5 px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Recent</div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-px">
        {chats.length === 0 && <p className="px-2.5 py-2 text-[12.5px] text-faint">Your chats will appear here.</p>}
        {chats.map((c) => {
          const active = route.screen === "chat" && route.param === c.id;
          const live = !!runs[c.id];
          return (
            <div key={c.id} className="group relative">
              <button
                onClick={() => navigate(`chat/${c.id}`)}
                className={cx(
                  "w-full flex items-center gap-2 h-8 pl-2.5 pr-8 rounded-[9px] text-[13px] text-left transition-colors",
                  active ? "bg-surface-3/80 text-ink font-medium" : "text-ink-2 hover:bg-surface-3/50",
                )}
              >
                {live && <span className="size-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
                <span className="truncate">{c.title}</span>
              </button>
              <button
                onClick={() => remove.mutate(c.id)}
                aria-label="Delete chat"
                className="absolute right-1.5 top-1.5 size-5 rounded-[6px] items-center justify-center text-faint hover:text-danger hidden group-hover:flex"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="p-2.5 border-t border-line">
        <button
          onClick={() => navigate("settings")}
          className={cx(
            "w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[9px] text-[13.5px] transition-colors",
            route.screen === "settings" ? "bg-surface text-ink font-medium shadow-sm border border-line" : "text-ink-2 hover:bg-surface-3/60",
          )}
        >
          <Settings className="size-[16px] text-muted" />
          Settings
          <Tooltip label={connected ? "Engine connected" : "Reconnecting to the engine…"}>
            <span className={cx("ml-auto size-1.5 rounded-full", connected ? "bg-success" : "bg-warning animate-pulse")} />
          </Tooltip>
        </button>
      </div>
    </aside>
  );
}
