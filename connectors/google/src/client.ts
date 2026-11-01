import { bodyText, decodeHeader, encodeMessage } from "./mime.ts";
import type { GmailPart, MessageInput } from "./mime.ts";
export type { GmailPart, MessageInput } from "./mime.ts";

export type RawGmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
  raw?: string;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  references: string;
  inReplyTo: string;
  labelIds: string[];
  snippet: string;
  body: string;
};

export type CalendarTime = { dateTime?: string; date?: string; timeZone?: string };
export type CalendarEventInput = {
  summary?: string;
  description?: string;
  location?: string;
  start?: CalendarTime;
  end?: CalendarTime;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  timeZone?: string;
};
export type CalendarEvent = CalendarEventInput & { id: string; status?: string; htmlLink?: string };
export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId?: string;
};

export class GoogleApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`Google API request failed (${status})`);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export class GoogleAuthError extends GoogleApiError {
  constructor() {
    super(401);
    this.name = "GoogleAuthError";
    this.message = "Google authorization expired; reconnect Google";
  }
}

export function decodeMessage(message: RawGmailMessage): GmailMessage {
  const headers = new Map(
    (message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), decodeHeader(h.value)]),
  );
  return {
    id: message.id,
    threadId: message.threadId,
    from: headers.get("from") ?? "",
    to: headers.get("to") ?? "",
    cc: headers.get("cc") ?? "",
    subject: headers.get("subject") ?? "",
    date: headers.get("date") ?? "",
    messageId: headers.get("message-id") ?? "",
    references: headers.get("references") ?? "",
    inReplyTo: headers.get("in-reply-to") ?? "",
    labelIds: message.labelIds ?? [],
    snippet: message.snippet ?? "",
    body: message.payload ? bodyText(message.payload) : "",
  };
}

export class GoogleClient {
  private getAccessToken: () => Promise<string>;
  private gmailBase: string;
  private calendarBase: string;
  private fetcher: typeof globalThis.fetch;

  constructor(options: {
    getAccessToken: () => Promise<string>;
    gmailBase?: string;
    calendarBase?: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.gmailBase = (options.gmailBase ?? "https://gmail.googleapis.com").replace(/\/$/, "");
    this.calendarBase = (options.calendarBase ?? "https://www.googleapis.com/calendar/v3").replace(
      /\/$/,
      "",
    );
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new GoogleAuthError();
    if (!response.ok) throw new GoogleApiError(response.status);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private gmail(path: string): string {
    return `${this.gmailBase}/gmail/v1/users/me/${path}`;
  }
  private events(id?: string): string {
    return `${this.calendarBase}/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ""}`;
  }

  listMessages(
    q: string,
    maxResults = 25,
    pageToken?: string,
  ): Promise<{
    messages?: { id: string; threadId: string }[];
    resultSizeEstimate?: number;
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams({ q, maxResults: String(maxResults) });
    if (pageToken) params.set("pageToken", pageToken);
    return this.request(`${this.gmail("messages")}?${params}`);
  }
  async getMessage(id: string): Promise<GmailMessage> {
    return decodeMessage(
      await this.request<RawGmailMessage>(
        `${this.gmail(`messages/${encodeURIComponent(id)}`)}?format=full`,
      ),
    );
  }
  async getThread(id: string): Promise<{ id: string; messages: GmailMessage[] }> {
    const thread = await this.request<{ id: string; messages?: RawGmailMessage[] }>(
      `${this.gmail(`threads/${encodeURIComponent(id)}`)}?format=full`,
    );
    return { id: thread.id, messages: (thread.messages ?? []).map(decodeMessage) };
  }
  async createDraft(input: MessageInput): Promise<{ id: string; message: RawGmailMessage }> {
    return this.request(this.gmail("drafts"), "POST", {
      message: {
        raw: encodeMessage(input),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });
  }
  async getDraft(id: string): Promise<{ id: string; message: GmailMessage }> {
    const draft = await this.request<{ id: string; message: RawGmailMessage }>(
      `${this.gmail(`drafts/${encodeURIComponent(id)}`)}?format=full`,
    );
    return { id: draft.id, message: decodeMessage(draft.message) };
  }
  sendDraft(draftId: string): Promise<RawGmailMessage> {
    return this.request(this.gmail("drafts/send"), "POST", { id: draftId });
  }
  async sendMessage(input: MessageInput): Promise<RawGmailMessage> {
    return this.request(this.gmail("messages/send"), "POST", {
      raw: encodeMessage(input),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    });
  }
  async listEvents(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.request<{ items?: CalendarEvent[]; nextPageToken?: string }>(
        `${this.events()}?${params}`,
      );
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }
  getEvent(id: string): Promise<CalendarEvent> {
    return this.request(this.events(id));
  }
  insertEvent(event: CalendarEventInput): Promise<CalendarEvent> {
    return this.request(this.events(), "POST", event);
  }
  patchEvent(id: string, event: CalendarEventInput): Promise<CalendarEvent> {
    return this.request(this.events(id), "PATCH", event);
  }
  deleteEvent(id: string): Promise<void> {
    return this.request(this.events(id), "DELETE");
  }
  getProfile(): Promise<GmailProfile> {
    return this.request(this.gmail("profile"));
  }
}
