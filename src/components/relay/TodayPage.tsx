// Today: RelayIt's home. The one box to say it in, the things you usually ask for, and every relay by where it stands:
// waiting on you first, then running, then what finished. Nothing here needs reading twice.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronRight, Mic } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { dateLocale, dayPart, firstName, relayStatus, relaysOf, type RelayStatus } from "@/lib/relay";
import { useComposerDictation } from "@/lib/use-composer-dictation";
import { openBotThread } from "@/state/thread-navigation";
import { useStore, type Bot, type Task } from "@/state/store";
import { useDesktopCapabilities, WindowDragStrip } from "../DesktopCapabilities";
import { LaneMark } from "../RelayItMark";
import { RelayMarker } from "./RelaySidebar";
import { onFocusRelayComposer, startRelay } from "./relay-compose";
import { useUsuals } from "./usuals";

function TodayComposer({ bot }: { bot: Bot | undefined }) {
  const { dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { recording, toggle: toggleMic, stop: stopMic } = useComposerDictation({
    draftId: "relayit-today", text, onText: setText, available: capabilities.dictation.available,
  });

  useEffect(() => onFocusRelayComposer((words) => {
    if (words !== undefined) setText(words);
    box.current?.focus();
  }), []);
  useEffect(() => {
    const field = box.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
  }, [text]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const words = text.trim();
    if (!words || !bot || busy) return;
    if (recording) stopMic();
    setBusy(true);
    setError(null);
    try {
      await startRelay(dispatch, bot, words);
      setText("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} data-today-composer="" className="mt-7">
      <div className={cn(
        "flex items-end gap-2 rounded-[26px] border border-hairline/60 bg-composer py-2.5 pl-5 pr-2.5 shadow-[0_1px_0_rgb(0_0_0/0.02),0_10px_30px_-18px_rgb(0_0_0/0.25)]",
        "focus-within:border-ink/30",
      )}>
        <label htmlFor="today-say" className="sr-only">{t("relay.today.sayLabel")}</label>
        <textarea
          id="today-say"
          ref={box}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keyDown}
          placeholder={t("relay.today.placeholder")}
          autoFocus
          className="min-h-[34px] flex-1 resize-none bg-transparent py-[6px] text-[16px] leading-[22px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        {capabilities.dictation.available && (
          <button type="button" onClick={toggleMic}
            aria-label={recording ? t("composer.dictation.stop") : t("composer.dictation.start")}
            title={recording ? t("composer.dictation.stopHint") : t("composer.dictation.hint")}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full",
              recording ? "animate-pulse bg-accent/20 text-accent-text" : "text-ink-secondary hover:bg-ink/[0.06] hover:text-ink")}>
            <Mic size={18} aria-hidden="true" />
          </button>
        )}
        <button type="submit" disabled={!text.trim() || !bot || busy} aria-label={t("relay.today.send")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[color:var(--color-accent-ink)] transition-opacity disabled:bg-ink/10 disabled:text-ink-tertiary">
          <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3 px-5 text-[12px] text-ink-tertiary">
        <span>{t("relay.today.hint")}</span>
        {window.ogb && <span className="ml-auto">{t("relay.today.quick", { keys: navigator.platform.includes("Mac") ? "⌥ Space" : "Alt+Space" })}</span>}
      </div>
      {error && <p role="alert" className="mt-2 px-5 text-[13px] text-danger">{error}</p>}
    </form>
  );
}

function Usuals() {
  const usuals = useUsuals();
  if (!usuals.length) return null;
  return (
    <section aria-label={t("relay.today.usuals")} className="mt-5 flex flex-wrap gap-2">
      {usuals.map((usual) => (
        <button key={usual.text} type="button" data-usual=""
          onClick={() => window.dispatchEvent(new CustomEvent("relayit:focus-compose", { detail: usual.text }))}
          className="rounded-full border border-hairline/60 bg-app px-3.5 py-1.5 text-[13px] text-ink-secondary transition-colors hover:border-ink/25 hover:text-ink">
          {usual.label}
        </button>
      ))}
    </section>
  );
}

