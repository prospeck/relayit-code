import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/contract.ts";
import { GOOGLE_SCOPES } from "../src/oauth.ts";
import { checkGoogleAccess, GoogleApiError, GoogleAuthError, GoogleClient } from "../src/client.ts";
import { startFakeGoogle } from "../src/fake/index.ts";
import { createGoogleTools } from "../src/tools.ts";
import { heuristicTriage } from "../src/triage.ts";
import type { TriageClassifier } from "../src/triage.ts";

let fake: Awaited<ReturnType<typeof startFakeGoogle>>;
let client: GoogleClient;
const now = new Date("2026-11-01T05:30:00Z");

beforeEach(async () => {
  fake = await startFakeGoogle({ port: 0, now });
  client = new GoogleClient({
    getAccessToken: async () => "test-bearer",
    gmailBase: fake.url,
    calendarBase: `${fake.url}/calendar/v3`,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fake.close();
});

function context(key: string | null = "test-key"): ToolContext {
  const values = new Map<string, unknown>();
  const secretValues = new Map<string, string>();
  return {
    conversationId: "test-conversation",
    runId: "test-run",
    signal: new AbortController().signal,
    idempotencyKey: key,
    profile: null,
    memory: [],
    status() {},
    secrets: {
      async get(key) {
        return secretValues.get(key) ?? null;
      },
      async set(key, value) {
        secretValues.set(key, value);
      },
      async delete(key) {
        secretValues.delete(key);
      },
    },
    kv: {
      async get<T>(key: string) {
        return (values.get(key) as T | undefined) ?? null;
      },
      async set(key, value) {
        values.set(key, value);
      },
    },
  };
}
function tool(name: string, classify?: TriageClassifier) {
  const result = createGoogleTools({ getClient: async () => client, classify }).find(
    (t) => t.name === name,
  );
  if (!result) throw new Error(`Missing tool: ${name}`);
  return result;
}
async function search(query: string) {
  return (await client.listMessages(query, 25)).messages ?? [];
}

describe("Google REST client and fake", () => {
  it("seeds 25 emails, 18 threads and 10 Indian calendar events", async () => {
    expect(await client.getProfile()).toMatchObject({
      emailAddress: "aarav.mehta@example.com",
      messagesTotal: 25,
      threadsTotal: 18,
    });
    const events = await client.listEvents(
      "2026-10-26T00:00:00+05:30",
      "2026-11-02T00:00:00+05:30",
    );
    expect(events).toHaveLength(10);
    expect(events.every((e) => e.start?.timeZone === "Asia/Kolkata")).toBe(true);
  });

  it("decodes UTF-8 multipart mail, prefers nested plain text, and ignores attachments", async () => {
    const message = fake.state.messages[0]!;
    message.payload!.parts = [
      {
        mimeType: "text/html",
        body: { data: Buffer.from("<p>Wrong HTML alternative</p>").toString("base64url") },
      },
      {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("नमस्कार Aarav — उद्या भेटूया 🌾").toString("base64url") },
          },
          {
            mimeType: "text/plain",
            filename: "attachment.txt",
            body: { data: Buffer.from("ignore attachment").toString("base64url") },
          },
        ],
      },
    ];
    const decoded = await client.getMessage(message.id);
    expect(decoded.body).toBe("नमस्कार Aarav — उद्या भेटूया 🌾");
    expect(decoded).toMatchObject({
      from: "Kavya Rao <kavya.rao@greenpath.example.com>",
      subject: "Q3 deck review by tomorrow",
      messageId: "<msg-1@relayit.example.com>",
    });
    expect(decoded.labelIds).toContain("UNREAD");
  });

  it("strips HTML safely when plain text is absent", async () => {
    fake.state.messages[0]!.payload = {
      mimeType: "text/html",
      body: {
        data: Buffer.from(
          "<style>.hidden{}</style><p>नमस्कार &amp; hello</p><script>steal()</script><div>Meet at 3&nbsp;pm &#x1F331;.</div>",
        ).toString("base64url"),
      },
    };
    expect((await client.getMessage("msg-1")).body).toBe("नमस्कार & hello\nMeet at 3 pm 🌱.");
  });

  it.each([
    ["is:unread", "msg-1", "msg-11"],
    ["in:inbox", "msg-1", "msg-19"],
    ["from:kavya", "msg-1", "msg-2"],
    ["to:aarav.mehta", "msg-1", "msg-19"],
    ['subject:"Q3 deck"', "msg-1", "msg-2"],
    ["label:RECEIPTS", "msg-9", "msg-1"],
    ["electricity", "msg-10", "msg-1"],
  ])("filters search %s", async (query, included, excluded) => {
    const ids = (await search(query)).map((m) => m.id);
    expect(ids).toContain(included);
    expect(ids).not.toContain(excluded);
  });

  it("combines query filters and respects newer_than and maxResults", async () => {
    const ids = (await search("is:unread in:inbox newer_than:1d")).map((m) => m.id);
    expect(ids).toContain("msg-1");
    expect(ids).not.toContain("msg-18");
    const firstPage = await client.listMessages("", 2);
    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.nextPageToken).toBe("2");
    const nextPage = await client.listMessages("", 2, firstPage.nextPageToken);
    expect(nextPage.messages).toHaveLength(2);
    expect(
      nextPage.messages?.some((m) => firstPage.messages?.some((first) => first.id === m.id)),
    ).toBe(false);
  });

  it("encodes UTF-8 subjects and bodies and rejects header injection", async () => {
    const draft = await client.createDraft({
      to: '"Rao, Kavya" <kavya@example.com>',
      subject: "नमस्कार — पुढील बैठक 🌾",
      body: "नमस्कार\nSee you tomorrow.",
    });
    const raw = Buffer.from(draft.message.raw!, "base64url").toString("utf8");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    const decoded = await client.getDraft(draft.id);
    expect(decoded.message.subject).toBe("नमस्कार — पुढील बैठक 🌾");
    expect(decoded.message.body).toBe("नमस्कार\r\nSee you tomorrow.");
    await expect(
      client.sendMessage({
        to: "a@example.com\r\nBcc: attacker@example.com",
        subject: "hello",
        body: "hello",
      }),
    ).rejects.toThrow("line breaks");
    expect(fake.state.sent).toHaveLength(0);
  });

  it("returns typed 401 and other HTTP errors", async () => {
    await expect(client.getMessage("missing")).rejects.toMatchObject({
      status: 404,
      name: "GoogleApiError",
    });
    await expect(client.getMessage("missing")).rejects.toBeInstanceOf(GoogleApiError);
    const unauthenticated = new GoogleClient({
      getAccessToken: async () => "",
      gmailBase: fake.url,
    });
    await expect(unauthenticated.getProfile()).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(unauthenticated.getProfile()).rejects.toMatchObject({ status: 401 });
  });
});

