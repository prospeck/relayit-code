import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CornerDownLeft } from "lucide-react";
import { api } from "../lib/api";
import { useLive, startLive } from "../lib/live";
import { useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "../lib/tauri";
import { LogoMark } from "../components/Logo";
import { Markdown } from "../components/Markdown";

/** The floating Spotlight-style window (⌥Space). One line in, a compact answer out. */
export function QuickAsk() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [cid, setCid] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => startLive(qc), [qc]);
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const focus = () => input.current?.focus();
    window.addEventListener("focus", focus);
    focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const run = useLive((s) => (cid ? s.runs[cid] : undefined));
  const detail = useQuery({ queryKey: ["conversation", cid], queryFn: () => api.conversation(cid!), enabled: !!cid });
  const last = detail.data?.messages.filter((m) => m.role === "assistant").at(-1);
  const pendingAction = detail.data?.actions.find((a) => a.status === "pending");

  const send = useMutation({
    mutationFn: async (t: string) => {
      const c = cid ? { id: cid } : await api.createConversation();
      setCid(c.id);
      await api.send(c.id, t);
    },
  });

  // Size the floating window to its content: a single bar when idle, taller with an answer.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isTauri() || !card.current) return;
    const el = card.current;
    const ro = new ResizeObserver(() => {
      void (async () => {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setSize(new LogicalSize(720, Math.min(560, Math.ceil(el.offsetHeight) + 16)));
      })().catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const answer = run?.text || (last ? last.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n\n") : "");

  return (
    <div className="p-2">
      <div ref={card} className="max-h-[544px] flex flex-col bg-surface/95 backdrop-blur-xl border border-line-strong rounded-[22px] shadow-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-[60px] shrink-0">
          <LogoMark size={24} />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                send.mutate(text.trim());
                setText("");
              }
            }}
            placeholder="Ask RelayIt anything…"
            className="flex-1 bg-transparent outline-none text-[18px] placeholder:text-faint"
          />
          <CornerDownLeft className="size-4 text-faint" />
        </div>
        {(answer || run) && (
          <div className="border-t border-line px-5 py-4 overflow-y-auto min-h-0">
            {run?.active && !run.text && <div className="text-[13px] shimmer font-medium">{run.status}</div>}
            {answer && <Markdown text={answer} />}
            {pendingAction && <div className="mt-3 text-[13px] text-accent-text font-medium">Needs your OK: {pendingAction.title}</div>}
          </div>
        )}
        {cid && (
          <button
            onClick={() => void openMain(cid)}
            className="flex items-center justify-center gap-1.5 h-9 border-t border-line text-[12.5px] text-muted hover:text-ink shrink-0"
          >
            Open in RelayIt <ArrowUpRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

async function hide() {
  if (isTauri()) await invoke("hide_quick_ask");
}
async function openMain(cid: string) {
  if (isTauri()) await invoke("open_main", { path: `chat/${cid}` });
  else window.location.hash = `#/chat/${cid}`;
}
