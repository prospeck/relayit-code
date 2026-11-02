import { useCallback, useEffect, useRef, useState } from "react";
import type { GoogleStatus } from "../../shared/google";
import { api } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { Card } from "./SettingsPrimitives";

const button = "rounded-lg bg-control px-3 py-2 text-[13px] text-ink disabled:opacity-40";
const field = "w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink";
const apiLinks = [
  { service: "Gmail", url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
  { service: "Google Calendar", url: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
];

function googleLink(url: string, host: string): string | null {
  try { const target = new URL(url); return target.protocol === "https:" && target.hostname === host && !target.username && !target.password ? target.href : null; }
  catch { return null; }
}

export function GoogleConnectionSettings() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [setup, setSetup] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const refresh = useCallback(async (check = false) => {
    try {
      const next = await api(check ? "/api/google/health" : "/api/google", check ? { method: "POST" } : undefined) as GoogleStatus;
      if (mounted.current) { setStatus(next); setError(next.error ?? ""); }
    } catch { if (mounted.current) setError("Could not check Google. Try again."); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => { mounted.current = false; };
  }, [refresh]);
  useEffect(() => {
    if (!status || (status.mode === "none" && !status.flow)) return;
    const timer = setInterval(() => void refresh(!status.flow), status.flow ? 1500 : status.connected ? 60_000 : 10_000);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const connect = async (fake = false) => {
    setBusy(true); setError("");
    try {
      const next = await api("/api/google/connect", { method: "POST", body: JSON.stringify(fake ? { fake: true } : {
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      }) }) as GoogleStatus;
      if (!mounted.current) return;
      setStatus(next); setClientId(""); setClientSecret(""); setSetup(false);
      setError(next.error ?? "");
      const url = next.flow && googleLink(next.flow.authorizationUrl, "accounts.google.com");
      if (url) await openExternalLink(url);
    } catch { if (mounted.current) setError("Could not start Google sign-in. Check your OAuth setup and try again."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { const next = await api("/api/google", { method: "DELETE" }) as GoogleStatus; if (mounted.current) { setStatus(next); setError(""); } }
    catch { if (mounted.current) setError("Could not disconnect Google. Try again."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const authLink = status?.flow && googleLink(status.flow.authorizationUrl, "accounts.google.com");
  return <Card title="Gmail and Google Calendar" subtitle="Connect directly to Google on this computer, or try an invented inbox without an account.">
    <div className="space-y-3 text-[13px] text-ink-secondary" data-google-connection>
      <p role="status">{status?.flow ? "Waiting for Google sign-in…" : status?.connected ? `Connected${status.mode === "fake" ? " · Demo inbox" : ""}${status.email ? ` · ${status.email}` : ""}` : status?.mode && status.mode !== "none" ? "Needs attention" : "Google is not connected"}</p>
      {error && <p role="alert">{error}</p>}
      {status?.issues.map((issue, i) => {
        const link = issue.actionUrl && googleLink(issue.actionUrl, "console.cloud.google.com");
        return <div key={`${issue.service}-${i}`}><p>{issue.message}</p>{link && <button className={button} onClick={() => void openExternalLink(link)}>Turn on {issue.service} API</button>}</div>;
      })}
      {authLink && <button className={button} onClick={() => void openExternalLink(authLink)}>Open Google sign-in</button>}
      <div className="flex flex-wrap gap-2">
        {!status?.flow && <button className={button} disabled={busy} onClick={() => status?.clientConfigured ? void connect() : setSetup(true)}>{status?.mode === "real" || status?.clientConfigured ? "Reconnect Google" : "Connect Google"}</button>}
        {status?.mode !== "none" && status && <button className={button} disabled={busy} onClick={() => void refresh(true)}>Re-check Google</button>}
        {!status?.flow && status?.mode !== "fake" && <button className={button} disabled={busy} onClick={() => void connect(true)}>Try a demo inbox</button>}
        {status && (status.mode !== "none" || status.flow) && <button className={button} disabled={busy} onClick={() => void disconnect()}>{status.flow ? "Cancel sign-in" : "Disconnect Google"}</button>}
        <button className={button} disabled={busy || !!status?.flow} onClick={() => setSetup(true)}>Google setup</button>
      </div>
      {setup && <div role="dialog" aria-label="Set up Google" aria-modal="false" className="space-y-3 rounded-xl bg-inset p-4">
        <p>Create an OAuth client in your Google Cloud project with application type <strong>Desktop app</strong>. If your app is in Testing, add your Google account as a test user.</p>
        <p>Turn on both APIs in that same project before signing in:</p>
        <div className="flex flex-wrap gap-2">{apiLinks.map(({ service, url }) => <button className={button} key={service} onClick={() => void openExternalLink(url)}>Turn on {service} API</button>)}</div>
        <p>On Google’s permission screen, <strong>tick every box</strong> for Gmail and Calendar. After sign-in, both APIs are checked before this app says Connected.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <label className="block">Client ID<input className={field} type="password" autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={status?.clientConfigured ? "Saved (leave blank to keep)" : "Desktop app OAuth client ID"} /></label>
          <label className="block">Client secret<input className={field} type="password" autoComplete="new-password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Optional, if your OAuth client has one" /></label>
          <button className={button} disabled={busy || (!clientId.trim() && !status?.clientConfigured)} type="submit">Sign in with Google</button>{" "}
          <button className={button} type="button" onClick={() => { setSetup(false); setClientId(""); setClientSecret(""); }}>Close setup</button>
        </form>
      </div>}
    </div>
  </Card>;
}
