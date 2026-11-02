import { heuristicTriage } from "../../connectors/google/src/triage.ts";
import type { InboxTriage } from "../host/inbox-triage.ts";
import { PICKS_PER_TRIAGE } from "../host/check-plan.ts";
import type { ActPreview, KvAccess } from "../../connectors/google/src/contract.ts";
import { createGoogleTools } from "../../connectors/google/src/tools.ts";
import { googleToolAllowed, type GoogleBot } from "./access.ts";
import { googleMount } from "./mount.ts";
import { googleRpc, type GoogleRpcResult } from "./rpc.ts";
import { createGoogleReads } from "./reads.ts";
import type { GoogleService } from "./service.ts";

export function createGoogleHost(deps: {
  service: GoogleService;
  bot(id: string): GoogleBot | null | undefined;
  fullAccess(botId: string, threadId: string): boolean;
  confined(botId: string, threadId: string, frame: unknown): boolean;
  approve(botId: string, threadId: string, tool: string, preview: ActPreview, active: () => void): Promise<boolean>;
}) {
  const values = new Map<string, unknown>();
  const actions = new Map<string, Promise<GoogleRpcResult>>();
  const kv: KvAccess = {
    get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: async (key, value) => { if (values.size >= 1000) values.delete(values.keys().next().value!); values.set(key, value); },
  };
  const definitions = createGoogleTools({ getClient: () => deps.service.client() });
  return {
    reads: createGoogleReads(deps.service),
    inbox: {
      ready: () => deps.service.connected(),
      async triage(emails, dismissedFrom) {
        const candidates = emails.filter((email) => !dismissedFrom.some((from) => email.from.toLowerCase().includes(from.toLowerCase())));
        return heuristicTriage(candidates.map((email) => ({ ...email, snippet: email.preview })))
          .filter((decision) => decision.bucket === "needs_you").slice(0, PICKS_PER_TRIAGE)
          .map((decision) => ({ id: decision.id, why: decision.reason, needsReply: /send|question|RSVP/.test(decision.reason) }));
      },
    } satisfies Pick<InboxTriage, "ready" | "triage">,
    mayRead(botId: string, app: "gmail" | "googlecalendar") {
      const bot = deps.bot(botId);
      const name = app === "gmail" ? "gmail_search" : "calendar_list_events";
      return !!bot && googleToolAllowed(bot, { name, toolClass: "read" });
    },
    integration(botId: string, threadId: string, mint: () => string, url: string) {
      const bot = deps.bot(botId);
      if (!deps.service.configured() || !bot || !definitions.some((tool) => googleToolAllowed(bot, tool))) return null;
      return googleMount(mint(), url, threadId, deps.fullAccess(botId, threadId));
    },
    toolListing() {
      return Object.fromEntries(["gmail", "googlecalendar"].map((app) => [app, definitions.filter((tool) => tool.name.startsWith(app === "gmail" ? "gmail_" : "calendar_")).map(({ name, description }) => ({ name, description }))]));
    },
    handle(body: unknown, capability: { botId: string; threadId: string; generation: string }, assertActive: () => void) {
      return googleRpc(body, {
        actions, service: deps.service, threadId: capability.threadId, generation: capability.generation, assertActive, kv,
        authorize: (tool, args) => { const bot = deps.bot(capability.botId); return !!bot && googleToolAllowed(bot, tool, args); },
        fullAccess: () => deps.fullAccess(capability.botId, capability.threadId),
        confined: (name, args) => deps.confined(capability.botId, capability.threadId, { method: "tools/call", params: { name, arguments: args } }),
        approve: (name, preview) => deps.approve(capability.botId, capability.threadId, name, preview, assertActive),
      });
    },
  };
}
