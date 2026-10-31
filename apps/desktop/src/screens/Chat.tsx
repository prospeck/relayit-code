import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowDown, MessageCircle } from "lucide-react";
import type { Message, PendingAction } from "@relayit/shared";
import { api, ApiError, type ConversationDetail } from "../lib/api";
import { useLive } from "../lib/live";
import { navigate } from "../lib/router";
import { Composer, type ComposerHandle } from "../components/Composer";
import { LiveRunView, MessageView } from "../components/MessageView";
import { LogoMark } from "../components/Logo";
import { EmptyState, Button } from "../components/ui";

export function Chat({ id }: { id: string | null }) {
  const qc = useQueryClient();
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });

  // /chat with no id: open the latest chat, or show an empty state.
  useEffect(() => {
    if (!id && conversations.data?.[0]) navigate(`chat/${conversations.data[0].id}`);
  }, [id, conversations.data]);

  const create = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`chat/${c.id}`);
    },
  });

  if (!id)
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState icon={<MessageCircle className="size-5" />} title="No chats yet" body="Start one and tell RelayIt what you need." action={<Button variant="primary" onClick={() => create.mutate()}>New chat</Button>} />
      </div>
    );
  return <Thread key={id} id={id} />;
}

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.conversation(id) });
  const run = useLive((s) => s.runs[id]);
  const frame = useLive((s) => s.frames[id]);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (text: string) => api.send(id, text),
    onMutate: async (text) => {
      setError(null);
      // Optimistic user bubble.
      await qc.cancelQueries({ queryKey: ["conversation", id] });
      const prev = qc.getQueryData<ConversationDetail>(["conversation", id]);
      if (prev) {
        const optimistic: Message = { id: `tmp-${Date.now()}`, conversationId: id, role: "user", parts: [{ type: "text", text }], createdAt: new Date().toISOString() };
        qc.setQueryData<ConversationDetail>(["conversation", id], { ...prev, messages: [...prev.messages, optimistic] });
      }
      useLive.getState().apply({ type: "run.started", runId: "pending", conversationId: id });
    },
    onError: (e) => {
      useLive.getState().clear(id);
      setError(e instanceof ApiError ? e.message : "Couldn't send that.");
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
    },
  });

  const stop = useMutation({ mutationFn: () => api.stop(id) });

  const actions = useMemo(() => new Map<string, PendingAction>((detail.data?.actions ?? []).map((a) => [a.id, a])), [detail.data?.actions]);
  const messages = detail.data?.messages ?? [];
  const busy = !!run?.active || send.isPending;

  // Stick to the bottom while new content streams in, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: messages.length < 3 ? "auto" : "smooth" });
  }, [messages.length, run?.text, run?.steps.length, frame?.at, atBottom]);

  useEffect(() => {
    composer.current?.focus();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <div className="h-full flex flex-col">
      <header className="drag h-[52px] shrink-0 flex items-center justify-center px-6 border-b border-line/0">
        <h1 className="text-[13.5px] font-medium text-ink-2 truncate max-w-[60%]">{detail.data?.conversation.title ?? ""}</h1>
      </header>

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-8 pt-6 pb-10 space-y-7">
          {messages.length === 0 && !run && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-[14vh] flex flex-col items-center text-center">
              <LogoMark size={44} />
              <h2 className="font-display text-[34px] mt-5">What should we get done?</h2>
              <p className="text-muted text-[14px] mt-2 max-w-md">Say it in plain words. RelayIt finds the way, and checks with you before anything important happens.</p>
              <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-lg">
                {["Order something from California Pizza", "What needs me today?", "Find a train to Mysuru tomorrow morning", "Try a demo action"].map((s) => (
                  <button key={s} onClick={() => send.mutate(s)} className="h-8 px-3.5 rounded-full border border-line bg-surface text-[13px] text-ink-2 hover:text-ink hover:border-line-strong transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {messages.map((m, i) => (
            <MessageView key={m.id} message={m} actions={actions} isLast={i === messages.length - 1 && !run} onChoice={(t) => send.mutate(t)} />
          ))}
          {run && <LiveRunView run={run} frame={frame} />}
          {error && <div className="text-[13px] text-danger bg-danger-soft rounded-[12px] px-4 py-2.5">{error}</div>}
        </div>
      </div>

      <div className="shrink-0 relative">
        {!atBottom && (
          <button
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
            className="absolute -top-12 left-1/2 -translate-x-1/2 size-8 rounded-full bg-surface border border-line-strong shadow-md flex items-center justify-center text-muted hover:text-ink"
            aria-label="Scroll to latest"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
        <div className="max-w-[760px] mx-auto px-8 pb-6 pt-1">
          <Composer ref={composer} onSend={(t) => send.mutate(t)} busy={busy} onStop={() => stop.mutate()} placeholder="Reply, or ask for something new…" />
        </div>
      </div>
    </div>
  );
}
