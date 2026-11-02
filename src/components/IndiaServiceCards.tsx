import { useState } from "react";
import { INDIA_SERVICES } from "../../shared/india-services";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";

export function IndiaServiceCards({ names, disabled, add, reload }: {
  names: readonly string[];
  disabled: boolean;
  add(id: string): Promise<void>;
  reload(): Promise<void>;
}) {
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setSaving(true); setMessage("");
    try {
      await api("/api/mcp/builtins/payments/credentials", { method: "POST", body: JSON.stringify({ keyId, keySecret }) });
      setKeyId(""); setKeySecret(""); setMessage(t("india.payment.keysSaved"));
      await reload();
    } catch { setMessage(t("india.presets.failed")); }
    finally { setSaving(false); }
  }
  return <section className="mb-5" aria-label={t("india.builtins.title")}>
    <h4 className="mb-1 text-sm font-semibold text-ink">{t("india.builtins.title")}</h4>
    <p className="mb-2 text-xs text-ink-secondary">{t("india.builtins.description")}</p>
    <div className="flex flex-wrap gap-2">{INDIA_SERVICES.map((service) => <button key={service.id} type="button"
      disabled={disabled || names.includes(service.name)} onClick={() => void add(service.id)}
      className="rounded-lg border border-hairline bg-control px-3 py-2 text-xs text-ink disabled:opacity-40">
      {t(names.includes(service.name) ? "india.builtins.added" : "india.builtins.enable", { name: t(service.labelKey) })}
    </button>)}</div>
    {names.includes("india-payments") && <details className="mt-3 text-xs text-ink-secondary">
      <summary className="cursor-pointer">{t("india.payment.keys")}</summary>
      <p className="my-2">{t("india.payment.keysHint")}</p>
      <label className="block">{t("india.payment.keyId")}<input type="password" autoComplete="off" value={keyId} onChange={(event) => setKeyId(event.target.value)} className="m-1 rounded border border-hairline bg-inset p-2 text-ink" /></label>
      <label className="block">{t("india.payment.keySecret")}<input type="password" autoComplete="off" value={keySecret} onChange={(event) => setKeySecret(event.target.value)} className="m-1 rounded border border-hairline bg-inset p-2 text-ink" /></label>
      <button type="button" disabled={disabled || saving || !keyId || !keySecret} onClick={() => void save()} className="rounded bg-control px-3 py-2 text-ink disabled:opacity-40">{t("india.payment.saveKeys")}</button>
      {message && <p role="status" className="mt-2">{message}</p>}
    </details>}
  </section>;
}
