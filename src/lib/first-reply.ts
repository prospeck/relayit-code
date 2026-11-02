import type { AppState } from "@/state/store";

export function firstReplyPending(state: Pick<AppState, "bots" | "groups" | "hydrated">): boolean | null {
  if (!state.hydrated) return null;
  const answered = (usage: { turns: number } | null | undefined) => (usage?.turns ?? 0) > 0;
  return !state.bots.some((bot) => bot.tasks?.some((task) => answered(task.usage))) && !state.groups.some((group) => answered(group.usage));
}
