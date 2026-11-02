// A model on a small machine has a few thousand tokens for everything, and a bot's whole prompt and tool list is more
// than that before the person says a word. It keeps what lets it do the person's task, and loses what it needs only to
// run a team, a computer or its own upkeep. Parts not named here stay, so a new safety section can't be dropped by omission.
import { contextTokensFor } from "./drivers/ollama-context.ts";

const NOT_FOR_A_SMALL_WINDOW: ReadonlySet<string> = new Set([
  "files", "shell", "computer", "team-computer", "plan", "cloud-home", "data", "coordination", "outstanding",
  "teammate-questions", "credential", "just-do-it", "routine", "active-routines", "profile", "learn", "section-context",
  "team-memory", "recent", "skills", "playbooks",
]);

/** Local models on machines up to 16 GB. Above that the window holds the whole prompt with room to work. */
export const smallWindowMachine = (tokens: number = contextTokensFor()) => tokens <= 16_384;

export const keepsForSmallWindow = (partId: string) => !NOT_FOR_A_SMALL_WINDOW.has(partId);

const TRAVEL_WORDS = /\b(?:trains?|metro|irctc|railways?|stations?|pnr|cabs?|taxi|uber|ola|rapido|flights?|travel|trip|tatkal)\b/i;
const FOOD_WORDS = /\b(?:food|eat|hungry|order|restaurants?|menu|lunch|dinner|breakfast|snack|pizza|biryani|burger|deliver(?:y)?)\b/i;
const PAYMENT_WORDS = /\b(?:order|pay|payment|upi|qr|razorpay|checkout|paid)\b/i;

/** A model on a small window can't hold every connector's tools, so a turn gets the ones its words point to. Food stays
 * unless the words are plainly about travel: "get me something from Truffles" names no food word, and must still work. */
export function indiaServersNotNeeded(recentUserText: string): string[] {
  const travel = TRAVEL_WORDS.test(recentUserText);
  const food = FOOD_WORDS.test(recentUserText);
  return [
    ...(travel ? [] : ["india-travel"]),
    ...(travel && !food ? ["india-food"] : []),
    ...(PAYMENT_WORDS.test(recentUserText) ? [] : ["india-payments"]),
  ];
}
