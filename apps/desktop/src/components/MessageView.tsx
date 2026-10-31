import { memo } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Globe } from "lucide-react";
import type { Message, MessagePart, PendingAction } from "@relayit/shared";
import { Markdown } from "./Markdown";
import { Steps } from "./Steps";
import { ApprovalCard } from "./ApprovalCard";
import { PaymentCard } from "./PaymentCard";
import { LogoMark } from "./Logo";
import { openExternal } from "../lib/tauri";
import { cx, fmtTime } from "../lib/format";
import type { LiveRun } from "../lib/live";

export const MessageView = memo(function MessageView({
  message,
  actions,
  onChoice,
  isLast,
}: {
  message: Message;
  actions: Map<string, PendingAction>;
  onChoice?: (text: string) => void;
  isLast: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex justify-end">
        <div className="max-w-[78%] bg-surface-2 border border-line rounded-[18px] rounded-br-[6px] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap selectable">{text}</div>
      </motion.div>
    );
  }
  return (
    <div className="flex gap-3.5 group">
      <div className="pt-0.5 shrink-0">
        <LogoMark size={24} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {message.parts.map((p, i) => (
          <Part key={i} part={p} actions={actions} onChoice={isLast ? onChoice : undefined} />
        ))}
        {message.usage && (message.usage.inputTokens > 0 || message.usage.costInr) ? (
          <div className="text-[11px] text-faint opacity-0 group-hover:opacity-100 transition-opacity tnum">
            {fmtTime(message.createdAt)} · {(message.usage.inputTokens + message.usage.outputTokens).toLocaleString("en-IN")} tokens
            {message.usage.costInr != null && message.usage.costInr > 0 ? ` · ≈ ₹${message.usage.costInr < 0.01 ? "0.01" : message.usage.costInr.toFixed(2)}` : message.usage.costInr === 0 ? " · free" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function Part({ part, actions, onChoice }: { part: MessagePart; actions: Map<string, PendingAction>; onChoice?: (t: string) => void }) {
  switch (part.type) {
    case "text":
      return <Markdown text={part.text} />;
    case "steps":
      return <Steps steps={part.steps} />;
    case "action": {
      const a = actions.get(part.actionId);
      return a ? <ApprovalCard action={a} /> : null;
    }
    case "payment":
      return <PaymentCard part={part} />;
    case "choices":
      return (
        <div>
          {part.question && <div className="text-[12.5px] text-muted mb-2">{part.question}</div>}
          <div className="flex flex-wrap gap-2">
            {part.options.map((o) => (
              <motion.button
                key={o}
                whileTap={{ scale: 0.97 }}
                disabled={!onChoice}
                onClick={() => onChoice?.(o)}
                className={cx(
                  "h-8 px-3.5 rounded-full border text-[13px] font-medium transition-colors",
                  onChoice ? "border-line-strong bg-surface hover:border-accent/50 hover:bg-accent-softer hover:text-accent-text shadow-sm" : "border-line text-faint",
                )}
              >
                {o}
              </motion.button>
            ))}
          </div>
        </div>
      );
    case "link":
      return (
        <button onClick={() => void openExternal(part.url)} className="group/link max-w-[540px] w-full flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-left hover:border-line-strong hover:shadow-sm transition-all">
          <span className="size-9 rounded-[10px] bg-surface-2 flex items-center justify-center text-muted shrink-0">
            <Globe className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium truncate">{part.title}</span>
            <span className="block text-[12px] text-muted truncate">{part.subtitle ?? new URL(part.url).host}</span>
          </span>
          <ArrowUpRight className="size-4 text-muted group-hover/link:text-ink transition-colors" />
        </button>
      );
    case "sources":
      return (
        <div className="flex flex-wrap gap-1.5">
          {part.sources.map((s, i) => (
            <button key={i} onClick={() => void openExternal(s.url)} className="inline-flex items-center gap-1.5 h-7 max-w-[260px] px-2.5 rounded-full bg-surface-2 border border-line text-[12px] text-ink-2 hover:text-ink hover:border-line-strong">
              <span className="text-faint tnum">{i + 1}</span>
              <span className="truncate">{s.title || new URL(s.url).host}</span>
            </button>
          ))}
        </div>
      );
  }
}

/** The in-flight reply: live steps, streaming text and a shimmering status line. */
export function LiveRunView({ run, frame }: { run: LiveRun; frame?: { url: string; jpegBase64: string } | undefined }) {
  return (
    <div className="flex gap-3.5">
      <div className="pt-0.5 shrink-0">
        <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}>
          <LogoMark size={24} />
        </motion.div>
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {run.steps.length > 0 && <Steps steps={run.steps} live />}
        {frame && <BrowserPeek url={frame.url} jpeg={frame.jpegBase64} />}
        {run.text && <Markdown text={run.text} />}
        {run.active && <div className="text-[13px] shimmer font-medium h-5">{run.status || "Thinking…"}</div>}
      </div>
    </div>
  );
}

function BrowserPeek({ url, jpeg }: { url: string; jpeg: string }) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw */
  }
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-[420px] rounded-[14px] overflow-hidden border border-line shadow-md bg-surface">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-line bg-surface-2/60">
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
        <span className="text-[11.5px] text-muted truncate">{host}</span>
        <span className="ml-auto text-[10.5px] font-medium text-accent-text uppercase tracking-wider">Live</span>
      </div>
      <img src={`data:image/jpeg;base64,${jpeg}`} alt="What RelayIt sees in the browser" className="block w-full" />
    </motion.div>
  );
}
