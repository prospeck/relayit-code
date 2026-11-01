import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Check,
  Home,
  KeyRound,
  Lock,
  MapPin,
  Plus,
  ShieldCheck,
  Trash2,
  User,
  Bell,
  Info,
  Globe,
} from "lucide-react";
import type { Address, MemoryFact, ProviderId } from "@relayit/shared";
import { api, ApiError } from "../lib/api";
import { cx, formatInr, relTime } from "../lib/format";
import { navigate, useRoute } from "../lib/router";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Page,
  Select,
  ServiceMark,
  Switch,
  Textarea,
} from "../components/ui";
import { PROVIDERS } from "./Onboarding";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "model", label: "Model", icon: Brain },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "memory", label: "What RelayIt knows", icon: MapPin },
  { id: "notifications", label: "Brief & alerts", icon: Bell },
  { id: "browser", label: "Browser agent", icon: Globe },
  { id: "about", label: "Privacy & data", icon: Info },
];

export function Settings() {
  const route = useRoute();
  const section = route.param ?? "profile";
  return (
    <div className="h-full flex">
      <nav aria-label="Settings" className="w-[220px] shrink-0 border-r border-line pt-14 px-3">
        <div className="drag absolute top-0 h-12 w-[220px]" />
        <div className="font-display text-[28px] px-3 mb-5" aria-hidden="true">
          Settings
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => navigate(`settings/${s.id}`)}
            aria-current={section === s.id ? "page" : undefined}
            className={cx(
              "w-full flex items-center gap-2.5 h-8 px-3 rounded-[9px] text-[13.5px] mb-px transition-colors",
              section === s.id
                ? "bg-surface shadow-sm border border-line text-ink font-medium"
                : "text-ink-2 hover:bg-surface-3/60",
            )}
          >
            <s.icon className={cx("size-4", section === s.id ? "text-accent" : "text-muted")} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {section === "profile" && <ProfileSection />}
        {section === "model" && <ModelSection />}
        {section === "approvals" && <ApprovalsSection />}
        {section === "memory" && <MemorySection />}
        {section === "notifications" && <NotificationsSection />}
        {section === "browser" && <BrowserSection />}
        {section === "about" && <AboutSection />}
      </div>
    </div>
  );
}

function Saved({ show }: { show: boolean }) {
  return show ? (
    <span role="status" className="inline-flex items-center gap-1 text-[12.5px] text-success">
      <Check className="size-3.5" /> Saved
    </span>
  ) : null;
}

/* ───────────── Profile ───────────── */

function ProfileSection() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  useEffect(() => {
    if (state.data?.profile) {
      setName(state.data.profile.name);
      setCity(state.data.profile.city);
      setAddresses(state.data.profile.addresses);
    }
  }, [state.data?.profile]);
  const save = useMutation({
    mutationFn: () =>
      api.saveProfile({
        name,
        city,
        addresses: addresses.filter((a) => a.line.trim() && a.label.trim()),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["state"] }),
  });
  return (
    <Page
      title="Profile"
      subtitle="RelayIt uses this to fill in the boring parts — names, addresses, where you are."
      width={640}
    >
      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-ink-2 mb-2">Saved places</div>
          <div className="space-y-2">
            {addresses.map((a, i) => (
              <div key={a.id} className="flex gap-2">
                <Input
                  value={a.label}
                  onChange={(e) =>
                    setAddresses(
                      addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  className="w-[110px]"
                  placeholder="Label"
                />
                <Input
                  value={a.line}
                  onChange={(e) =>
                    setAddresses(
                      addresses.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)),
                    )
                  }
                  placeholder="Address"
                />
                <Button
                  variant="ghost"
                  onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}
                  aria-label="Remove"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                setAddresses([
                  ...addresses,
                  {
                    id: `addr_${Date.now()}`,
                    label: addresses.length ? "Other" : "Home",
                    line: "",
                    city,
                    pincode: "",
                  },
                ])
              }
            >
              Add a place
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
          <Saved show={save.isSuccess} />
        </div>
      </Card>
    </Page>
  );
}

/* ───────────── Model ───────────── */

