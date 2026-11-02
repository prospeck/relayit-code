import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { decodeMessage } from "../client.ts";
import type { CalendarEvent, CalendarTime, RawGmailMessage } from "../client.ts";
import { decodeHeader } from "../mime.ts";
import { FAKE_USER, seedEvents, seedMessages } from "./seed.ts";

export type FakeGoogleState = {
  messages: RawGmailMessage[];
  drafts: { id: string; message: RawGmailMessage }[];
  sent: RawGmailMessage[];
  events: CalendarEvent[];
};

function calendarTimestamp(time?: CalendarTime): number {
  // Date-only events use local midnight, and their end date is exclusive.
  return Date.parse(time?.dateTime ?? (time?.date ? `${time.date}T00:00:00+05:30` : ""));
}

function matches(message: RawGmailMessage, q: string, now: Date): boolean {
  const decoded = decodeMessage(message);
  const haystack = `${decoded.from} ${decoded.to} ${decoded.subject} ${decoded.body}`.toLowerCase();
  const terms = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return terms.every((term) => {
    const normalized = term.replace(/"/g, "").toLowerCase();
    const [key, ...rest] = normalized.split(":");
    const value = rest.join(":");
    switch (key) {
      case "is":
        return value === "unread"
          ? decoded.labelIds.includes("UNREAD")
          : haystack.includes(normalized);
      case "in":
        return decoded.labelIds.some((label) => label.toLowerCase() === value);
      case "from":
        return decoded.from.toLowerCase().includes(value);
      case "to":
        return `${decoded.to} ${decoded.cc}`.toLowerCase().includes(value);
      case "subject":
        return decoded.subject.toLowerCase().includes(value);
      case "label":
        return decoded.labelIds.some((label) => label.toLowerCase() === value);
      case "newer_than": {
        const days = /^(\d+)d$/.exec(value);
        return !!days && Number(message.internalDate) > now.getTime() - Number(days[1]) * 86400_000;
      }
      default:
        return haystack.includes(normalized);
    }
  });
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startFakeGoogle(
  options: { port?: number; now?: Date | number } = {},
): Promise<{
  url: string;
  close(): Promise<void>;
  state: FakeGoogleState;
}> {
  const now = new Date(options.now ?? Date.now());
  const state: FakeGoogleState = {
    messages: seedMessages(now),
    drafts: [],
    sent: [],
    events: seedEvents(now),
  };
  let sequence = 100;
  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  };
  const rawMessage = (raw: string, threadId?: string): RawGmailMessage => {
    const source = Buffer.from(raw, "base64url").toString("utf8");
    const split = source.indexOf("\r\n\r\n");
    if (split < 0) throw new Error("Malformed email");
    const headers = source
      .slice(0, split)
      .replace(/\r\n[ \t]+/g, " ")
      .split("\r\n")
      .map((line) => {
        const colon = line.indexOf(":");
        if (colon < 1) throw new Error("Malformed header");
        return { name: line.slice(0, colon), value: decodeHeader(line.slice(colon + 1).trim()) };
      });
    const transfer = headers.find(
      (h) => h.name.toLowerCase() === "content-transfer-encoding",
    )?.value;
    const body =
      transfer?.toLowerCase() === "base64"
        ? Buffer.from(source.slice(split + 4), "base64").toString("utf8")
        : source.slice(split + 4);
    const id = `msg-${sequence++}`;
    if (!headers.some((h) => h.name.toLowerCase() === "from"))
      headers.push({ name: "From", value: FAKE_USER });
    if (!headers.some((h) => h.name.toLowerCase() === "date"))
      headers.push({ name: "Date", value: now.toUTCString() });
    if (!headers.some((h) => h.name.toLowerCase() === "message-id"))
      headers.push({ name: "Message-ID", value: `<${id}@relayit.example.com>` });
    return {
      id,
      threadId: threadId ?? `thread-${sequence++}`,
      raw,
      labelIds: ["DRAFT"],
      internalDate: String(now.getTime()),
      snippet: body.slice(0, 180),
      payload: {
        mimeType: "text/plain",
        headers,
        body: { data: Buffer.from(body).toString("base64url"), size: Buffer.byteLength(body) },
      },
    };
  };
  const send = (message: RawGmailMessage): RawGmailMessage => {
    message.labelIds = ["SENT"];
    state.sent.push(message);
    state.messages.push(message);
    return message;
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (!/^Bearer\s+\S+$/i.test(request.headers.authorization ?? "")) {
        json(response, 401, { error: { code: 401, message: "Bearer token required" } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      const method = request.method;
      const gmail = "/gmail/v1/users/me";
      if (path === `${gmail}/profile` && method === "GET") {
        json(response, 200, {
          emailAddress: "aarav.mehta@example.com",
          messagesTotal: state.messages.length,
          threadsTotal: new Set(state.messages.map((m) => m.threadId)).size,
        });
        return;
      }
      if (path === `${gmail}/messages` && method === "GET") {
        const matchesQuery = state.messages
          .filter((m) => matches(m, url.searchParams.get("q") ?? "", now))
          .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
        const max = Math.max(
          1,
          Math.min(500, Number(url.searchParams.get("maxResults") ?? 100) || 100),
        );
        const offset = Number(url.searchParams.get("pageToken") ?? 0) || 0;
        json(response, 200, {
          messages: matchesQuery
            .slice(offset, offset + max)
            .map(({ id, threadId }) => ({ id, threadId })),
          resultSizeEstimate: matchesQuery.length,
          ...(offset + max < matchesQuery.length ? { nextPageToken: String(offset + max) } : {}),
        });
        return;
      }
      if (path === `${gmail}/drafts` && method === "POST") {
        const input = await readJson(request);
        const draft = {
          id: `draft-${sequence++}`,
          message: rawMessage(input.message.raw, input.message.threadId),
        };
        state.drafts.push(draft);
        json(response, 200, draft);
        return;
      }
      if (path === `${gmail}/drafts/send` && method === "POST") {
        const input = await readJson(request);
        const index = state.drafts.findIndex((d) => d.id === input.id);
        if (index >= 0) {
          json(response, 200, send(state.drafts.splice(index, 1)[0]!.message));
          return;
        }
      }
      if (path === `${gmail}/messages/send` && method === "POST") {
        const input = await readJson(request);
        json(response, 200, send(rawMessage(input.raw, input.threadId)));
        return;
      }
      if (path.startsWith(`${gmail}/messages/`) && method === "GET") {
        const message = state.messages.find(
          (m) => m.id === path.slice(`${gmail}/messages/`.length),
        );
        if (message) {
          json(response, 200, message);
          return;
        }
      }
      if (path.startsWith(`${gmail}/threads/`) && method === "GET") {
        const id = path.slice(`${gmail}/threads/`.length);
        const messages = state.messages
          .filter((m) => m.threadId === id)
          .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
        if (messages.length) {
          json(response, 200, { id, messages });
          return;
        }
      }
      if (path.startsWith(`${gmail}/drafts/`) && method === "GET") {
        const draft = state.drafts.find((d) => d.id === path.slice(`${gmail}/drafts/`.length));
        if (draft) {
          json(response, 200, draft);
          return;
        }
      }
      const calendar = "/calendar/v3/calendars/primary/events";
      if (path === calendar && method === "GET") {
        const from = Date.parse(url.searchParams.get("timeMin") ?? "");
        const to = Date.parse(url.searchParams.get("timeMax") ?? "");
        const min = Number.isNaN(from) ? -Infinity : from;
        const max = Number.isNaN(to) ? Infinity : to;
        const items = state.events
          .filter((e) => calendarTimestamp(e.end) > min && calendarTimestamp(e.start) < max)
          .sort((a, b) => calendarTimestamp(a.start) - calendarTimestamp(b.start));
        json(response, 200, { kind: "calendar#events", items });
        return;
      }
      if (path === calendar && method === "POST") {
        const input = await readJson(request);
        const event: CalendarEvent = { ...input, id: `event-${sequence++}`, status: "confirmed" };
        state.events.push(event);
        json(response, 200, event);
        return;
      }
      if (path.startsWith(`${calendar}/`)) {
        const index = state.events.findIndex((e) => e.id === path.slice(calendar.length + 1));
        if (index >= 0) {
          if (method === "GET") {
            json(response, 200, state.events[index]);
            return;
          }
          if (method === "PATCH") {
            const input = await readJson(request);
            const event = { ...state.events[index]!, ...input, id: state.events[index]!.id };
            state.events[index] = event;
            json(response, 200, event);
            return;
          }
          if (method === "DELETE") {
            state.events.splice(index, 1);
            response.writeHead(204).end();
            return;
          }
        }
      }
      json(response, 404, { error: { code: 404, message: "Not found" } });
    })().catch(() => {
      if (!response.headersSent)
        json(response, 400, { error: { code: 400, message: "Invalid request" } });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4599, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot start fake Google");
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
