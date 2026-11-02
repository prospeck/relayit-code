import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RazorpayClient } from "../src/razorpay.ts";
import { startMockCheckout } from "../src/mockCheckout.ts";

let mock: Awaited<ReturnType<typeof startMockCheckout>>;
let client: RazorpayClient;
beforeAll(async () => {
  mock = await startMockCheckout();
  client = new RazorpayClient({
    keyId: "rzp_test_local",
    keySecret: "unused-local-placeholder",
    baseUrl: mock.baseUrl,
  });
});
afterAll(async () => {
  await mock?.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function create(description = "Asha’s store") {
  return client.createPaymentLink({ amountInr: 12345.67, description, referenceId: randomUUID() });
}

describe("Razorpay and local checkout", () => {
  it("creates a link, displays an Indian-formatted amount and payee, and records a simulated payment", async () => {
    const link = await create();
    expect(link).toMatchObject({ status: "created", amountInr: 12345.67 });
    const page = await (await fetch(link.checkoutUrl)).text();
    expect(page).toContain("₹12,345.67");
    expect(page).toContain("Asha’s store");
    expect(page).toContain("TEST MODE");
    expect(page).toContain("Pay ₹12,345.67 (test)");
    expect(page).toContain(">Cancel</button>");
    const done = await (await fetch(`${link.checkoutUrl}/complete`, { method: "POST" })).text();
    expect(done).toContain("Test payment complete");
    const paid = await client.getPaymentLink(link.id);
    expect(paid.status).toBe("paid");
    expect(paid.externalRef).toMatch(/^pay_mock_/);
    await fetch(`${link.checkoutUrl}/cancel`, { method: "POST" });
    expect((await client.getPaymentLink(link.id)).status).toBe("paid");
  });

  it("works without any API keys", async () => {
    const response = await fetch(`${mock.baseUrl}/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 10000000,
        currency: "INR",
        description: "Local merchant",
        reference_id: randomUUID(),
        reminder_enable: false,
      }),
    });
    expect(response.status).toBe(200);
    const link = (await response.json()) as { short_url: string };
    expect(await (await fetch(link.short_url)).text()).toContain("₹1,00,000.00");
  });

  it("cancels a request and keeps repeated completion attempts from changing it", async () => {
    const link = await create();
    const response = await fetch(`${link.checkoutUrl}/cancel`, { method: "POST" });
    expect(await response.text()).toContain("Test checkout closed");
    await fetch(`${link.checkoutUrl}/complete`, { method: "POST" });
    expect((await client.getPaymentLink(link.id)).status).toBe("cancelled");
  });

  it("expires a request and does not accept payment afterwards", async () => {
    const link = await client.createPaymentLink({
      amountInr: 10,
      description: "Expired",
      referenceId: randomUUID(),
      expireBy: Math.floor(Date.now() / 1000) - 1,
    });
    await fetch(`${link.checkoutUrl}/complete`, { method: "POST" });
    expect((await client.getPaymentLink(link.id)).status).toBe("expired");
  });

  it("escapes untrusted HTML in the checkout", async () => {
    const link = await create('<script>alert("x")</script> & shop');
    const page = await (await fetch(link.checkoutUrl)).text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain("&amp; shop");
  });

  it("rejects requests from another browser origin", async () => {
    const link = await create();
    const response = await fetch(`${link.checkoutUrl}/complete`, {
      method: "POST",
      headers: { Origin: "https://other.example" },
    });
    expect(response.status).toBe(403);
    expect((await client.getPaymentLink(link.id)).status).toBe("created");
  });

  it("rejects malformed API input and returns a not-found error", async () => {
    const response = await fetch(`${mock.baseUrl}/payment_links`, { method: "POST", body: "{}" });
    expect(response.status).toBe(400);
    await expect(client.getPaymentLink("missing")).rejects.toThrow("HTTP 404");
  });

  it.each(["rzp_live_not-supported", "", "other"])("refuses non-test key IDs", (keyId) => {
    expect(() => new RazorpayClient({ keyId, keySecret: "unused-local-placeholder" })).toThrow(
      "RelayIt only supports Razorpay test mode in this version",
    );
  });

  it("sends paise, INR, Basic auth and reminder_enable false, with optional customer and expiry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "plink_fixture",
          short_url: "http://localhost/pay/fixture",
          amount: 1999,
          currency: "INR",
          status: "created",
        }),
      ),
    );
    await client.createPaymentLink({
      amountInr: 19.99,
      description: "Tea",
      referenceId: "test-ref",
      customer: { name: "Test user", email: "test@example.com", contact: "test-contact" },
      expireBy: 2_000_000_000,
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${mock.baseUrl}/payment_links`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization?.startsWith("Basic ")).toBe(true);
    expect(JSON.parse(init?.body as string)).toEqual({
      amount: 1999,
      currency: "INR",
      description: "Tea",
      reference_id: "test-ref",
      reminder_enable: false,
      customer: { name: "Test user", email: "test@example.com", contact: "test-contact" },
      expire_by: 2_000_000_000,
    });
  });

  it.each(["created", "partially_paid", "paid", "cancelled", "expired"] as const)(
    "maps %s API status",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "plink_fixture",
            short_url: "http://localhost/pay/fixture",
            amount: 100,
            currency: "INR",
            status,
          }),
        ),
      );
      expect((await client.getPaymentLink("plink_fixture")).status).toBe(status);
    },
  );

  it("does not echo upstream error bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private upstream details", { status: 401 }),
    );
    await expect(client.getPaymentLink("plink_fixture")).rejects.toThrow(
      /^Razorpay payment-link request failed \(HTTP 401\)$/,
    );
  });

  it("rejects malformed responses and unsafe checkout URL schemes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await expect(client.getPaymentLink("plink_fixture")).rejects.toThrow("Invalid Razorpay");
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "plink_fixture",
          short_url: "javascript:alert(1)",
          amount: 100,
          currency: "INR",
          status: "created",
        }),
      ),
    );
    await expect(client.getPaymentLink("plink_fixture")).rejects.toThrow("Invalid Razorpay");
  });
});