describe("Google refusals", () => {
  const ALL_SCOPES = GOOGLE_SCOPES.join(" ");
  const SECRET_TEXT = "text that should never reach the model";
  const disabled = (service: string) => ({
    error: {
      code: 403,
      message: `${SECRET_TEXT} https://evil.example`,
      errors: [{ reason: "accessNotConfigured", message: SECRET_TEXT }],
      details: [
        {
          reason: "SERVICE_DISABLED",
          metadata: {
            service,
            consumer: "projects/4815",
            activationUrl: "https://evil.example/enable",
          },
        },
      ],
    },
  });
  const noScope = {
    error: {
      code: 403,
      message: SECRET_TEXT,
      errors: [{ reason: "insufficientPermissions" }],
      details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", metadata: {} }],
    },
  };
  const clientReturning = (respond: (url: string) => Response) =>
    new GoogleClient({
      getAccessToken: async () => "token",
      gmailBase: "https://gmail.test",
      calendarBase: "https://calendar.test/calendar/v3",
      fetch: (async (url: string) => respond(String(url))) as typeof fetch,
    });
  const respondWith = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });
  const ok = (url: string) =>
    respondWith(
      200,
      url.includes("gmail.test")
        ? { emailAddress: "me@example.com", messagesTotal: 1, threadsTotal: 1 }
        : { items: [] },
    );

  it("says a disabled API is disabled and links to Google's own console", async () => {
    const client = clientReturning(() => respondWith(403, disabled("gmail.googleapis.com")));
    const error = await client.getProfile().catch((e: GoogleApiError) => e);
    expect(error).toMatchObject({
      status: 403,
      failure: "api_disabled",
      service: "Gmail",
      actionUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=4815",
    });
  });

  it("keeps Google's free text and links out of the error", async () => {
    const client = clientReturning(() => respondWith(403, disabled("gmail.googleapis.com")));
    const error = (await client.getProfile().catch((e: GoogleApiError) => e)) as GoogleApiError;
    expect(error.message).not.toContain(SECRET_TEXT);
    expect(error.message).not.toContain("evil.example");
    expect(error.actionUrl).not.toContain("evil.example");
  });

  it("drops a reason that isn't a plain code, and survives a body that isn't JSON", async () => {
    const odd = clientReturning(() =>
      respondWith(403, { error: { errors: [{ reason: `${SECRET_TEXT} !` }] } }),
    );
    await expect(odd.getProfile()).rejects.toThrow("Google API request failed (403)");
    const html = clientReturning(() => new Response("<html>", { status: 403 }));
    await expect(html.getProfile()).rejects.toThrow("Google API request failed (403)");
  });

  it("reports both APIs when neither is turned on", async () => {
    const client = clientReturning((url) =>
      respondWith(
        403,
        disabled(
          url.includes("gmail.test") ? "gmail.googleapis.com" : "calendar-json.googleapis.com",
        ),
      ),
    );
    const { issues, email } = await checkGoogleAccess(client, ALL_SCOPES);
    expect(email).toBeNull();
    expect(issues.map((i) => [i.service, i.kind, i.actionUrl])).toEqual([
      [
        "Gmail",
        "api_disabled",
        "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=4815",
      ],
      [
        "Google Calendar",
        "api_disabled",
        "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=4815",
      ],
    ]);
  });

  it("spots unticked permission boxes without calling Google for them", async () => {
    const calls: string[] = [];
    const client = clientReturning((url) => {
      calls.push(url);
      return ok(url);
    });
    const { issues, email } = await checkGoogleAccess(
      client,
      "openid email https://www.googleapis.com/auth/calendar.events",
    );
    expect(issues.map((i) => [i.service, i.kind])).toEqual([["Gmail", "missing_permission"]]);
    expect(email).toBeNull();
    expect(calls.every((url) => url.includes("calendar.test"))).toBe(true);
  });

  it("names a permission refusal that Google reports at request time", async () => {
    const client = clientReturning(() => respondWith(403, noScope));
    const { issues } = await checkGoogleAccess(client, "");
    expect(issues.map((i) => i.kind)).toEqual(["missing_permission", "missing_permission"]);
  });

  it("confirms working access and finds the account's address", async () => {
    await expect(checkGoogleAccess(clientReturning(ok), ALL_SCOPES)).resolves.toEqual({
      issues: [],
      email: "me@example.com",
    });
  });

  it("tells a dead sign-in apart from being offline", async () => {
    const expired = new GoogleClient({
      getAccessToken: async () => {
        throw new Error("Google token exchange failed (400)");
      },
    });
    const offline = new GoogleClient({
      getAccessToken: async () => "token",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect((await checkGoogleAccess(expired, ALL_SCOPES)).issues[0]?.kind).toBe("reconnect");
    expect((await checkGoogleAccess(offline, ALL_SCOPES)).issues[0]?.kind).toBe("unreachable");
  });
});

