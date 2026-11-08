import { QRCodeSVG } from "qrcode.react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { paymentRequest } from "@/lib/payment-request";
import { amountParts } from "@/lib/relay";

/** The handoff: RelayIt never moves money, so a payment is a card you pay from in your own UPI app. The amount reads
 * as the approval card's did; the QR sits on white so any phone can scan it, by day or at night. */
export function PaymentRequestCard({ name, output, ok }: { name: string; output?: string; ok?: boolean }) {
  const payment = ok === true ? paymentRequest(name, output) : null;
  if (!payment) return null;
  const demoCheckout = payment.demo && payment.checkoutUrl && new URL(payment.checkoutUrl).hostname === "127.0.0.1" ? payment.checkoutUrl : null;
  const total = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(payment.amountInr);
  const { symbol, whole, fraction } = amountParts(total);
  const pending = payment.status === "pending";
  // Only a paid checkout is a receipt; "you marked this paid" stays as unverified as it is.
  const paid = payment.status === "paid";
  const qr = pending ? demoCheckout ?? (!payment.demo ? payment.upiUri : null) : null;
  return (
    <section data-payment-card={payment.status} className="mb-2 w-full max-w-[420px] rounded-3xl border border-hairline/60 bg-card p-5 text-ink"
      aria-label={t(payment.demo ? "india.payment.checkout" : "india.payment.title")}>
      <div className="flex items-center gap-2">
        <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5",
          paid ? "bg-success/15 text-success" : "bg-ink/[0.06] text-ink-secondary")}>
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", paid ? "bg-success" : pending ? "bg-accent" : "bg-ink-tertiary")} />
          {t(`india.payment.status.${payment.status}`)}
        </span>
        {payment.demo && <span className="text-[12px] text-ink-tertiary">{t("relay.payment.demo")}</span>}
      </div>
      <p className="mt-3 text-[15px] font-medium text-ink">{t(payment.demo ? "india.payment.checkout" : "india.payment.title")}</p>
      <p className="sr-only">{total}</p>
      <p aria-hidden="true" className="mt-1 flex items-baseline font-display font-semibold tabular-nums leading-none tracking-[-0.03em]">
        {symbol && <span className="mr-1 text-[22px]">{symbol}</span>}<span className="text-[38px]">{whole}</span>
        {fraction && <span className="text-[20px] text-ink-secondary">{fraction}</span>}
      </p>
      <p className="mt-1.5 text-[13px] text-ink-secondary">{t("relay.money.to", { name: payment.payeeName })} · <span className="font-mono text-[12px]">{payment.payeeVpa}</span></p>
      {qr && (
        <div className="mt-4 flex items-center gap-4">
          <div className="rounded-2xl bg-white p-2.5"><QRCodeSVG value={qr} size={148} marginSize={1} title={t(demoCheckout ? "india.payment.checkout" : "india.payment.qr")} /></div>
          <p className="text-[13px] leading-[19px] text-ink-secondary">{t(demoCheckout ? "relay.payment.scanDemo" : "relay.payment.scan")}</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {pending && !payment.demo && payment.upiUri && (
          <a href={payment.upiUri} className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[14px] font-semibold text-[color:var(--color-accent-ink)]">{t("india.payment.open")}</a>
        )}
        {pending && payment.checkoutUrl && (
          <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-hairline px-4 text-[14px] font-medium text-ink hover:bg-ink/[0.05]">
            {t("india.payment.checkout")}<ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <p className="mt-3 text-[12px] leading-[17px] text-ink-tertiary">{payment.demo ? t("india.payment.demo") : t("india.payment.warning")}</p>
    </section>
  );
}
