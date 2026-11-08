// Two routines that make RelayIt part of the day, offered on Today until they are on: a morning brief (what needs you,
// your calendar, bills coming due) and a Sunday recap. Each is a plain routine on RelayIt, so Routines shows, edits and
// stops it like any other. A brief only reads: it never sends, pays or books.
import { useState } from "react";
import { Check, Sunrise, CalendarCheck } from "lucide-react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";

export const BRIEF_NAME = "Morning brief";
export const RECAP_NAME = "Weekly recap";
const DISMISSED = "relayit-habits-dismissed";

export const BRIEF_PROMPT = [
  "Morning brief for me. Six short lines at most, plain words, no preamble:",
  "1. What needs me today and why, from my email: anything urgent, replies people are waiting on, and bills or payments coming due (electricity, credit card, mobile or DTH recharge, rent, insurance) with the amount in ₹ and the due date.",
  "2. Today's calendar, with travel time where it matters.",
  "3. Anything still waiting for my OK in RelayIt.",
  "4. Anything you could not check, and why.",
  "This brief only reads. Never send, pay, order or book anything in it; offer to do it instead.",
].join("\n");

export const RECAP_PROMPT = [
  "Weekly recap for me, short:",
  "what RelayIt did for me this week, what is still open, what I approved spending (₹ totals), and what is coming up next week from my calendar and email.",
  "End with one or two things you could take off my plate next week. This recap only reads; never send, pay, order or book anything in it.",
].join(" ");

function dismissed(): boolean {
  try { return globalThis.localStorage?.getItem(DISMISSED) === "1"; } catch { return false; }
}

export function Habits({ bot }: { bot: Bot | undefined }) {
  const { state, dispatch } = useStore();
  const [hidden, setHidden] = useState(dismissed);
  if (!bot || hidden || state.routinesLoadState !== "ready") return null;
  const mine = state.routines.filter((routine) => routine.botId === bot.id);
  const brief = mine.some((routine) => routine.name === BRIEF_NAME);
  const recap = mine.some((routine) => routine.name === RECAP_NAME);
  if (brief && recap) return null;

  const create = (name: string, prompt: string, schedule: { type: "daily"; time: string; weekdays: number[] }) =>
    dispatch({ type: "createRoutine", input: { name, prompt, botId: bot.id, schedule, overlap: "skip" } });

  return (
    <section aria-label={t("relay.habits.title")} data-habits="" className="mt-9 rounded-3xl border border-hairline/60 p-5">
      <h2 className="text-[15px] font-semibold text-ink">{t("relay.habits.title")}</h2>
      <p className="mt-1 text-[13px] leading-[19px] text-ink-secondary">{t("relay.habits.subtitle")}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <HabitOption on={brief} icon={<Sunrise size={18} aria-hidden="true" />} title={t("relay.habits.brief")} detail={t("relay.habits.briefDetail")}
          onTurnOn={() => create(BRIEF_NAME, BRIEF_PROMPT, { type: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })} />
        <HabitOption on={recap} icon={<CalendarCheck size={18} aria-hidden="true" />} title={t("relay.habits.recap")} detail={t("relay.habits.recapDetail")}
          onTurnOn={() => create(RECAP_NAME, RECAP_PROMPT, { type: "daily", time: "18:00", weekdays: [0] })} />
      </div>
      <button type="button" onClick={() => { try { localStorage.setItem(DISMISSED, "1"); } catch {} setHidden(true); }}
        className="mt-3 rounded text-[12px] text-ink-tertiary hover:text-ink-secondary">{t("relay.habits.notNow")}</button>
    </section>
  );
}

function HabitOption({ on, icon, title, detail, onTurnOn }: { on: boolean; icon: React.ReactNode; title: string; detail: string; onTurnOn: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-ink/[0.035] p-3.5">
      <span className="mt-0.5 text-ink-secondary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[12px] leading-[17px] text-ink-secondary">{detail}</div>
      </div>
      {on ? (
        <span className="flex h-8 shrink-0 items-center gap-1 text-[12px] font-medium text-success"><Check size={14} aria-hidden="true" />{t("relay.habits.on")}</span>
      ) : (
        <button type="button" onClick={onTurnOn} className="h-8 shrink-0 rounded-full bg-ink px-3 text-[12px] font-semibold text-app hover:bg-ink/85">
          {t("relay.habits.turnOn")}
        </button>
      )}
    </div>
  );
}
