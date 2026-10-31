import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, CreditCard, ExternalLink, Inbox, Key, Plus, RefreshCw, Search, Server, Terminal, Trash2 } from "lucide-react";
import type { McpServer, ToolClass } from "@relayit/shared";
import { api, ApiError } from "../lib/api";
import { cx } from "../lib/format";
import { openExternal } from "../lib/tauri";
import { Badge, Button, Card, Dialog, Field, Input, Page, SectionTitle, Segmented, ServiceMark, Switch } from "../components/ui";

export function Connections() {
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.servers, refetchInterval: 5000 });
  const presets = useQuery({ queryKey: ["presets"], queryFn: api.presets, staleTime: Infinity });
  const [adding, setAdding] = useState(false);
  const connectedUrls = new Set((servers.data ?? []).map((s) => s.url).filter(Boolean));

  return (
    <Page
      title="Connections"
      subtitle="The apps RelayIt can work with. Official connections come first; for anything else, the browser agent can step in — always asking before it submits."
      actions={
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          Add server
        </Button>
      }
    >
      <GoogleCard />

      <SectionTitle className="mt-10">Official connections</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {(presets.data ?? []).map((p) => (
          <PresetCard key={p.id} preset={p} added={connectedUrls.has(p.url)} />
        ))}
      </div>

      <SectionTitle className="mt-10">Connected</SectionTitle>
      <div className="space-y-2.5">
        {(servers.data ?? []).map((s) => (
          <ServerRow key={s.id} server={s} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-10">
        <PaymentsCard />
        <KeysCard />
      </div>

      <AddServerDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

/* ───────────── Google ───────────── */

function GoogleCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["google"], queryFn: api.google });
  const [setup, setSetup] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const connect = useMutation({
    mutationFn: api.connectGoogle,
    onSuccess: () => {
      setSetup(false);
      void qc.invalidateQueries({ queryKey: ["google"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const disconnect = useMutation({ mutationFn: api.disconnectGoogle, onSuccess: () => void qc.invalidateQueries({ queryKey: ["google"] }) });
  const triage = useMutation({ mutationFn: api.triage, onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }) });
  const s = status.data;

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="flex -space-x-1.5">
          <ServiceMark service="Gmail" size={36} />
          <ServiceMark service="Calendar" size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">Gmail & Google Calendar</h3>
            {s?.connected && <Badge tone="success">Connected</Badge>}
            {s?.mode === "fake" && <Badge tone="info">Demo inbox</Badge>}
          </div>
          <p className="text-[13px] text-muted mt-1 leading-relaxed">
            {s?.connected
              ? `Signed in as ${s.email ?? "your account"}. RelayIt sorts new mail into “needs you” and “can wait”, and drafts replies you approve.`
              : "Read and sort mail, draft replies, and see your day. RelayIt asks before sending anything or changing your calendar."}
          </p>
          {connect.error && <p className="text-[12.5px] text-danger mt-2">{connect.error instanceof ApiError ? connect.error.message : "Couldn't connect"}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {s?.connected ? (
            <>
              <Button size="sm" variant="ghost" icon={<Inbox className="size-3.5" />} loading={triage.isPending} onClick={() => triage.mutate()}>
                Sort inbox now
              </Button>
              <Button size="sm" variant="secondary" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => connect.mutate({ fake: true })} loading={connect.isPending && connect.variables?.fake}>
                Try a demo inbox
              </Button>
              <Button size="sm" variant="primary" onClick={() => (s?.clientConfigured ? connect.mutate({}) : setSetup(true))} loading={connect.isPending && !connect.variables?.fake}>
                Connect Google
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={setup} onOpenChange={setSetup} title="Connect your Google account" description="RelayIt talks to Google directly from this computer. You need an OAuth client once (it's free).">
        <ol className="text-[13px] text-ink-2 space-y-1.5 list-decimal pl-5 mb-5 leading-relaxed">
          <li>
            Open{" "}
            <button className="text-accent-text hover:underline" onClick={() => void openExternal("https://console.cloud.google.com/apis/credentials")}>
              Google Cloud → Credentials
            </button>
            , create an <b>OAuth client ID</b> of type <b>Desktop app</b>.
          </li>
          <li>Enable the Gmail API and Google Calendar API, and add yourself as a test user.</li>
          <li>Paste the client ID and secret below. They're stored encrypted.</li>
        </ol>
        <div className="space-y-3">
          <Field label="Client ID">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
          </Field>
          <Field label="Client secret">
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" onClick={() => setSetup(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!clientId.trim()} loading={connect.isPending} onClick={() => connect.mutate({ clientId, clientSecret })}>
            Continue in browser
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

/* ───────────── Presets ───────────── */

function PresetCard({ preset, added }: { preset: { id: string; name: string; url: string; domain: string; blurb: string }; added: boolean }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.addServer({ name: preset.name, transport: "http", url: preset.url, domain: preset.domain }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["servers"] }),
  });
  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-center gap-2.5">
        <ServiceMark service={preset.name} size={28} />
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{preset.name}</div>
          <div className="text-[11.5px] text-muted">Official</div>
        </div>
      </div>
      <p className="text-[12.5px] text-muted mt-2.5 leading-relaxed flex-1">{preset.blurb}</p>
      <Button size="sm" variant={added ? "ghost" : "secondary"} className="mt-3 self-start" disabled={added} loading={add.isPending} onClick={() => add.mutate()}>
        {added ? "Added" : "Connect"}
      </Button>
      {add.error && <p className="text-[12px] text-danger mt-2">{add.error instanceof ApiError ? add.error.message : "Couldn't add"}</p>}
    </Card>
  );
}

/* ───────────── Server rows ───────────── */

const STATUS: Record<McpServer["status"], { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-success" },
  connecting: { label: "Connecting…", dot: "bg-warning animate-pulse" },
  disconnected: { label: "Off", dot: "bg-faint" },
  error: { label: "Error", dot: "bg-danger" },
  needs_auth: { label: "Sign in needed", dot: "bg-accent animate-pulse" },
};

function ServerRow({ server }: { server: McpServer }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const inval = () => void qc.invalidateQueries({ queryKey: ["servers"] });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api.updateServer(server.id, { enabled }), onSuccess: inval });
  const reconnect = useMutation({ mutationFn: () => api.reconnectServer(server.id), onSuccess: inval });
  const remove = useMutation({ mutationFn: () => api.deleteServer(server.id), onSuccess: inval });
  const setTool = useMutation({
    mutationFn: (v: { tool: string; toolClass?: ToolClass; enabled?: boolean }) => api.setToolClass(server.id, v.tool, { ...(v.toolClass ? { toolClass: v.toolClass } : {}), ...(v.enabled !== undefined ? { enabled: v.enabled } : {}) }),
    onSuccess: inval,
  });
  const st = STATUS[server.status];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <ChevronRight className={cx("size-4 text-faint transition-transform", open && "rotate-90")} />
          <span className="size-8 rounded-[9px] bg-surface-2 border border-line flex items-center justify-center text-muted">
            {server.transport === "stdio" ? <Terminal className="size-4" /> : <Server className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-medium truncate">{server.name}</span>
              {server.builtin && <Badge>Built-in</Badge>}
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className={cx("size-1.5 rounded-full", st.dot)} />
              {st.label} · {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
              {server.error && server.status !== "connected" && <span className="text-danger truncate max-w-[280px]">· {server.error}</span>}
            </span>
          </span>
        </button>
        {(server.status === "needs_auth" || server.status === "error") && (
          <Button size="sm" variant={server.status === "needs_auth" ? "primary" : "ghost"} icon={<RefreshCw className="size-3.5" />} loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
            {server.status === "needs_auth" ? "Sign in" : "Retry"}
          </Button>
        )}
        <Switch checked={server.enabled} onCheckedChange={(v) => toggle.mutate(v)} label={`Enable ${server.name}`} />
        {!server.builtin && (
          <button onClick={() => remove.mutate()} className="text-faint hover:text-danger p-1" aria-label="Remove">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-line divide-y divide-line">
              {server.tools.length === 0 && <div className="px-5 py-4 text-[13px] text-muted">No tools yet — connect the server to see them.</div>}
              {server.tools.map((t) => (
                <div key={t.name} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className={cx("text-[13px] font-medium font-mono", !t.enabled && "text-faint line-through")}>{t.name}</div>
                    <div className="text-[12px] text-muted line-clamp-1">{t.description}</div>
                  </div>
                  <Segmented<ToolClass>
                    value={t.toolClass}
                    onChange={(v) => setTool.mutate({ tool: t.name, toolClass: v })}
                    options={[
                      { value: "read", label: "Read" },
                      { value: "prepare", label: "Prepare" },
                      { value: "act", label: "Act" },
                    ]}
                  />
                  <Switch checked={t.enabled} onCheckedChange={(v) => setTool.mutate({ tool: t.name, enabled: v })} label={`Enable ${t.name}`} />
                </div>
              ))}
              <div className="px-5 py-2.5 text-[11.5px] text-muted bg-surface-2/40">
                <b>Read</b> runs freely · <b>Prepare</b> drafts without side effects · <b>Act</b> always asks you first. New tools from other servers start as Act.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/* ───────────── Add server ───────────── */

function AddServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"http" | "stdio">("http");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const add = useMutation({
    mutationFn: () => {
      const parts = command.trim().split(/\s+/);
      const envSecrets = Object.fromEntries(
        env.split("\n").map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
      );
      return api.addServer(
        kind === "http"
          ? { name, transport: "http", url: url.trim() }
          : { name, transport: "stdio", command: parts[0]!, args: parts.slice(1), envSecrets },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["servers"] });
      onOpenChange(false);
      setName("");
      setUrl("");
      setCommand("");
      setEnv("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add an MCP server" description="Every tool from a new server starts as “Act”, so nothing runs without your OK until you reclassify it.">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "http", label: "Remote URL" },
          { value: "stdio", label: "Local command" },
        ]}
      />
      <div className="space-y-3 mt-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My CRM" />
        </Field>
        {kind === "http" ? (
          <Field label="Server URL" hint="Must be https. If it needs sign-in, your browser will open.">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </Field>
        ) : (
          <>
            <Field label="Command" hint="Runs on this computer. Only add servers you trust.">
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @someone/mcp-server" className="font-mono text-[13px]" />
            </Field>
            <Field label="Environment (one KEY=value per line)" hint="Stored encrypted, passed only to this server.">
              <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} className="w-full bg-surface border border-line-strong rounded-[11px] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-accent/60" />
            </Field>
          </>
        )}
      </div>
      {add.error && <p className="text-[12.5px] text-danger mt-3">{add.error instanceof ApiError ? add.error.message : "Couldn't add"}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" loading={add.isPending} disabled={!name.trim() || (kind === "http" ? !url.trim() : !command.trim())} onClick={() => add.mutate()}>
          Add server
        </Button>
      </div>
    </Dialog>
  );
}

/* ───────────── Payments & keys ───────────── */

function PaymentsCard() {
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const save = useMutation({ mutationFn: () => api.saveRazorpay(keyId, secret), onSuccess: () => setOpen(false) });
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5 mb-2">
        <CreditCard className="size-4 text-muted" />
        <h3 className="text-[14px] font-semibold">Payments</h3>
      </div>
      <p className="text-[12.5px] text-muted leading-relaxed">
        Orders are paid with a UPI QR in your own app. A test checkout page is built in; add Razorpay <b>test</b> keys to use Razorpay's sandbox instead. RelayIt never handles real money.
      </p>
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        Razorpay test keys
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Razorpay test mode" description="Only rzp_test_ keys are accepted.">
        <div className="space-y-3">
          <Field label="Key ID">
            <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_…" />
          </Field>
          <Field label="Key secret">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
        </div>
        {save.error && <p className="text-[12.5px] text-danger mt-3">{save.error instanceof ApiError ? save.error.message : "Couldn't save"}</p>}
        <div className="flex justify-end mt-5">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!keyId || !secret}>
            Save
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function KeysCard() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys, retry: false });
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => api.saveKey(editing!, value),
    onSuccess: () => {
      setEditing(null);
      setValue("");
      void qc.invalidateQueries({ queryKey: ["keys"] });
    },
  });
  const LABELS: Record<string, { label: string; hint: string; url: string }> = {
    exa: { label: "Exa (web research)", hint: "Lets RelayIt search the web with sources.", url: "https://dashboard.exa.ai/api-keys" },
    groq: { label: "Groq (voice)", hint: "Fast speech-to-text for push-to-talk.", url: "https://console.groq.com/keys" },
    openai: { label: "OpenAI (voice)", hint: "Speech-to-text, if you don't use Groq or local Whisper.", url: "https://platform.openai.com/api-keys" },
  };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5 mb-2">
        <Key className="size-4 text-muted" />
        <h3 className="text-[14px] font-semibold">Extra keys</h3>
      </div>
      <div className="divide-y divide-line">
        {Object.entries(LABELS).map(([k, l]) => (
          <div key={k} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium flex items-center gap-1.5">
                {l.label}
                <button onClick={() => void openExternal(l.url)} className="text-faint hover:text-ink" aria-label="Get a key">
                  <ExternalLink className="size-3" />
                </button>
              </div>
              <div className="text-[11.5px] text-muted">{l.hint}</div>
            </div>
            {keys.data?.[k] ? <Badge tone="success">Saved</Badge> : null}
            <Button size="sm" variant="ghost" onClick={() => setEditing(k)}>
              {keys.data?.[k] ? "Replace" : "Add"}
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing ? LABELS[editing]!.label : ""} description="Stored encrypted. It won't be shown again.">
        <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <div className="flex justify-end mt-5">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!value.trim()}>
            Save key
          </Button>
        </div>
      </Dialog>
      <div className="hidden">
        <Search />
      </div>
    </Card>
  );
}
