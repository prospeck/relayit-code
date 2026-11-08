// Starting a relay: a fresh thread on RelayIt with the words in it. And the one event that puts the cursor in
// Today's box from anywhere (the sidebar's +, the Quick Relay shortcut).
import { api, type Action, type Bot } from "@/state/store";

const FOCUS = "relayit:focus-compose";

export function focusRelayComposer(text?: string): void {
  // After the view switch has painted.
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(FOCUS, { detail: text })));
}

export function onFocusRelayComposer(listener: (text: string | undefined) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string | undefined>).detail);
  window.addEventListener(FOCUS, handle);
  return () => window.removeEventListener(FOCUS, handle);
}

/** Opens a new thread on `bot`, shows it, and sends `text` there. Rejects with the server's words when it can't. */
export async function startRelay(dispatch: (action: Action) => void, bot: Pick<Bot, "id">, text: string): Promise<void> {
  const created = await api<{ bot?: Bot }>(`/api/bots/${bot.id}/tasks`, { method: "POST", body: "{}" });
  if (!created?.bot) throw new Error("RelayIt could not start a new relay.");
  dispatch({ type: "taskSwitched", bot: created.bot });
  dispatch({ type: "select", id: bot.id });
  dispatch({ type: "send", botId: bot.id, text, threadId: created.bot.threadId });
}
