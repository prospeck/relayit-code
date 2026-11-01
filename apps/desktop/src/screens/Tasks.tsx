import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  CheckCircle2,
  Inbox,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Task, TaskStatus } from "@relayit/shared";
import { api } from "../lib/api";
import { cx, relTime } from "../lib/format";
import { navigate } from "../lib/router";
import { Button, ServiceMark } from "../components/ui";
import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

function CanWait() {
  const q = useQuery({ queryKey: ["tasks", "can-wait"], queryFn: api.canWait, retry: false });
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <div className="pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 px-1.5 min-h-[24px] text-[12px] font-medium text-muted hover:text-ink"
      >
        <ChevronRight className={cx("size-3.5 transition-transform", open && "rotate-90")} />
        Can wait · {items.length}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {items.map((m) => (
            <div key={m.threadId} className="px-2.5 py-2 rounded-[10px] hover:bg-surface/70">
              <div className="text-[12.5px] text-ink-2 truncate">{m.subject || "(no subject)"}</div>
              <div className="text-[11.5px] text-faint truncate">
                {m.from} — {m.reason}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMNS: { id: TaskStatus; title: string; empty: string; tone: string }[] = [
  { id: "needs_you", title: "Needs you", empty: "Nothing waiting on you.", tone: "bg-accent" },
  { id: "working", title: "Working", empty: "RelayIt isn't working on anything.", tone: "bg-info" },
  { id: "review", title: "Ready for review", empty: "Nothing to review.", tone: "bg-warning" },
  { id: "done", title: "Done", empty: "Finished work lands here.", tone: "bg-success" },
];

export function Tasks() {
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const google = useQuery({ queryKey: ["google"], queryFn: api.google, retry: false });
  const triage = useMutation({
    mutationFn: api.triage,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const all = tasks.data ?? [];

  return (
    <div className="h-full flex flex-col">
      <div className="px-10 pt-14 pb-6 flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-[34px] leading-[1.1]">Tasks</h1>
          <p className="text-muted text-[14px] mt-2">
            What needs you, what RelayIt is doing, and what's done.
          </p>
        </div>
        {google.data?.connected && (
          <Button
            variant="secondary"
            icon={<Inbox className="size-4" />}
            loading={triage.isPending}
            onClick={() => triage.mutate()}
          >
            Sort inbox
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 min-[1200px]:grid-cols-4 gap-4 px-10 pb-8 overflow-y-auto">
        {COLUMNS.map((col) => {
          const items = all
            .filter((t) => t.status === col.id)
            .slice(0, col.id === "done" ? 40 : 100);
          return (
            <section
              key={col.id}
              className="min-h-[280px] min-w-0 flex flex-col rounded-[18px] bg-surface-2/50 border border-line"
            >
              <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
                <span className={cx("size-2 rounded-full", col.tone)} />
                <h2 className="text-[13px] font-semibold">{col.title}</h2>
                <span className="text-[12px] text-muted tnum">
                  {all.filter((t) => t.status === col.id).length}
                </span>
              </header>
              <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-2">
                <AnimatePresence initial={false}>
                  {items.map((t) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                </AnimatePresence>
                {items.length === 0 && (
                  <p className="text-[12.5px] text-faint px-2 py-3">{col.empty}</p>
                )}
                {col.id === "needs_you" && <CanWait />}
                {col.id === "needs_you" && items.length === 0 && !google.data?.connected && (
                  <button
                    onClick={() => navigate("connections")}
                    className="w-full text-left text-[12.5px] text-accent-text px-2 hover:underline"
                  >
                    Connect Gmail to sort your inbox here →
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (s: TaskStatus) => api.setTask(task.id, s),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const help = useMutation({
    mutationFn: async () => {
      if (task.conversationId) return { id: task.conversationId };
      const c = await api.createConversation();
      const prompt =
        task.source === "Gmail"
          ? `/reply-to-email Help me with the email “${task.title}” (${task.detail}).`
          : `Help me with: ${task.title}`;
      await api.send(c.id, prompt);
      return c;
    },
    onSuccess: (c) => navigate(`chat/${c.id}`),
  });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cx(
        "group bg-surface border border-line rounded-[13px] p-3.5 shadow-sm hover:shadow-md hover:border-line-strong transition-all",
        task.status === "done" && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <ServiceMark service={task.source} size={20} />
        <div className="min-w-0 flex-1">
          <div
            className={cx(
              "text-[13.5px] font-medium leading-snug line-clamp-2",
              task.status === "done" && "line-through decoration-faint",
            )}
          >
            {task.title}
          </div>
          <div className="text-[12px] text-muted mt-1 line-clamp-2 leading-relaxed">
            {task.detail}
          </div>
          <div className="text-[11px] text-faint mt-1.5">{relTime(task.updatedAt)}</div>
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-muted hover:text-ink size-[28px] p-1 inline-flex items-center justify-center rounded-[6px]"
              aria-label={`Actions for ${task.title}`}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={4}
              className="z-50 w-44 bg-surface border border-line-strong rounded-[12px] shadow-lg p-1"
            >
              {(["needs_you", "working", "review", "done"] as TaskStatus[])
                .filter((s) => s !== task.status)
                .map((s) => (
                  <Popover.Close key={s} asChild>
                    <button
                      onClick={() => set.mutate(s)}
                      className="w-full text-left text-[13px] px-2.5 h-8 rounded-[8px] hover:bg-surface-2"
                    >
                      Move to {COLUMNS.find((c) => c.id === s)!.title}
                    </button>
                  </Popover.Close>
                ))}
              <Popover.Close asChild>
                <button
                  onClick={() => del.mutate()}
                  className="w-full flex items-center gap-2 text-left text-[13px] px-2.5 h-8 rounded-[8px] hover:bg-danger-soft text-danger"
                >
                  <Trash2 className="size-3.5" /> Delete
                </button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {task.status !== "done" && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Button
            size="sm"
            variant="quiet"
            icon={
              task.conversationId ? (
                <MessageCircle className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )
            }
            loading={help.isPending}
            onClick={() => help.mutate()}
          >
            {task.conversationId ? "Open" : "Handle it"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Check className="size-3.5" />}
            onClick={() => set.mutate("done")}
          >
            Done
          </Button>
        </div>
      )}
      {task.status === "done" && <CheckCircle2 className="hidden" />}
    </motion.div>
  );
}
