import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  HardDrive,
  KeyRound,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { ProviderId } from "@relayit/shared";
import { api, ApiError, type OllamaInfo } from "../lib/api";
import { cx } from "../lib/format";
import { openExternal, platform } from "../lib/tauri";
import { Button, Field, Input, Select } from "../components/ui";
import { LogoMark } from "../components/Logo";

const CITIES = [
  "Bengaluru",
  "Mumbai",
  "Delhi NCR",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Kolkata",
  "Ahmedabad",
];

export const PROVIDERS: {
  id: ProviderId;
  name: string;
  blurb: string;
  keyUrl: string | null;
  keyHint: string;
}[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    blurb: "Claude — careful, great with tools",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT models",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    blurb: "Fast, generous free tier",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "One key, hundreds of models",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
  },
  {
    id: "ollama",
    name: "Ollama",
    blurb: "Runs on this computer, free and private",
    keyUrl: null,
    keyHint: "",
  },
];

const STEPS = ["you", "places", "brain", "promise"] as const;
type Step = (typeof STEPS)[number];

const HEADLINES: Record<Step, { title: string; body: string }> = {
  you: {
    title: "Say it once.\nRelayIt handles the rest.",
    body: "Your own agent for email, calendar, food, travel and payments — on your computer.",
  },
  places: {
    title: "Where should\nthings arrive?",
    body: "Saved places let RelayIt fill in addresses so you never type them again.",
  },
  brain: {
    title: "Pick the brain\nthat powers it.",
    body: "Bring your own key, or run a model locally with Ollama. Keys are encrypted and never shown again.",
  },
  promise: { title: "You stay\nin charge.", body: "RelayIt does the legwork. You make the calls." },
};