function RelayRow({ task, status, onOpen }: { task: Task; status: RelayStatus; onOpen: () => void }) {
  const when = new Date(task.lastThreadOrderAt ?? task.updatedAt ?? task.createdAt);
  const time = new Intl.DateTimeFormat(dateLocale(activeLocale()), sameDay(when) ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" }).format(when);
  return (
    <li>
      <button type="button" onClick={onOpen} data-today-relay={status}
        className={cn("group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
          status === "yours" ? "bg-accent/[0.07] hover:bg-accent/[0.11]" : "hover:bg-ink/[0.04]")}>
        <span className="flex w-3 shrink-0 justify-center"><RelayMarker status={status} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{task.title || t("relay.untitled")}</span>
          <span className={cn("block text-[13px]", status === "yours" ? "text-accent-text" : "text-ink-tertiary")}>
            {t(status === "yours" ? "relay.today.waitsOnYou" : status === "running" ? "relay.today.onIt" : "relay.today.finished")}
          </span>
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">{time}</span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100" />
      </button>
    </li>
  );
}

function sameDay(date: Date, now = new Date()): boolean {
  return date.toDateString() === now.toDateString();
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-9">
      <h2 className="flex items-baseline gap-2 px-4 text-[13px] font-semibold text-ink">
        {title}{count !== undefined && <span className="font-normal tabular-nums text-ink-tertiary">{count}</span>}
      </h2>
      <ul className="mt-2 flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

export function TodayPage({ bot }: { bot: Bot | undefined }) {
  const { state, dispatch } = useStore();
  const now = new Date();
  const name = firstName(state.config?.profile?.name);
  const relays = relaysOf(bot?.tasks);
  const yours = relays.filter((task) => relayStatus(task) === "yours");
  const running = relays.filter((task) => relayStatus(task) === "running");
  const done = relays.filter((task) => relayStatus(task) === "done").slice(0, 5);
  const open = (task: Task) => bot && openBotThread(dispatch, bot, task.threadId, true);
  const date = new Intl.DateTimeFormat(dateLocale(activeLocale()), { weekday: "long", day: "numeric", month: "long" }).format(now);
  const greeting = t(`relay.today.greeting.${dayPart(now)}`, { name });

  return (
    <main data-today="" className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="mx-auto w-full max-w-[680px] px-6 pb-20 pt-[min(14vh,120px)]">
        <p className="px-1 text-[13px] font-medium text-ink-tertiary">{date}</p>
        <h1 className="mt-1 px-1 font-display text-[32px] font-semibold leading-[40px] tracking-[-0.03em] text-ink">
          {name ? greeting : t(`relay.today.greetingAlone.${dayPart(now)}`)}
        </h1>
        <TodayComposer bot={bot} />
        <Usuals />
        {yours.length > 0 && (
          <Section title={t("relay.today.yourTurn")} count={yours.length}>
            {yours.map((task) => <RelayRow key={task.threadId} task={task} status="yours" onOpen={() => open(task)} />)}
          </Section>
        )}
        {running.length > 0 && (
          <Section title={t("relay.today.running")} count={running.length}>
            {running.map((task) => <RelayRow key={task.threadId} task={task} status="running" onOpen={() => open(task)} />)}
          </Section>
        )}
        {done.length > 0 && (
          <Section title={t("relay.today.done")}>
            {done.map((task) => <RelayRow key={task.threadId} task={task} status="done" onOpen={() => open(task)} />)}
          </Section>
        )}
        {relays.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <LaneMark size={40} className="opacity-80" />
            <p className="max-w-[360px] text-[14px] leading-[21px] text-ink-secondary">{t("relay.today.empty")}</p>
          </div>
        )}
        {relays.length > 0 && yours.length === 0 && running.length === 0 && (
          <p className="mt-9 px-4 text-[14px] text-ink-tertiary">{t("relay.today.allClear")}</p>
        )}
      </div>
    </main>
  );
}
