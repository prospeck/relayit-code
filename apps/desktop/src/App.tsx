import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { api } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { startLive } from "./lib/live";
import { isTauri } from "./lib/tauri";
import { Sidebar } from "./components/Sidebar";
import { LogoMark } from "./components/Logo";
import { Button, TooltipProvider } from "./components/ui";
import { Onboarding } from "./screens/Onboarding";
import { Today } from "./screens/Today";
import { Chat } from "./screens/Chat";
import { Tasks } from "./screens/Tasks";
import { Activity } from "./screens/Activity";
import { Connections } from "./screens/Connections";
import { Skills } from "./screens/Skills";
import { Routines } from "./screens/Routines";
import { Settings } from "./screens/Settings";
import { QuickAsk } from "./screens/QuickAsk";

export function App() {
  const qc = useQueryClient();
  const route = useRoute();
  const state = useQuery({ queryKey: ["state"], queryFn: api.state, retry: 30, retryDelay: 500 });

  useEffect(() => startLive(qc), [qc]);
  useKeyboardShortcuts();
  useFirstOpenBrief(!!state.data?.onboarded && !!state.data.settings.briefOnFirstOpen);

  if (route.screen === "quick") return <QuickAsk />;

  if (state.isLoading || (state.isError && state.failureCount < 30)) return <Splash />;
  if (state.isError) return <Splash error={String((state.error as Error).message)} onRetry={() => state.refetch()} />;
  if (!state.data?.onboarded) return <Onboarding />;

  return (
    <TooltipProvider>
      <div className="h-full flex bg-bg">
        <a
          href="#main-content"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
          className="sr-only-focusable fixed left-3 top-3 z-50 bg-surface border border-line-strong rounded-[10px] px-3 py-2 text-[13px] font-medium shadow-md"
        >
          Skip to content
        </a>
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 relative outline-none">
          <div className="drag absolute inset-x-0 top-0 h-[38px] z-0" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route.screen === "chat" ? "chat" : route.screen}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="relative h-full z-10"
            >
              <Screen screen={route.screen} param={route.param} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </TooltipProvider>
  );
}

function Screen({ screen, param }: { screen: string; param: string | null }) {
  switch (screen) {
    case "chat":
      return <Chat id={param} />;
    case "tasks":
      return <Tasks />;
    case "activity":
      return <Activity />;
    case "connections":
      return <Connections />;
    case "skills":
      return <Skills />;
    case "routines":
      return <Routines />;
    case "settings":
      return <Settings />;
    default:
      return <Today />;
  }
}

function Splash({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="drag h-full flex flex-col items-center justify-center gap-5 bg-bg">
      <motion.div className="motion-reduce:transform-none!" animate={error ? {} : { scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}>
        <LogoMark size={52} />
      </motion.div>
      {error ? (
        <div className="no-drag text-center">
          <p className="text-[14px] text-ink-2 mb-3">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Starting RelayIt…</p>
      )}
    </div>
  );
}

function useKeyboardShortcuts() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`chat/${c.id}`);
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        create.mutate();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        navigate("settings");
      } else if (mod && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        navigate(["today", "chat", "tasks", "activity", "connections", "skills", "routines"][Number(e.key) - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [create]);
}

/** The first time the app opens each day, ask core for the morning brief. */
function useFirstOpenBrief(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const today = new Date().toDateString();
    if (localStorage.getItem("relayit.lastBrief") === today) return;
    localStorage.setItem("relayit.lastBrief", today);
    const hour = new Date().getHours();
    if (hour < 4) return;
    void api.brief(true).catch(() => {});
  }, [enabled]);

  // Tray → "Morning brief": make a fresh one and open it.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("relayit://brief", () => void api.brief(false).then((r) => navigate(`chat/${r.conversationId}`)).catch(() => {})).then((u) => (off = u)),
    );
    return () => off?.();
  }, []);
}