describe("Gmail tools", () => {
  it("provides compact search results and enforces max <= 25", async () => {
    const searchTool = tool("gmail_search");
    expect(searchTool.input.safeParse({ query: "", max: 26 }).success).toBe(false);
    const results = await searchTool.run(
      searchTool.input.parse({ query: "from:kavya" }),
      context(),
    );
    expect(results[0]).toMatchObject({ id: "msg-1", unread: true });
    expect(Object.keys(results[0]).sort()).toEqual(
      ["id", "threadId", "from", "subject", "date", "snippet", "unread"].sort(),
    );
    expect(searchTool.untrustedOutput).toBe(true);
  });

  it("truncates thread bodies at 6000 characters and notes truncation", async () => {
    fake.state.messages[0]!.payload!.parts = [
      {
        mimeType: "text/plain",
        body: { data: Buffer.from("x".repeat(7000)).toString("base64url") },
      },
    ];
    const result = await tool("gmail_read_thread").run({ threadId: "thread-1" }, context());
    const first = result.messages.find((m: { id: string }) => m.id === "msg-1");
    expect(first.body).toHaveLength(6000);
    expect(first.truncated).toBe(true);
    expect(first.truncationNote).toContain("6000");
  });

  it("drafts a reply with correct To, Re, In-Reply-To, References, and thread ID", async () => {
    const thread = await client.getThread("thread-1");
    const latest = thread.messages.at(-1)!;
    const result = await tool("gmail_draft_reply").run(
      { threadId: "thread-1", body: "I will review the deck today.", replyAll: false },
      context(),
    );
    const draft = await client.getDraft(result.draftId);
    expect(draft.message).toMatchObject({
      to: "Kavya Rao <kavya.rao@greenpath.example.com>",
      subject: "Re: Q3 deck review by tomorrow",
      threadId: "thread-1",
      inReplyTo: latest.messageId,
      references: `${latest.references} ${latest.messageId}`.trim(),
    });
    expect(result.preview.details).toContainEqual({
      label: "Body",
      value: "I will review the deck today.",
    });
    expect(fake.state.sent).toHaveLength(0);
  });

  it("reply-all deduplicates addresses, handles quoted commas, and excludes the user", async () => {
    const thread = await client.getThread("thread-14");
    const incoming = thread.messages
      .filter((m) => !m.from.includes("aarav.mehta@example.com"))
      .at(-1)!;
    const message = fake.state.messages.find((m) => m.id === incoming.id)!;
    message.payload!.headers!.push({
      name: "Cc",
      value:
        '"Rao, Kavya" <kavya@example.com>, Aarav <aarav.mehta@example.com>, Sana <sana@greenpath.example.com>',
    });
    const result = await tool("gmail_draft_reply").run(
      { threadId: "thread-14", body: "Use events.", replyAll: true },
      context(),
    );
    const draft = await client.getDraft(result.draftId);
    expect(draft.message.to).toBe("Sana Iyer <sana@greenpath.example.com>");
    expect(draft.message.cc).toBe('"Rao, Kavya" <kavya@example.com>');
  });

  it("previews and sends a draft once across retries (including a fresh tools instance)", async () => {
    const draft = await client.createDraft({
      to: "Kavya <kavya@example.com>",
      subject: "Review",
      body: "x".repeat(500),
    });
    const send = tool("gmail_send");
    const ctx = context("draft-retry");
    const preview = await send.preview!({ draftId: draft.id }, ctx);
    expect(preview).toMatchObject({
      title: "Send email to Kavya",
      recipient: "Kavya <kavya@example.com>",
    });
    expect(preview.details?.find((d) => d.label === "Body")?.value).toHaveLength(400);
    expect(fake.state.sent).toHaveLength(0);
    const first = await send.run({ draftId: draft.id }, ctx);
    const second = await tool("gmail_send").run({ draftId: draft.id }, ctx);
    expect(second).toEqual(first);
    expect(await ctx.kv.get("gmail.sent.draft-retry")).toEqual(first);
    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.drafts).toHaveLength(0);
  });

  it("deduplicates concurrent sends and validates mutually exclusive send modes", async () => {
    const send = tool("gmail_send");
    const ctx = context();
    const input = {
      to: "friend@example.com",
      cc: "other@example.com",
      subject: "Hello",
      body: "Hello",
      threadId: "thread-1",
    };
    const [a, b] = await Promise.all([send.run(input, ctx), send.run(input, ctx)]);
    expect(a).toEqual(b);
    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0]!.threadId).toBe("thread-1");
    expect(send.input.safeParse({ ...input, draftId: "draft-1" }).success).toBe(false);
    await expect(send.run(input, context(null))).rejects.toThrow("idempotency key");
  });
});

