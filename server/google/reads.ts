import type { GmailMessage } from "../../connectors/google/src/client.ts";
import type { ConnectedReads, EmailHeader, ReadSession } from "../connected-reads.ts";
import { eventsFromData, SourceError } from "../connected-reads.ts";
import type { GoogleService } from "./service.ts";

const header = (message: GmailMessage): EmailHeader => ({ id: message.id, threadId: message.threadId, at: Date.parse(message.date) || 0, from: message.from, subject: message.subject, preview: message.snippet.slice(0, 300) });

export function createGoogleReads(service: GoogleService): ConnectedReads {
  const guarded = async <T>(app: "gmail" | "googlecalendar", read: () => Promise<T>): Promise<T> => {
    try { return await read(); }
    catch (error) { throw new SourceError(app, error instanceof Error ? error.message : "Google read failed"); }
  };
  return {
    connected: async () => {
      const status = await service.health();
      return status.mode === "none" ? null : { gmail: status.connected, googlecalendar: status.connected };
    },
    session(): ReadSession {
      return {
        events: (from, to) => guarded("googlecalendar", async () => eventsFromData(await (await service.client()).listEvents(new Date(from).toISOString(), new Date(to).toISOString()), { id: "primary", owned: true })),
        emails: (since, limit) => guarded("gmail", async () => {
          const client = await service.client();
          const emails: EmailHeader[] = [];
          let pageToken: string | undefined;
          do {
            const page = await client.listMessages(`in:inbox newer_than:${Math.max(1, Math.ceil((Date.now() - since) / 86400_000))}d`, Math.min(25, limit + 1 - emails.length), pageToken);
            for (const message of page.messages ?? []) emails.push(header(await client.getMessage(message.id)));
            pageToken = page.nextPageToken;
          } while (pageToken && emails.length <= limit);
          emails.sort((a, b) => b.at - a.at);
          return { emails: emails.slice(0, limit), more: emails.length > limit || !!pageToken };
        }),
        message: (id) => guarded("gmail", async () => {
          try { return header(await (await service.client()).getMessage(id)); }
          catch (error) { if ((error as { status?: number }).status === 404) return null; throw error; }
        }),
        thread: (id) => guarded("gmail", async () => (await (await service.client()).getThread(id)).messages.map((message) => ({ id: message.id, at: Date.parse(message.date) || 0, from: (/<([^>]+)>/.exec(message.from)?.[1] ?? message.from).trim().toLowerCase() }))),
        address: () => guarded("gmail", async () => (await (await service.client()).getProfile()).emailAddress.toLowerCase()),
      };
    },
  };
}