export function Onboarding() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("you");
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [city, setCity] = useState("Bengaluru");
  const [home, setHome] = useState("");
  const [work, setWork] = useState("");
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const ollama = useQuery({
    queryKey: ["ollama"],
    queryFn: api.ollama,
    refetchInterval: (q) =>
      provider !== "ollama"
        ? false
        : q.state.data?.pull && !q.state.data.pull.done
          ? 1000
          : !verified
            ? 4000
            : false,
  });
  const state = useQuery({ queryKey: ["state"], queryFn: api.state });
  const mock = state.data?.mockMode.model;

  useEffect(() => {
    if (provider === "ollama" && ollama.data?.running) {
      setModels(ollama.data.models);
      setModel((m) => (m && ollama.data!.models.includes(m) ? m : ollama.data!.models[0] || ""));
      setVerified(ollama.data.models.length > 0);
      setKeyError(ollama.data.models.length ? null : null);
    }
  }, [provider, ollama.data]);

  const validate = useMutation({
    mutationFn: () => api.validateKey(provider, apiKey.trim()),
    onSuccess: (r) => {
      if (r.ok) {
        setModels(r.models);
        setModel(r.models[0] ?? "");
        setVerified(true);
        setKeyError(null);
      } else {
        setVerified(false);
        setKeyError(r.error ?? "That key didn't work.");
      }
    },
  });

  const finish = useMutation({
    mutationFn: () =>
      api.onboard({
        profile: {
          name: name.trim(),
          city,
          addresses: [
            ...(home.trim()
              ? [{ id: "home", label: "Home", line: home.trim(), city, pincode: "" }]
              : []),
            ...(work.trim()
              ? [{ id: "work", label: "Work", line: work.trim(), city, pincode: "" }]
              : []),
          ],
        },
        model: { provider, model: model || (mock ? "mock-smart" : "") },
        ...(apiKey.trim() && provider !== "ollama" ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: (s) => {
      qc.setQueryData(["state"], s);
      window.location.hash = "#/today";
    },
  });

  const idx = STEPS.indexOf(step);
  const go = (d: 1 | -1) => {
    setDir(d);
    setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, idx + d))]!);
  };
  const canNext =
    step === "you"
      ? name.trim().length > 0
      : step === "places"
        ? true
        : step === "brain"
          ? (verified && !!model) || !!mock
          : true;
  const h = HEADLINES[step];
  const mac = platform() === "mac";

  return (
    <div className="h-full flex bg-bg">
      {/* Left: the story panel */}
      <div className="relative hidden md:flex w-[42%] max-w-[560px] flex-col justify-between overflow-hidden bg-[#171512] text-[#f3efe9] p-10">
        <div className="drag absolute inset-x-0 top-0 h-12" />
        <div className={cx("flex items-center gap-2.5", mac && "mt-6")}>
          <LogoMark size={26} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">RelayIt</span>
        </div>
        <RelayArt step={idx} />
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="font-display text-[46px] leading-[1.02] whitespace-pre-line">
                {h.title}
              </h1>
              <p className="mt-4 text-[15px] leading-relaxed text-[#b9b2a8] max-w-[380px]">
                {h.body}
              </p>
            </motion.div>
          </AnimatePresence>
          <div className="flex gap-1.5 mt-8">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cx(
                  "h-1 rounded-full transition-all duration-500",
                  i === idx
                    ? "w-8 bg-[#f26a3d]"
                    : i < idx
                      ? "w-3 bg-[#f26a3d]/60"
                      : "w-3 bg-white/15",
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right: the form */}
      <div className="relative flex-1 flex flex-col">
        <div className="drag h-12 shrink-0" />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[460px] mx-auto px-8 py-10 min-h-full flex flex-col justify-center">
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                initial={{ opacity: 0, x: dir * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -16 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                {step === "you" && (
                  <div>
                    <p className="text-[13px] font-medium text-accent-text mb-2">Welcome</p>
                    <h2 className="text-[26px] font-semibold tracking-[-0.02em] mb-6">
                      What should I call you?
                    </h2>
                    <Input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your first name"
                      className="h-12 text-[16px]"
                      onKeyDown={(e) => e.key === "Enter" && canNext && go(1)}
                    />
                  </div>
                )}

                {step === "places" && (
                  <div>
                    <p className="text-[13px] font-medium text-accent-text mb-2">
                      Hi {name.trim()} 👋
                    </p>
                    <h2 className="text-[26px] font-semibold tracking-[-0.02em] mb-6">
                      Which city are you in?
                    </h2>
                    <div className="flex flex-wrap gap-2 mb-7">
                      {CITIES.map((c) => (
                        <button
                          key={c}
                          onClick={() => setCity(c)}
                          className={cx(
                            "h-9 px-3.5 rounded-full border text-[13.5px] font-medium transition-all",
                            city === c
                              ? "bg-ink text-bg border-ink"
                              : "border-line-strong bg-surface hover:border-ink/30",
                          )}
                        >
                          {c}
                        </button>
                      ))}
                      {!CITIES.includes(city) || city === "" ? null : null}
                    </div>
                    <div className="space-y-4">
                      <Field label="Home address" hint="Used for deliveries and cabs. Optional.">
                        <Input
                          value={home}
                          onChange={(e) => setHome(e.target.value)}
                          placeholder="Flat, building, street, area"
                        />
                      </Field>
                      <Field label="Work address" hint="Optional.">
                        <Input
                          value={work}
                          onChange={(e) => setWork(e.target.value)}
                          placeholder="Office, area"
                        />
                      </Field>
                    </div>
                  </div>
                )}

                {step === "brain" && (
                  <div>
                    <p className="text-[13px] font-medium text-accent-text mb-2">Your model</p>
                    <h2 className="text-[26px] font-semibold tracking-[-0.02em] mb-6">
                      Which AI should RelayIt use?
                    </h2>
                    <div className="grid grid-cols-1 gap-2 mb-5">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setProvider(p.id);
                            setVerified(false);
                            setModels([]);
                            setModel("");
                            setKeyError(null);
                          }}
                          className={cx(
                            "flex items-center gap-3 px-4 h-[54px] rounded-[14px] border text-left transition-all",
                            provider === p.id
                              ? "border-accent/60 bg-accent-softer shadow-[var(--ring)]"
                              : "border-line-strong bg-surface hover:border-ink/25",
                          )}
                        >
                          <span
                            className={cx(
                              "size-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0",
                              provider === p.id ? "border-accent bg-accent" : "border-line-strong",
                            )}
                          >
                            {provider === p.id && (
                              <span className="size-1.5 rounded-full bg-white" />
                            )}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] font-medium">{p.name}</span>
                            <span className="block text-[12.5px] text-muted truncate">
                              {p.blurb}
                            </span>
                          </span>
                          {p.id === "ollama" && (
                            <span
                              className={cx(
                                "text-[11.5px] font-medium",
                                ollama.data?.running ? "text-success" : "text-faint",
                              )}
                            >
                              {ollama.data?.running
                                ? `Running · ${ollama.data.models.length} model${ollama.data.models.length === 1 ? "" : "s"}`
                                : "Not detected"}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {provider !== "ollama" ? (
                      <div className="space-y-3">
                        <Field
                          label="API key"
                          error={keyError}
                          hint={
                            <span className="inline-flex items-center gap-1.5">
                              <Lock className="size-3" /> Encrypted on this computer. You won't see
                              it again after saving.
                            </span>
                          }
                        >
                          <div className="flex gap-2">
                            <Input
                              type="password"
                              value={apiKey}
                              autoComplete="off"
                              spellCheck={false}
                              onChange={(e) => {
                                setApiKey(e.target.value);
                                setVerified(false);
                              }}
                              onKeyDown={(e) => e.key === "Enter" && apiKey && validate.mutate()}
                              placeholder={PROVIDERS.find((p) => p.id === provider)!.keyHint}
                              className="font-mono text-[13px]"
                            />
                            <Button
                              variant={verified ? "secondary" : "primary"}
                              onClick={() => validate.mutate()}
                              loading={validate.isPending}
                              disabled={!apiKey.trim()}
                              icon={
                                verified ? (
                                  <Check className="size-4 text-success" />
                                ) : (
                                  <KeyRound className="size-4" />
                                )
                              }
                            >
                              {verified ? "Verified" : "Check"}
                            </Button>
                          </div>
                        </Field>
                        <button
                          onClick={() =>
                            void openExternal(PROVIDERS.find((p) => p.id === provider)!.keyUrl!)
                          }
                          className="inline-flex items-center gap-1 text-[12.5px] text-accent-text hover:underline"
                        >
                          Get a {PROVIDERS.find((p) => p.id === provider)!.name} key{" "}
                          <ExternalLink className="size-3" />
                        </button>
                      </div>
                    ) : ollama.data?.running ? (
                      <OllamaRecommend info={ollama.data} onPulled={() => void ollama.refetch()} />
                    ) : (
                      !ollama.data?.running && (
                        <div className="rounded-[12px] bg-surface-2 border border-line p-4 text-[13px] text-ink-2 leading-relaxed">
                          Install Ollama from{" "}
                          <button
                            className="text-accent-text hover:underline"
                            onClick={() => void openExternal("https://ollama.com/download")}
                          >
                            ollama.com
                          </button>
                          , open it, then run{" "}
                          <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded border border-line">
                            ollama pull {ollama.data?.recommended.name ?? "qwen3:4b-instruct"}
                          </code>
                          . RelayIt will notice automatically.
                          {keyError && <p className="text-danger mt-2">{keyError}</p>}
                        </div>
                      )
                    )}

                    {verified && models.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-5"
                      >
                        <Field label="Model" hint="You can change this any time in Settings.">
                          <Select
                            value={model}
                            onValueChange={setModel}
                            options={models.slice(0, 40).map((m) => ({ value: m, label: m }))}
                          />
                        </Field>
                      </motion.div>
                    )}
                    {mock && !verified && (
                      <p className="mt-4 text-[12.5px] text-muted">
                        Demo mode is on: you can continue without a key.
                      </p>
                    )}
                  </div>
                )}

                {step === "promise" && (
                  <div>
                    <p className="text-[13px] font-medium text-accent-text mb-2">Three promises</p>
                    <h2 className="text-[26px] font-semibold tracking-[-0.02em] mb-7">
                      How RelayIt works for you
                    </h2>
                    <div className="space-y-5">
                      {[
                        {
                          icon: ShieldCheck,
                          title: "It asks before it acts",
                          body: "Sending, paying, booking or deleting always shows you a card first. Allow once, always, or refuse.",
                        },
                        {
                          icon: Wallet,
                          title: "It never touches your money",
                          body: "It gets the order ready. You pay in your own UPI app, with your own PIN.",
                        },
                        {
                          icon: HardDrive,
                          title: "Everything stays here",
                          body: "Chats, memory, keys and the activity log live on this computer, encrypted. No RelayIt server.",
                        },
                      ].map((p, i) => (
                        <motion.div
                          key={p.title}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.08 * i + 0.1 }}
                          className="flex gap-4"
                        >
                          <span className="size-10 shrink-0 rounded-[12px] bg-accent-soft text-accent flex items-center justify-center">
                            <p.icon className="size-[18px]" />
                          </span>
                          <div>
                            <div className="text-[14.5px] font-semibold">{p.title}</div>
                            <div className="text-[13.5px] text-muted leading-relaxed mt-0.5">
                              {p.body}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                    {finish.error && (
                      <p className="mt-5 text-[13px] text-danger">
                        {finish.error instanceof ApiError
                          ? finish.error.message
                          : "Something went wrong"}
                      </p>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <div className="shrink-0 px-8 py-5 flex items-center justify-between border-t border-line">
          <Button
            variant="ghost"
            onClick={() => go(-1)}
            className={cx(idx === 0 && "invisible")}
            icon={<ArrowLeft className="size-4" />}
          >
            Back
          </Button>
          {step === "promise" ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => finish.mutate()}
              loading={finish.isPending}
            >
              Start using RelayIt
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(1)} disabled={!canNext}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Abstract "relay": nodes handing a glowing pulse along a path. The path grows as you progress. */
function RelayArt({ step }: { step: number }) {
  const nodes = [
    { x: 60, y: 210, label: "You" },
    { x: 190, y: 120, label: "RelayIt" },
    { x: 330, y: 190, label: "Apps" },
    { x: 420, y: 80, label: "Done" },
  ];
  const path = "M60 210 C 110 210, 130 120, 190 120 S 280 190, 330 190 S 400 80, 420 80";
  return (
    <svg viewBox="0 0 480 280" className="w-full max-w-[460px] my-6 opacity-95" aria-hidden>
      <defs>
        <linearGradient id="relay-line" x1="0" x2="1">
          <stop offset="0" stopColor="#f26a3d" stopOpacity="0.15" />
          <stop offset="1" stopColor="#f26a3d" stopOpacity="0.9" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        strokeWidth="2"
        strokeDasharray="3 6"
      />
      <motion.path
        d={path}
        fill="none"
        stroke="url(#relay-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: (step + 1) / 4 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle r="5" fill="#ff8a62" filter="url(#glow)">
        <animateMotion
          dur="3.2s"
          repeatCount="indefinite"
          path={path}
          keyPoints="0;1"
          keyTimes="0;1"
          calcMode="spline"
          keySplines="0.45 0 0.55 1"
        />
      </circle>
      {nodes.map((n, i) => (
        <g key={n.label}>
          <motion.circle
            cx={n.x}
            cy={n.y}
            r={i <= step ? 9 : 6}
            fill={i <= step ? "#f26a3d" : "#2a2622"}
            stroke={i <= step ? "#ff9a76" : "rgb(255 255 255 / 0.18)"}
            strokeWidth="1.5"
            animate={{ r: i <= step ? 9 : 6 }}
            transition={{ duration: 0.4 }}
          />
          <text
            x={n.x}
            y={n.y + 30}
            textAnchor="middle"
            fontSize="12"
            fill={i <= step ? "#f3efe9" : "#7d766d"}
            fontFamily="Geist Variable, sans-serif"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Offers the recommended local model when it isn't installed yet, with live download progress. */
export function OllamaRecommend({ info, onPulled }: { info: OllamaInfo; onPulled: () => void }) {
  const rec = info.recommended;
  const have = info.models.some((m) => m === rec.name || m.startsWith(`${rec.name}-`));
  const pull = info.pull && info.pull.model === rec.name ? info.pull : null;
  const start = useMutation({ mutationFn: () => api.pullOllama(rec.name), onSuccess: onPulled });
  useEffect(() => {
    if (pull?.done && !pull.error) onPulled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull?.done]);
  if (have) return null;
  const pct = pull && pull.total ? Math.round((pull.completed / pull.total) * 100) : 0;
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold">
            {info.models.length ? "Recommended for speed" : "Download a model to get started"}
          </div>
          <p className="text-[12.5px] text-muted mt-0.5 leading-relaxed">
            {rec.label} ({rec.sizeGb} GB) answers directly and handles RelayIt's tools well, even on
            an 8 GB Mac.
          </p>
        </div>
        {!pull || pull.done ? (
          <Button
            size="sm"
            variant={info.models.length ? "secondary" : "primary"}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            {pull?.error ? "Try again" : "Download"}
          </Button>
        ) : null}
      </div>
      {pull && !pull.done && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[11.5px] text-muted mt-1.5 tnum">
            {pull.total
              ? `${pct}% · ${(pull.completed / 1e9).toFixed(1)} of ${(pull.total / 1e9).toFixed(1)} GB`
              : pull.status}
          </div>
        </div>
      )}
      {pull?.error && (
        <p role="alert" className="text-[12px] text-danger mt-2">
          {pull.error}
        </p>
      )}
    </div>
  );
}
