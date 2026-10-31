import { useState } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, ExternalLink, Smartphone } from "lucide-react";
import type { MessagePart } from "@relayit/shared";
import { api } from "../lib/api";
import { formatInr, cx } from "../lib/format";
import { openExternal } from "../lib/tauri";
import { Button, Input } from "./ui";

type Payment = Extract<MessagePart, { type: "payment" }>;

/** UPI hand-off: the user pays in their own app. We only show the QR and track status. */
export function PaymentCard({ part }: { part: Payment }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["payment", part.orderId],
    queryFn: () => api.payment(part.orderId),
    refetchInterval: (q) => (q.state.data && ["paid", "user_confirmed", "cancelled", "expired"].includes(q.state.data.status) ? false : 4000),
  });
  const [confirming, setConfirming] = useState(false);
  const [utr, setUtr] = useState("");
  const confirm = useMutation({
    mutationFn: () => api.confirmUpiPaid(part.orderId, utr || undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["payment", part.orderId] }),
  });
  const s = status.data?.status ?? "pending";
  const paid = s === "paid" || s === "user_confirmed";

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="max-w-[540px] bg-surface border border-line rounded-[20px] shadow-md overflow-hidden">
      <div className="flex gap-5 p-5">
        <div className={cx("relative shrink-0 size-[152px] rounded-[14px] bg-white p-2.5 border border-line", paid && "opacity-30")}>
          <div className="size-full [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: part.qrSvg }} />
          {paid && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="size-14 rounded-full bg-success text-white flex items-center justify-center shadow-lg">
                <Check className="size-7" />
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-muted">{paid ? "Paid" : "Scan to pay with any UPI app"}</div>
          <div className="text-[38px] leading-none font-semibold tracking-[-0.03em] tnum mt-2">{formatInr(part.amountInr)}</div>
          <div className="text-[13px] text-muted mt-1.5 truncate">to {part.payee}</div>
          <div className="mt-auto pt-3 flex flex-wrap gap-2">
            {!paid && (
              <>
                <Button size="sm" variant="primary" icon={<Smartphone className="size-3.5" />} onClick={() => void openExternal(part.upiUri)}>
                  Open UPI app
                </Button>
                {part.checkoutUrl && (
                  <Button size="sm" variant="secondary" icon={<CreditCard className="size-3.5" />} onClick={() => void openExternal(part.checkoutUrl!)}>
                    Card / netbanking
                    <ExternalLink className="size-3 text-muted" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-line px-5 py-3 flex items-center gap-3 bg-surface-2/40">
        <StatusDot status={s} />
        <span className="text-[12.5px] text-ink-2 flex-1">
          {s === "paid" ? "Payment received. Your order is confirmed." : s === "user_confirmed" ? "Marked as paid. Thanks!" : s === "cancelled" ? "Payment cancelled." : s === "expired" ? "This payment request expired." : "Waiting for your payment…"}
        </span>
        {!paid && s === "pending" && !confirming && (
          <button className="text-[12.5px] font-medium text-accent-text hover:underline" onClick={() => setConfirming(true)}>
            I've paid
          </button>
        )}
      </div>
      {confirming && !paid && (
        <div className="px-5 pb-4 pt-1 flex gap-2 bg-surface-2/40">
          <Input value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="UPI reference / UTR (optional)" className="h-9 text-[13px]" />
          <Button size="md" variant="primary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
            Confirm
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "paid" || status === "user_confirmed") return <span className="size-2 rounded-full bg-success" />;
  if (status === "pending")
    return (
      <span className="relative flex size-2">
        <span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-60" />
        <span className="relative size-2 rounded-full bg-accent" />
      </span>
    );
  return <span className="size-2 rounded-full bg-faint" />;
}
