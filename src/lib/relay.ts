// RelayIt's words for a job: a relay. One thing you asked for, run in legs (find, prepare, your OK, done), that comes
// back to you only when it needs you. Pure helpers, so Today, the sidebar and the chat agree on every state.
import type { Message, Task } from "@/state/store";

export type RelayStatus = "yours" | "running" | "done";

/** A relay needs you while something in it waits on you; it runs while a turn does; otherwise it is done. */
export function relayStatus(task: Pick<Task, "activity" | "busy" | "openAsks">): RelayStatus {
  if (task.activity === "waiting-on-you" || (task.openAsks ?? 0) > 0) return "yours";
  if (task.busy || task.activity === "working") return "running";
  return "done";
}

/** Newest first by the last thing that happened in it; archived and snoozed relays stay out, and so does a thread
 * nothing has happened in yet (RelayIt's own empty main thread). */
export function relaysOf(tasks: readonly Task[] | undefined, now = Date.now()): Task[] {
  return (tasks ?? [])
    .filter((task) => task.lastThreadOrderAt !== undefined || task.busy || task.activity === "working" || task.activity === "waiting-on-you")
    .filter((task) => !task.archivedAt && !(task.snoozedUntil && task.snoozedUntil > now) && !task.routineRunId)
    .sort((a, b) => (b.lastThreadOrderAt ?? b.updatedAt ?? b.createdAt) - (a.lastThreadOrderAt ?? a.updatedAt ?? a.createdAt));
}

/** Dates read the Indian way in English ("Sunday, 8 November"); other languages keep their own. */
export function dateLocale(locale: string): string {
  return locale === "en" ? "en-IN" : locale;
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** The first word of a name, for a greeting. */
export function firstName(name: string | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export interface MoneyPreview {
  title: string;
  summary: string;
  to: string;
  total: string;
  details: Array<{ label: string; value: string }>;
}

/** A verified purchase preview (server/tool-approval-preview.ts): title, summary, "To:", "Total:", then details. Only
 * for a card the server marked verifiedPreview; anything else stays the plain approval. */
export function moneyPreview(card: { verifiedPreview?: true; subtitle?: string } | undefined): MoneyPreview | null {
  if (!card?.verifiedPreview || !card.subtitle) return null;
  const [title, summary, toLine, totalLine, ...rest] = card.subtitle.split("\n");
  if (!title || !summary || !toLine?.startsWith("To: ") || !totalLine?.startsWith("Total: ")) return null;
  const details = rest.flatMap((line) => {
    const at = line.indexOf(": ");
    return at > 0 ? [{ label: line.slice(0, at), value: line.slice(at + 2) }] : [];
  });
  return { title, summary, to: toLine.slice(4), total: totalLine.slice(7), details };
}

/** The total split for type: "₹593.00" → { symbol: "₹", whole: "593", fraction: ".00" }. */
export function amountParts(total: string): { symbol: string; whole: string; fraction: string } {
  const match = /^(\D*)([\d,]+)(\.\d+)?$/.exec(total.trim());
  if (!match) return { symbol: "", whole: total, fraction: "" };
  return { symbol: match[1]!.trim(), whole: match[2]!, fraction: match[3] === ".00" ? "" : match[3] ?? "" };
}

export type RelayLeg = "find" | "prepare" | "ok" | "done";
export const RELAY_LEGS: readonly RelayLeg[] = ["find", "prepare", "ok", "done"];

const PREPARE = /(?:prepare|draft|quote|cart|preview|compose|create_draft)/i;

/** Where a relay is in its legs, from what the thread shows: a tool that prepares something moves it to Prepare, an
 * open approval to Your OK, and a finished turn with nothing waiting to Done. Before any of that it is finding. */
export function relayLeg(messages: readonly Message[], opts: { waiting: boolean; running: boolean }): RelayLeg {
  if (opts.waiting) return "ok";
  const asked = messages.some((message) => message.role === "user");
  if (!asked) return "find";
  if (!opts.running) return "done";
  let prepared = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") break;
    if (message.kind === "activity" && message.tool?.name && PREPARE.test(message.tool.name)) prepared = true;
  }
  return prepared ? "prepare" : "find";
}