describe("Calendar tools", () => {
  const input = {
    summary: "Deck review",
    start: { dateTime: "2026-11-03T15:00:00+05:30", timeZone: "Asia/Kolkata" },
    end: { dateTime: "2026-11-03T15:30:00+05:30", timeZone: "Asia/Kolkata" },
    attendees: [{ email: "kavya@example.com", displayName: "Kavya" }],
  };
  it("creates, previews, updates, and cancels idempotently without preview side effects", async () => {
    const create = tool("calendar_create_event");
    const ctx = context("create");
    const preview = await create.preview!(input, ctx);
    expect(preview.summary).toBe("Tue 3 Nov, 3:00–3:30 pm");
    expect(preview.details).toContainEqual({
      label: "Attendees",
      value: "Kavya <kavya@example.com>",
    });
    expect(fake.state.events).toHaveLength(10);
    const event = await create.run(input, ctx);
    expect(await create.run(input, ctx)).toEqual(event);
    expect(fake.state.events).toHaveLength(11);
    const update = tool("calendar_update_event");
    const changes = { eventId: event.id, summary: "Final deck review", location: "Office" };
    const updateCtx = { ...ctx, idempotencyKey: "update" };
    expect((await update.preview!(changes, updateCtx)).title).toBe(
      "Update event: Final deck review",
    );
    expect((await client.getEvent(event.id)).summary).toBe("Deck review");
    const updated = await update.run(changes, updateCtx);
    expect(updated.summary).toBe("Final deck review");
    expect(await update.run(changes, updateCtx)).toEqual(updated);
    const cancel = tool("calendar_cancel_event");
    const cancelCtx = { ...ctx, idempotencyKey: "cancel" };
    expect((await cancel.preview!({ eventId: event.id }, cancelCtx)).summary).toBe(preview.summary);
    expect(fake.state.events).toHaveLength(11);
    const cancelled = await cancel.run({ eventId: event.id }, cancelCtx);
    expect(await cancel.run({ eventId: event.id }, cancelCtx)).toEqual(cancelled);
    expect(fake.state.events).toHaveLength(10);
    await expect(client.getEvent(event.id)).rejects.toMatchObject({ status: 404 });
  });

  it("uses India day boundaries and Monday weeks around UTC midnight", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T20:00:00Z")); // Monday 01:30 IST.
    const list = vi.spyOn(client, "listEvents").mockResolvedValue([]);
    const events = tool("calendar_list_events");
    await events.run({ range: "today" }, context());
    expect(list).toHaveBeenLastCalledWith("2026-11-02T00:00:00+05:30", "2026-11-03T00:00:00+05:30");
    await events.run({ range: "tomorrow" }, context());
    expect(list).toHaveBeenLastCalledWith("2026-11-03T00:00:00+05:30", "2026-11-04T00:00:00+05:30");
    await events.run({ range: "week" }, context());
    expect(list).toHaveBeenLastCalledWith("2026-11-02T00:00:00+05:30", "2026-11-09T00:00:00+05:30");
    await events.run(
      { range: { from: "2026-11-04T10:00:00Z", to: "2026-11-04T12:00:00Z" } },
      context(),
    );
    expect(list).toHaveBeenLastCalledWith("2026-11-04T10:00:00Z", "2026-11-04T12:00:00Z");
  });

  it("handles all-day events and defaults event time zones to India", async () => {
    const create = tool("calendar_create_event");
    const parsed = create.input.parse({
      summary: "Holiday",
      start: { date: "2026-11-04" },
      end: { date: "2026-11-05" },
    });
    expect(parsed.start.timeZone).toBe("Asia/Kolkata");
    expect((await create.preview!(parsed, context())).summary).toContain("Wed 4 Nov, all day");
    const event = await create.run(parsed, context());
    const listed = await client.listEvents("2026-11-04T00:00:00Z", "2026-11-06T00:00:00Z");
    expect(listed.some((item) => item.id === event.id)).toBe(true);
    const nextDay = await client.listEvents(
      "2026-11-05T00:00:00+05:30",
      "2026-11-06T00:00:00+05:30",
    );
    expect(nextDay.some((item) => item.id === event.id)).toBe(false);
  });
});

