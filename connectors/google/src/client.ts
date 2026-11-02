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

export type GoogleFailure = "api_disabled" | "missing_permission" | "rate_limited" | "other";
export type GoogleService = "Gmail" | "Google Calendar";

const SERVICE_IDS: Record<GoogleService, string> = {
  Gmail: "gmail.googleapis.com",
  "Google Calendar": "calendar-json.googleapis.com",
};

const DISABLED_REASONS = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);
const PERMISSION_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

export function enableApiUrl(service: GoogleService, project?: string): string {
  const url = new URL(`https://console.cloud.google.com/apis/library/${SERVICE_IDS[service]}`);
  if (project) url.searchParams.set("project", project);
  return url.toString();
}

export class GoogleApiError extends Error {
  status: number;
  failure: GoogleFailure;
  service?: GoogleService;
  /** Where the user can turn the API on, when that is what's wrong. */
  actionUrl?: string;
  constructor(
    status: number,
    details: { reason?: string; project?: string; service?: GoogleService } = {},
  ) {
    const { reason, project, service } = details;
    const name = service ?? "this Google service";
    const failure: GoogleFailure =
      reason && DISABLED_REASONS.has(reason)
        ? "api_disabled"
        : reason && PERMISSION_REASONS.has(reason)
          ? "missing_permission"
          : status === 429 || (reason && RATE_REASONS.has(reason))
            ? "rate_limited"
            : "other";
    const actionUrl = failure === "api_disabled" && service && enableApiUrl(service, project);
    super(
      actionUrl
        ? `The ${name} API is turned off in your Google Cloud project. Turn it on at ${actionUrl}, wait a minute, and try again.`
        : failure === "missing_permission"
          ? `Google hasn't given RelayIt permission to use ${name}. In Connections, reconnect Google and tick every box on Google's permission screen.`
          : failure === "rate_limited"
            ? `Google is limiting requests to ${name} right now. Try again in a few minutes.`
            : `Google API request failed (${status}${reason ? `: ${reason}` : ""})`,
    );
    this.name = "GoogleApiError";
    this.status = status;
    this.failure = failure;
    if (service) this.service = service;
    if (actionUrl) this.actionUrl = actionUrl;
  }
}

/**
 * Pulls only Google's machine-readable codes out of an error body. Its free-text fields stay out
 * of errors because they reach the model and the audit log.
 */
async function readFailure(response: Response): Promise<{ reason?: string; project?: string }> {
  type Body = {
    error?: {
      errors?: { reason?: unknown }[];
      details?: { reason?: unknown; metadata?: { consumer?: unknown } }[];
    };
  };
  const body = (await response.json().catch(() => null)) as Body | null;
  const info = body?.error?.details?.find((d) => typeof d?.reason === "string");
  const reason = info?.reason ?? body?.error?.errors?.[0]?.reason;
  const project = /^projects\/(\d+)$/.exec(String(info?.metadata?.consumer ?? ""))?.[1];
  return {
    ...(typeof reason === "string" && /^\w{1,64}$/.test(reason) ? { reason } : {}),
    ...(project ? { project } : {}),
  };
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
    const service: GoogleService = url.startsWith(this.gmailBase) ? "Gmail" : "Google Calendar";
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new GoogleAuthError();
    if (!response.ok) {
      throw new GoogleApiError(response.status, { ...(await readFailure(response)), service });
    }
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

export type GoogleIssue = {
  service: GoogleService;
  kind: GoogleFailure | "reconnect" | "unreachable";
  message: string;
  actionUrl?: string;
};

const REQUIRED_SCOPES: Record<GoogleService, string[]> = {
  Gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  "Google Calendar": ["https://www.googleapis.com/auth/calendar.events"],
};

function issueFrom(service: GoogleService, error: unknown): GoogleIssue {
  if (error instanceof GoogleAuthError) {
    return { service, kind: "reconnect", message: "Google needs you to sign in again." };
  }
  if (error instanceof GoogleApiError) {
    return {
      service,
      kind: error.failure,
      message: error.message,
      ...(error.actionUrl ? { actionUrl: error.actionUrl } : {}),
    };
  }
  const message = error instanceof Error ? error.message : "";
  return /token exchange|reconnect/i.test(message)
    ? { service, kind: "reconnect", message: "Google needs you to sign in again." }
    : { service, kind: "unreachable", message: `Couldn't reach ${service}. Check your internet.` };
}

/** Finds out what RelayIt can really use: Google can hand out a token that reaches neither API. */
export async function checkGoogleAccess(
  client: GoogleClient,
  grantedScope: string,
): Promise<{ issues: GoogleIssue[]; email: string | null }> {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  const missing = (service: GoogleService): GoogleIssue | null =>
    REQUIRED_SCOPES[service].some((scope) => !granted.has(scope))
      ? {
          service,
          kind: "missing_permission",
          message: `Google hasn't given RelayIt permission to use ${service}. Reconnect and tick every box on Google's permission screen.`,
        }
      : null;
  const now = new Date();
  const [gmail, calendar] = await Promise.all([
    client.getProfile().catch((error: unknown) => issueFrom("Gmail", error)),
    client
        .listEvents(now.toISOString(), new Date(now.getTime() + 60_000).toISOString())
        .then(() => null)
        .catch((error: unknown) => issueFrom("Google Calendar", error)),
  ]);
  const isIssue = (value: unknown): value is GoogleIssue =>
    typeof value === "object" && value !== null && "kind" in value;
  return {
    issues: [missing("Gmail"), missing("Google Calendar"), gmail, calendar].filter(isIssue).filter((issue, index, all) => all.findIndex((other) => other.service === issue.service && other.kind === issue.kind) === index),
    email: gmail && !isIssue(gmail) ? gmail.emailAddress : null,
  };
}
