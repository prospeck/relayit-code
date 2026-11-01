import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@relayit/shared";
import { endpoint } from "./api";
import { notify } from "./tauri";

type LiveStep = {
  id: string;
  label: string;
  tool: string;
  status: "running" | "done" | "error" | "waiting";
};
export type LiveRun = {
  runId: string;
  text: string;
  status: string;
  steps: LiveStep[];
  active: boolean;
};
export type BrowserFrame = { url: string; jpegBase64: string; at: number };

type LiveState = {
  connected: boolean;
  runs: Record<string, LiveRun>;
  frames: Record<string, BrowserFrame>;
  setConnected(v: boolean): void;
  apply(e: ServerEvent): void;
  clear(conversationId: string): void;
};

export const useLive = create<LiveState>((set) => ({
  connected: false,
  runs: {},
  frames: {},
  setConnected: (connected) => set({ connected }),
  clear: (cid) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[cid];
      return { runs };
    }),
  apply: (e) =>
    set((s) => {
      switch (e.type) {
        case "run.started":
          return {
            runs: {
              ...s.runs,
              [e.conversationId]: {
                runId: e.runId,
                text: "",
                status: "Thinking…",
                steps: [],
                active: true,
              },
            },
          };
        case "run.status": {
          const r = s.runs[e.conversationId];
          return r ? { runs: { ...s.runs, [e.conversationId]: { ...r, status: e.label } } } : s;
        }
        case "run.text": {
          const r = s.runs[e.conversationId] ?? {
            runId: e.runId,
            text: "",
            status: "",
            steps: [],
            active: true,
          };
          return { runs: { ...s.runs, [e.conversationId]: { ...r, text: r.text + e.delta } } };
        }
        case "run.step": {
          const r = s.runs[e.conversationId];
          if (!r) return s;
          const steps = r.steps.some((x) => x.id === e.step.id)
            ? r.steps.map((x) => (x.id === e.step.id ? e.step : x))
            : [...r.steps, e.step];
          return { runs: { ...s.runs, [e.conversationId]: { ...r, steps } } };
        }
        case "run.finished":
        case "run.error": {
          const runs = { ...s.runs };
          delete runs[e.conversationId];
          return { runs };
        }
        case "message.created": {
          // The persisted message replaces the streamed text.
          if (e.message.role !== "assistant") return s;
          const r = s.runs[e.message.conversationId];
          return r
            ? {
                runs: {
                  ...s.runs,
                  [e.message.conversationId]: {
                    ...r,
                    text: "",
                    steps: r.steps.filter((x) => x.status === "running"),
                  },
                },
              }
            : s;
        }
        case "browser.frame":
          return {
            frames: {
              ...s.frames,
              [e.conversationId]: { url: e.url, jpegBase64: e.jpegBase64, at: Date.now() },
            },
          };
        default:
          return s;
      }
    }),
}));

let started = false;

/** Opens the event stream once and keeps it alive; maps events to cache invalidations. */
export function startLive(qc: QueryClient): void {
  if (started) return;
  started = true;
  let retry = 0;
  const connect = async () => {
    let ws: WebSocket;
    try {
      const { base, token } = await endpoint();
      ws = new WebSocket(
        `${base.replace(/^http/, "ws")}/api/events?token=${encodeURIComponent(token)}`,
      );
    } catch {
      setTimeout(connect, 1500);
      return;
    }
    ws.onopen = () => {
      retry = 0;
      useLive.getState().setConnected(true);
      void qc.invalidateQueries();
    };
    ws.onclose = () => {
      useLive.getState().setConnected(false);
      setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
    };
    ws.onmessage = (m) => {
      const e = JSON.parse(m.data as string) as ServerEvent | { type: "hello" };
      if (e.type === "hello") return;
      useLive.getState().apply(e);
      switch (e.type) {
        case "message.created":
          void qc.invalidateQueries({ queryKey: ["conversation", e.message.conversationId] });
          void qc.invalidateQueries({ queryKey: ["conversations"] });
          break;
        case "conversation.updated":
          void qc.invalidateQueries({ queryKey: ["conversations"] });
          break;
        case "action.pending":
        case "action.updated":
          void qc.invalidateQueries({ queryKey: ["actions"] });
          void qc.invalidateQueries({ queryKey: ["conversation", e.action.conversationId] });
          void qc.invalidateQueries({ queryKey: ["today"] });
          break;
        case "audit":
          void qc.invalidateQueries({ queryKey: ["audit"] });
          break;
        case "tasks.updated":
          void qc.invalidateQueries({ queryKey: ["tasks"] });
          void qc.invalidateQueries({ queryKey: ["today"] });
          break;
        case "connections.updated":
          void qc.invalidateQueries({ queryKey: ["servers"] });
          void qc.invalidateQueries({ queryKey: ["tools"] });
          void qc.invalidateQueries({ queryKey: ["google"] });
          break;
        case "routines.updated":
          void qc.invalidateQueries({ queryKey: ["routines"] });
          break;
        case "run.finished":
        case "run.error":
          void qc.invalidateQueries({ queryKey: ["conversation", e.conversationId] });
          // A fetch that started before these events may land after them; refetch once more.
          setTimeout(
            () => void qc.invalidateQueries({ queryKey: ["conversation", e.conversationId] }),
            600,
          );
          break;
        case "notify":
          if (!document.hasFocus()) void notify(e.title, e.body);
          break;
      }
    };
  };
  void connect();
}
