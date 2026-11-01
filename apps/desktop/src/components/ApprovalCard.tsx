import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Clock, ShieldCheck, Sparkles } from "lucide-react";
import type { PendingAction } from "@relayit/shared";
import { api, ApiError } from "../lib/api";
import { cx, fmtTime, formatInr, untilLabel } from "../lib/format";
import { navigate } from "../lib/router";
import { Button, ServiceMark, Tooltip } from "./ui";

/**
 * The approval "receipt". It must answer three questions at a glance:
 * what will happen, to whom, and how much.
 */
export function ApprovalCard({ action, compact }: { action: PendingAction; compact?: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (action.status !== "pending") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [action.status]);

  const decide = useMutation({
    mutationFn: async (d: "once" | "always" | "refuse") => (d === "refuse" ? api.refuse(action.id) : api.approve(action.id, d)),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["actions"] });
      void qc.invalidateQueries({ queryKey: ["conversation", action.conversationId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Something went wrong"),
  });

  const titleId = useId();
  const pending = action.status === "pending";
  const overCap = action.involvesMoney && action.amountInr != null && action.spendCapInr != null && action.amountInr > action.spendCapInr;
  const hasAmount = action.amountInr != null && action.amountInr > 0;

  if (!pending) return <ResolvedReceipt action={action} />;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      role="region"
      aria-labelledby={titleId}
      className={cx(
        "relative bg-surface border border-line rounded-[20px] shadow-md overflow-hidden",
        compact ? "max-w-[480px]" : "max-w-[540px]",
      )}
    >
      {/* Ember edge: the only loud thing on the card, telling you it's waiting on you. */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-accent/0 via-accent to-accent/0" />

      <div className="px-6 pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ServiceMark service={action.service} size={20} />
            <span className="text-[12.5px] font-medium text-ink-2">{action.service}</span>
            <span className="text-faint">·</span>
            <span className="text-[12.5px] font-medium text-accent-text">Needs your OK</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted tnum">
            <Clock className="size-3" />
            {untilLabel(action.expiresAt)}
          </span>
        </div>

        <h2 id={titleId} className="text-[19px] leading-snug font-semibold tracking-[-0.015em] text-ink break-words">{action.title}</h2>
        {action.recipient && !hasAmount && <p className="text-[13.5px] text-muted mt-1">to {action.recipient}</p>}

        {hasAmount && (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 max-w-full">
              <div className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-muted mb-1">You'll pay</div>
              <div className="text-[clamp(30px,4.2vw,46px)] leading-none font-semibold tracking-[-0.035em] tnum text-ink break-words">{formatInr(action.amountInr!)}</div>
            </div>
            {action.recipient && (
              <div className="text-right text-[13px] text-muted pb-1 min-w-0 max-w-full" style={{ overflowWrap: "anywhere" }}>
                to <span className="text-ink font-medium">{action.recipient}</span>
              </div>
            )}
          </div>
        )}
        <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">{action.summary}</p>
      </div>

      {action.details.length > 0 && (
        <>
          <div className="perforation mx-0" />
          <dl className="px-6 py-4 space-y-2 bg-surface-2/40">
            {action.details.map((d, i) =>
              d.value.length > 70 || d.value.includes("\n") ? (
                <div key={i} className="text-[13px] pt-1">
                  <dt className="text-muted mb-1.5">{d.label}</dt>
                  <dd tabIndex={0} aria-label={`${d.label}: ${d.value}`} className="selectable whitespace-pre-wrap text-ink-2 leading-relaxed bg-surface border border-line rounded-[10px] px-3.5 py-2.5 max-h-[180px] overflow-y-auto">{d.value}</dd>
                </div>
              ) : (
                <div key={i} className="flex items-baseline gap-2 text-[13px]">
                  <dt className="text-muted shrink-0 flex-1 flex items-baseline after:content-[''] after:flex-1 after:min-w-3 after:ml-2 after:border-b after:border-dotted after:border-line-strong">{d.label}</dt>
                  <dd className="text-ink text-right selectable min-w-0 max-w-[70%] break-words" style={{ overflowWrap: "anywhere" }}>{d.value}</dd>
                </div>
              ),
            )}
          </dl>
        </>
      )}

      {(action.tainted || overCap || action.involvesMoney) && (
        <div className="px-6 pt-3 space-y-2">
          {overCap && (
            <Notice tone="danger" icon={<AlertTriangle className="size-3.5" />}>
              This is above your {formatInr(action.spendCapInr!)} per-action limit.{" "}
              <button className="underline underline-offset-2" onClick={() => navigate("settings/approvals")}>
                Change limit
              </button>
            </Notice>
          )}
          {action.tainted && (
            <Notice tone="warning" icon={<ShieldCheck className="size-3.5" />}>
              RelayIt read outside content (like an email or web page) during this task, so automatic approval is off. Check the details above.
            </Notice>
          )}
          {action.involvesMoney && !overCap && (
            <Notice tone="neutral" icon={<ShieldCheck className="size-3.5" />}>
              RelayIt never pays for you. You'll finish payment in your own UPI app.
            </Notice>
          )}
        </div>
      )}

      <div className="px-6 py-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => decide.mutate("refuse")} disabled={decide.isPending}>
          Refuse
        </Button>
        <div className="flex-1" />
        {action.involvesMoney ? (
          <Tooltip label="Anything involving money always asks you first.">
            <span>
              <Button variant="secondary" disabled>
                Always allow
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Button variant="secondary" onClick={() => decide.mutate("always")} disabled={decide.isPending}>
            Always allow
          </Button>
        )}
        {action.involvesMoney ? (
          <HoldButton disabled={overCap || decide.isPending} onConfirm={() => decide.mutate("once")} label={hasAmount ? `Hold to approve ${formatInr(action.amountInr!)}` : "Hold to approve"} />
        ) : (
          <Button variant="primary" icon={<Check className="size-4" />} onClick={() => decide.mutate("once")} loading={decide.isPending && decide.variables === "once"} disabled={decide.isPending}>
            Allow once
          </Button>
        )}
      </div>
      <AnimatePresence>
        {error && (
          <motion.p role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="px-6 pb-4 -mt-1 text-[12.5px] text-danger">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Notice({ tone, icon, children }: { tone: "warning" | "danger" | "neutral"; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = { warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", neutral: "bg-surface-2 text-muted" };
  return (
    <div className={cx("flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-relaxed", tones[tone])}>
      <span className="mt-[3px] shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/** Press-and-hold confirm for money, so it can't happen by accident. Enter/Space also work (held). */
function HoldButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(0);
  const fired = useRef(false);
  const DURATION = 750;

  const cancel = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!fired.current) setProgress(0);
  };
  const begin = () => {
    if (disabled || raf.current !== null) return;
    fired.current = false;
    start.current = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start.current) / DURATION);
      setProgress(p);
      if (p >= 1 && !fired.current) {
        fired.current = true;
        raf.current = null;
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  // Never let a hold continue after the button is disabled, loses focus or unmounts.
  useEffect(() => {
    if (disabled) cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  return (
    <button
      disabled={disabled}
      aria-label={`${label} — press and hold`}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat) begin();
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cancel();
        }
      }}
      className="relative min-h-9 h-auto py-2 px-4 max-w-full rounded-[11px] overflow-hidden bg-accent text-on-accent text-[13.5px] font-medium disabled:opacity-45 select-none shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.12)] active:scale-[0.98] transition-transform"
    >
      <span className="absolute inset-y-0 left-0 bg-black/15" style={{ width: `${progress * 100}%` }} />
      <span className="relative inline-flex items-center gap-2 whitespace-normal">
        <Sparkles className="size-4 shrink-0" />
        {progress >= 1 ? "Approved" : label}
      </span>
    </button>
  );
}

function ResolvedReceipt({ action }: { action: PendingAction }) {
  const map = {
    approved: { label: "Approved", tone: "text-success", icon: <Check className="size-3.5" /> },
    executed: { label: "Done", tone: "text-success", icon: <Check className="size-3.5" /> },
    refused: { label: "Refused", tone: "text-muted", icon: <Ban className="size-3.5" /> },
    expired: { label: "Expired", tone: "text-muted", icon: <Clock className="size-3.5" /> },
    failed: { label: "Failed", tone: "text-danger", icon: <AlertTriangle className="size-3.5" /> },
    pending: { label: "", tone: "", icon: null },
  } as const;
  const s = map[action.status];
  return (
    <motion.div layout initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="max-w-[540px] flex items-center gap-3 rounded-[14px] border border-line bg-surface/60 px-4 py-3">
      <ServiceMark service={action.service} size={18} />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium truncate">{action.title}</div>
        {action.status === "failed" && !!action.result && typeof action.result === "object" && "error" in (action.result as object) && (
          <div className="text-[12px] text-danger truncate">{String((action.result as { error: unknown }).error)}</div>
        )}
      </div>
      {action.amountInr ? <span className="text-[13.5px] font-semibold tnum">{formatInr(action.amountInr)}</span> : null}
      <span className={cx("inline-flex items-center gap-1 text-[12px] font-medium", s.tone)}>
        {s.icon}
        {s.label}
        {action.resolvedAt && <span className="text-faint font-normal ml-1">{fmtTime(action.resolvedAt)}</span>}
      </span>
    </motion.div>
  );
}
