import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Clock, X } from "lucide-react";
import { cx } from "../lib/format";

type Step = { label: string; tool: string; status: string };

function StepIcon({ status }: { status: string }) {
  if (status === "running")
    return (
      <span className="relative flex size-4 items-center justify-center">
        <span className="absolute size-2 rounded-full bg-accent animate-ping opacity-50" />
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
    );
  if (status === "waiting") return <Clock className="size-3.5 text-accent" />;
  if (status === "error") return <X className="size-3.5 text-danger" />;
  return <Check className="size-3.5 text-success" />;
}

/** The "how I got here" trail. Collapsed by default once finished; open while live. */
export function Steps({ steps, live }: { steps: Step[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const expanded = live || open;
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <div className="mb-2">
      {!live && (
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="group inline-flex items-center gap-1 min-h-[24px] text-[12.5px] text-muted hover:text-ink transition-colors">
          <ChevronRight className={cx("size-3.5 transition-transform", open && "rotate-90")} />
          {steps.length === 1 ? steps[0]!.label : `${done} of ${steps.length} steps`}
        </button>
      )}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cx("overflow-hidden relative", !live && "mt-1.5 ml-1.5")}
          >
            {steps.map((s, i) => (
              <motion.li
                key={`${s.tool}-${i}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="relative flex items-center gap-2.5 py-[3px] text-[12.5px]"
              >
                {i < steps.length - 1 && <span className="absolute left-[7.5px] top-[18px] h-[calc(100%-10px)] w-px bg-line-strong" />}
                <StepIcon status={s.status} />
                <span className={cx(s.status === "running" ? "shimmer font-medium" : "text-muted")}>{s.label}</span>
              </motion.li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
