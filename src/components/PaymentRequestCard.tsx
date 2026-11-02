import { QRCodeSVG } from "qrcode.react";
import { t } from "@/lib/i18n";
import { paymentRequest } from "@/lib/payment-request";

export function PaymentRequestCard({ name, output, ok }: { name: string; output?: string; ok?: boolean }) {
  const payment = ok === true ? paymentRequest(name, output) : null;
  if (!payment) return null;
  const demoCheckout = payment.demo && payment.checkoutUrl && new URL(payment.checkoutUrl).hostname === "127.0.0.1" ? payment.checkoutUrl : null;
  return <section className="mb-2 max-w-sm space-y-2 rounded-xl border border-hairline bg-panel p-4 text-ink" aria-label={t(payment.demo ? "india.payment.checkout" : "india.payment.title")}>
    <p className="font-semibold">{t(payment.demo ? "india.payment.checkout" : "india.payment.title")}</p>
    <p className="text-xl">{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(payment.amountInr)}</p>
    <p className="text-sm">{payment.payeeName} · {payment.payeeVpa}</p>
    <p className="text-xs text-ink-secondary">{t("india.payment.status", { status: t(`india.payment.status.${payment.status}`) })}</p>
    {payment.demo && <p className="text-sm">{t("india.payment.demo")}</p>}
    {payment.status === "pending" && (demoCheckout || !payment.demo) && <>
      <QRCodeSVG value={demoCheckout ?? payment.upiUri} size={180} marginSize={2} title={t(demoCheckout ? "india.payment.checkout" : "india.payment.qr")} />
      {!payment.demo && <a href={payment.upiUri} className="block text-sm text-accent underline">{t("india.payment.open")}</a>}
    </>}
    {payment.checkoutUrl && payment.status === "pending" && <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-accent underline">{t("india.payment.checkout")}</a>}
    <p className="text-xs text-ink-secondary">{t("india.payment.warning")}</p>
  </section>;
}
