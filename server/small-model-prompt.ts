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