function ModelSection() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const cfg = state.data?.model;
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [routerModel, setRouterModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    if (cfg) {
      setProvider(cfg.provider);
      setModel(cfg.model);
      setRouterModel(cfg.routerModel ?? "");
    }
  }, [cfg]);

  const savedForThis = state.data?.keySaved && cfg?.provider === provider;

  const check = useMutation({
    mutationFn: () => api.validateKey(provider, apiKey || undefined),
    onSuccess: (r) => {
      if (r.ok) {
        setModels(r.models);
        if (!r.models.includes(model)) setModel(r.models[0] ?? "");
        setError(null);
      } else setError(r.error ?? "That didn't work");
    },
  });
  useEffect(() => {
    if (savedForThis || provider === "ollama") check.mutate();
    else setModels([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, savedForThis]);

  const save = useMutation({
    mutationFn: () =>
      api.saveModel(
        { provider, model, ...(routerModel ? { routerModel } : {}) },
        apiKey || undefined,
      ),
    onSuccess: (s) => {
      qc.setQueryData(["state"], s);
      setApiKey("");
      setReplacing(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save"),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteKey(provider),
    onSuccess: (s) => qc.setQueryData(["state"], s),
  });

  return (
    <Page
      title="Model"
      subtitle="Bring your own key or run locally. RelayIt never charges for model use — you pay your provider directly."
      width={680}
    >
      <div className="grid grid-cols-2 min-[1200px]:grid-cols-5 gap-2 mb-6">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setProvider(p.id);
              setApiKey("");
              setReplacing(false);
              setError(null);
            }}
            aria-pressed={provider === p.id}
            className={cx(
              "rounded-[14px] border px-3 py-3 text-left transition-all min-w-0 break-words",
              provider === p.id
                ? "border-accent/60 bg-accent-softer shadow-[var(--ring)]"
                : "border-line-strong bg-surface hover:border-ink/25",
            )}
          >
            <div className="text-[13px] font-semibold">{p.name}</div>
            <div className="text-[11.5px] text-muted mt-0.5 leading-snug">
              {cfg?.provider === p.id ? "In use" : p.id === "ollama" ? "Local" : "API key"}
            </div>
          </button>
        ))}
      </div>

      <Card className="p-6 space-y-5">
        {provider !== "ollama" && (
          <Field label="API key" error={error}>
            {savedForThis && !replacing ? (
              <div className="flex items-center gap-3 h-10 px-3 rounded-[11px] bg-surface-2 border border-line">
                <Lock className="size-4 text-success" />
                <span className="text-[13.5px] text-ink-2 flex-1">
                  Saved and encrypted. It won't be shown again.
                </span>
                <button
                  className="text-[12.5px] font-medium text-accent-text hover:underline"
                  onClick={() => setReplacing(true)}
                >
                  Replace
                </button>
                <button
                  className="text-[12.5px] font-medium text-danger hover:underline"
                  onClick={() => remove.mutate()}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={PROVIDERS.find((p) => p.id === provider)!.keyHint}
                  className="font-mono text-[13px]"
                />
                <Button
                  onClick={() => check.mutate()}
                  loading={check.isPending}
                  disabled={!apiKey}
                  icon={<KeyRound className="size-4" />}
                >
                  Check
                </Button>
              </div>
            )}
          </Field>
        )}
        {provider === "ollama" && error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Main model" hint="Does the thinking and talking.">
            <Select
              value={model}
              onValueChange={setModel}
              options={(models.length ? models : model ? [model] : [])
                .slice(0, 60)
                .map((m) => ({ value: m, label: m }))}
              placeholder="Check your key first"
            />
          </Field>
          <Field label="Cheap model (optional)" hint="Routes requests and writes summaries.">
            <Select
              value={routerModel || "__none"}
              onValueChange={(v) => setRouterModel(v === "__none" ? "" : v)}
              options={[
                { value: "__none", label: "Same as main / none" },
                ...(models.length ? models : routerModel ? [routerModel] : [])
                  .slice(0, 60)
                  .map((m) => ({ value: m, label: m })),
              ]}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!model || (provider !== "ollama" && !savedForThis && !apiKey)}
          >
            Save model
          </Button>
          <Saved show={save.isSuccess} />
        </div>
      </Card>
    </Page>
  );
}

/* ───────────── Approvals ───────────── */