describe("triage and untrusted mail", () => {
  it("classifies a direct manager deadline and bills as needs-you, newsletters as can-wait", async () => {
    const messages = await Promise.all(
      ["msg-1", "msg-10", "msg-12"].map((id) => client.getMessage(id)),
    );
    expect(heuristicTriage(messages)).toEqual([
      expect.objectContaining({ id: "msg-1", bucket: "needs_you" }),
      expect.objectContaining({ id: "msg-10", bucket: "needs_you" }),
      expect.objectContaining({ id: "msg-12", bucket: "can_wait" }),
    ]);
  });

  it("treats the injection email as data and never sends mail or mutates calendar", async () => {
    const triage = tool("gmail_triage");
    const ctx = context();
    const result = await triage.run(triage.input.parse({}), ctx);
    expect(triage.untrustedOutput).toBe(true);
    expect([...result.needsYou, ...result.canWait]).toContainEqual(
      expect.objectContaining({ id: "msg-16" }),
    );
    expect(result.needsYou).toContainEqual(expect.objectContaining({ id: "msg-1" }));
    expect(result.canWait).toContainEqual(expect.objectContaining({ id: "msg-12" }));
    expect(fake.state.sent).toHaveLength(0);
    expect(fake.state.drafts).toHaveLength(0);
    expect(fake.state.events).toHaveLength(10);
  });

  it("uses the injected classifier with minimal data and normalizes reasons to one line", async () => {
    const classify = vi.fn<TriageClassifier>(async (emails) =>
      emails.map((email) => ({
        id: email.id,
        bucket: "can_wait",
        reason: "Read later.\nNo response needed.",
      })),
    );
    const result = await tool("gmail_triage", classify).run({ days: 3 }, context());
    expect(classify).toHaveBeenCalledOnce();
    expect(Object.keys(classify.mock.calls[0]![0][0]!).sort()).toEqual(
      ["id", "from", "subject", "snippet"].sort(),
    );
    expect(result.needsYou).toHaveLength(0);
    expect(result.canWait[0].reason).toBe("Read later. No response needed.");
    expect(fake.state.sent).toHaveLength(0);
  });

  it("falls back if the injected classifier fails", async () => {
    const result = await tool("gmail_triage", async () => {
      throw new Error("LLM offline");
    }).run({ days: 3 }, context());
    expect(result.needsYou).toContainEqual(expect.objectContaining({ id: "msg-1" }));
    expect(result.canWait).toContainEqual(expect.objectContaining({ id: "msg-12" }));
  });

  it("triages all pages of recent unread inbox mail", async () => {
    for (let i = 0; i < 30; i++) {
      const source = structuredClone(fake.state.messages[0]!);
      source.id = `extra-${i}`;
      source.threadId = `extra-thread-${i}`;
      fake.state.messages.push(source);
    }
    const result = await tool("gmail_triage").run({ days: 3 }, context());
    const expected = fake.state.messages.filter(
      (m) => m.labelIds?.includes("INBOX") && m.labelIds.includes("UNREAD"),
    );
    expect(result.needsYou.length + result.canWait.length).toBe(expected.length);
  });
});
