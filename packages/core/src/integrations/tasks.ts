import type { App } from "../app.ts";

/**
 * Keeps the Tasks board in sync with what RelayIt is doing:
 * approvals → "Needs you", multi-step work → "Working" → "Ready for review".
 */
export function trackTasks(app: App): void {
  const working = new Set<string>();
  app.bus.on((e) => {
    void (async () => {
      switch (e.type) {
        case "action.pending":
          await app.tasks.upsert({
            title: e.action.title,
            detail: e.action.amountInr ? `Waiting for your OK · ₹${e.action.amountInr}` : `Waiting for your OK · ${e.action.service}`,
            status: "needs_you", source: e.action.service, sourceRef: `action:${e.action.id}`, conversationId: e.action.conversationId,
          });
          app.bus.emit({ type: "tasks.updated" });
          break;
        case "action.updated": {
          const t = (await app.tasks.list()).find((x) => x.sourceRef === `action:${e.action.id}`);
          if (t && e.action.status !== "pending") {
            await app.tasks.setStatus(t.id, e.action.status === "failed" ? "review" : "done");
            app.bus.emit({ type: "tasks.updated" });
          }
          break;
        }
        case "run.step": {
          if (working.has(e.conversationId) || e.step.tool === "offer_quick_replies") return;
          working.add(e.conversationId);
          const conv = await app.chat.getConversation(e.conversationId);
          if (!conv || conv.kind === "brief") return;
          await app.tasks.upsert({ title: conv.title, detail: e.step.label, status: "working", source: "RelayIt", sourceRef: `conv:${conv.id}`, conversationId: conv.id });
          app.bus.emit({ type: "tasks.updated" });
          break;
        }
        case "run.finished":
        case "run.error": {
          if (!working.delete(e.conversationId)) return;
          const t = (await app.tasks.list("working")).find((x) => x.sourceRef === `conv:${e.conversationId}`);
          if (t) {
            await app.tasks.setStatus(t.id, "review");
            app.bus.emit({ type: "tasks.updated" });
          }
          break;
        }
      }
    })().catch(() => {});
  });
}