function ApprovalsSection() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => {
    if (state.data) setCap(state.data.settings.spendCapInr);
  }, [state.data]);
  const saveCap = useMutation({
    mutationFn: () => api.saveSettings({ spendCapInr: cap! }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["state"] }),
  });
  const del = useMutation({
    mutationFn: api.deleteRule,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  return (
    <Page
      title="Approvals"
      subtitle="RelayIt asks before it sends, pays, books, orders, deletes or posts. Here's what you've let it do on its own."
      width={680}
    >
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-[14.5px] font-semibold">Per-action spending limit</div>
            <div className="text-[13px] text-muted mt-1 max-w-sm leading-relaxed">
              Anything costing more than this can't be approved until you raise the limit. Money
              always asks, even with “Always allow”.
            </div>
          </div>
          <div className="text-right">
            <div className="text-[28px] font-semibold tracking-tight tnum">
              {cap != null ? formatInr(cap) : "—"}
            </div>
          </div>
        </div>
        <input
          type="range"
          aria-label="Per-action spending limit"
          aria-valuetext={formatInr(cap ?? 2000)}
          min={100}
          max={20000}
          step={100}
          value={cap ?? 2000}
          onChange={(e) => setCap(Number(e.target.value))}
          className="w-full mt-5 accent-[var(--accent)]"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-1.5">
            {[500, 1000, 2000, 5000].map((v) => (
              <button
                key={v}
                onClick={() => setCap(v)}
                className={cx(
                  "h-7 px-2.5 rounded-full border text-[12px] tnum",
                  cap === v
                    ? "border-ink bg-ink text-bg"
                    : "border-line-strong text-ink-2 hover:border-ink/30",
                )}
              >
                {formatInr(v)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Saved show={saveCap.isSuccess} />
            <Button
              size="sm"
              variant="primary"
              onClick={() => saveCap.mutate()}
              loading={saveCap.isPending}
              disabled={cap === state.data?.settings.spendCapInr}
            >
              Save limit
            </Button>
          </div>
        </div>
      </Card>

      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted mb-3">
        Always allowed
      </h2>
      {rules.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="Nothing runs without asking"
            body="When you choose “Always allow” on an approval card, it shows up here so you can take it back."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {rules.data?.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3.5">
              <ServiceMark service={r.service} size={26} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium">{r.label}</div>
                <div className="text-[12px] text-muted">
                  Added {relTime(r.createdAt)} · still asks if money is involved or outside content
                  was read
                </div>
              </div>
              <Button size="sm" variant="danger" onClick={() => del.mutate(r.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}

/* ───────────── Memory ───────────── */

const CATS: { value: MemoryFact["category"]; label: string }[] = [
  { value: "preference", label: "Preference" },
  { value: "person", label: "Person" },
  { value: "place", label: "Place" },
  { value: "order", label: "Usual order" },
  { value: "travel", label: "Travel" },
  { value: "other", label: "Other" },
];

function MemorySection() {
  const qc = useQueryClient();
  const memory = useQuery({ queryKey: ["memory"], queryFn: api.memory });
  const [category, setCategory] = useState<MemoryFact["category"]>("preference");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const add = useMutation({
    mutationFn: () => api.addMemory({ category, key, value }),
    onSuccess: () => {
      setKey("");
      setValue("");
      void qc.invalidateQueries({ queryKey: ["memory"] });
    },
  });
  const del = useMutation({
    mutationFn: api.deleteMemory,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["memory"] }),
  });
  const grouped = CATS.map((c) => ({
    ...c,
    items: (memory.data ?? []).filter((m) => m.category === c.value),
  })).filter((g) => g.items.length);

  return (
    <Page
      title="What RelayIt knows"
      subtitle="The facts RelayIt uses to fill in defaults — your usual orders, people, places and preferences. Edit or delete anything."
      width={720}
    >
      <Card className="p-5 mb-7">
        <div className="grid grid-cols-[150px_1fr] gap-3">
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as MemoryFact["category"])}
            options={CATS}
          />
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="What it's about — e.g. “usual pizza”, “sister”, “train seat”"
          />
        </div>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={2}
          placeholder="The fact — e.g. “Large Margherita, thin crust, extra basil from CPK”"
          className="mt-3"
        />
        <div className="flex justify-end mt-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => add.mutate()}
            disabled={!key.trim() || !value.trim()}
            loading={add.isPending}
            icon={<Plus className="size-3.5" />}
          >
            Remember this
          </Button>
        </div>
      </Card>
      {grouped.length === 0 && (
        <EmptyState
          icon={<Home className="size-5" />}
          title="Nothing yet"
          body="As you use RelayIt it learns your usual orders and preferences. You can also add them yourself above."
        />
      )}
      <div className="space-y-7">
        {grouped.map((g) => (
          <section key={g.value}>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted mb-2.5">
              {g.label}
            </h2>
            <Card className="divide-y divide-line">
              {g.items.map((m) => (
                <div key={m.id} className="group flex items-start gap-4 px-5 py-3.5">
                  <div className="w-[170px] shrink-0 text-[13px] font-medium text-ink-2 pt-px">
                    {m.key}
                  </div>
                  <div className="flex-1 text-[13.5px] selectable">{m.value}</div>
                  <span className="text-[11px] text-faint shrink-0 pt-0.5">
                    {m.source === "agent" ? "learned" : "added"} {relTime(m.updatedAt)}
                  </span>
                  <button
                    onClick={() => del.mutate(m.id)}
                    className="text-faint hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-label="Forget"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </Page>
  );
}

/* ───────────── Notifications & brief ───────────── */

function NotificationsSection() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const s = state.data?.settings;
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["state"] }),
  });
  if (!s) return null;
  return (
    <Page title="Brief & alerts" subtitle="How RelayIt reaches out first." width={640}>
      <Card className="divide-y divide-line">
        <Row
          title="Morning brief on first open"
          body="The first time you open RelayIt each day, it posts what needs you, today's calendar and anything pending."
        >
          <Switch
            label="Morning brief on first open"
            checked={s.briefOnFirstOpen}
            onCheckedChange={(v) => save.mutate({ briefOnFirstOpen: v })}
          />
        </Row>
        <Row
          title="Brief time"
          body="When RelayIt prepares the brief while it's running in the tray."
        >
          <Input
            type="time"
            aria-label="Brief time"
            value={s.briefTime}
            onChange={(e) => save.mutate({ briefTime: e.target.value })}
            className="w-[120px] h-9"
          />
        </Row>
        <Row title="Desktop notifications" body="“Needs you”, orders placed and finished routines.">
          <Switch
            label="Desktop notifications"
            checked={s.notifications}
            onCheckedChange={(v) => save.mutate({ notifications: v })}
          />
        </Row>
        <Row title="Quick Ask shortcut" body="Summon RelayIt from anywhere.">
          <span className="text-[13px] font-medium text-ink-2 bg-surface-2 border border-line rounded-[8px] px-2.5 h-8 inline-flex items-center">
            {s.quickAskShortcut.replace("Alt", "⌥ Option").replace("+", " + ")}
          </span>
        </Row>
      </Card>
    </Page>
  );
}

function BrowserSection() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const sessions = useQuery({
    queryKey: ["browser-sessions"],
    queryFn: api.browserSessions,
    retry: false,
  });
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["state"] }),
  });
  const login = useMutation({ mutationFn: api.openBrowserLogin });
  const s = state.data?.settings;
  if (!s) return null;
  return (
    <Page
      title="Browser agent"
      subtitle="For services without an official API, RelayIt can use a separate browser profile — signed in as you — to get things done. Every submit and purchase still asks you first."
      width={680}
    >
      <Card className="divide-y divide-line mb-6">
        <Row
          title="Allow the browser agent"
          body="Used only when there's no official connection for a service."
        >
          <Switch
            label="Allow the browser agent"
            checked={s.browserAgentEnabled}
            onCheckedChange={(v) => save.mutate({ browserAgentEnabled: v })}
          />
        </Row>
        <Row
          title="Run in the background"
          body="Hide the browser window. Turn off to watch every step."
        >
          <Switch
            label="Run in the background"
            checked={s.browserHeadless}
            onCheckedChange={(v) => save.mutate({ browserHeadless: v })}
          />
        </Row>
      </Card>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted mb-3">
        Sign-ins
      </h2>
      <Card className="divide-y divide-line">
        {(sessions.data ?? []).map((x) => (
          <div key={x.site} className="flex items-center gap-3 px-5 py-3.5">
            <ServiceMark service={x.site} size={26} />
            <div className="flex-1">
              <div className="text-[13.5px] font-medium">{x.site}</div>
              <div className="text-[12px] text-muted">
                {x.loggedIn
                  ? `Signed in${x.lastUsed ? ` · used ${relTime(x.lastUsed)}` : ""}`
                  : "Not signed in"}
              </div>
            </div>
            <Button
              size="sm"
              variant={x.loggedIn ? "ghost" : "secondary"}
              onClick={() => login.mutate(x.site)}
              loading={login.isPending && login.variables === x.site}
            >
              {x.loggedIn ? "Re-open" : "Sign in"}
            </Button>
          </div>
        ))}
        {sessions.isError && (
          <div className="px-5 py-4 text-[13px] text-muted">
            The browser agent isn't available in this build.
          </div>
        )}
      </Card>
      <p className="text-[12.5px] text-muted mt-3 leading-relaxed">
        You sign in yourself in the RelayIt browser window. RelayIt never sees your password and
        never enters payment details — checkout is always handed back to you.
      </p>
    </Page>
  );
}

function AboutSection() {
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  return (
    <Page title="Privacy & data" width={640}>
      <Card className="p-6 space-y-4 text-[13.5px] leading-relaxed text-ink-2">
        <p>
          <span className="font-semibold text-ink">Everything stays on this computer.</span> Chats,
          memory, the activity log and your keys are stored locally. Keys and passwords are
          encrypted with a key kept in your system keychain.
        </p>
        <p>
          <span className="font-semibold text-ink">Your model provider sees your messages.</span>{" "}
          When you chat, RelayIt sends the conversation and relevant data (like an email you asked
          about) to the model you chose. With Ollama, nothing leaves your machine.
        </p>
        <p>
          <span className="font-semibold text-ink">No RelayIt server.</span> This version has no
          account and no cloud. Nothing is collected about you.
        </p>
        <div className="pt-2 text-[12px] text-muted">
          RelayIt {state.data?.version}
          {state.data?.mockMode.model && " · demo model"}
          {state.data?.mockMode.google && " · fake Google"}
        </div>
      </Card>
    </Page>
  );
}

function Row({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed">{body}</div>
      </div>
      {children}
    </div>
  );
}
