import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { PaymentLinkStatus } from "./razorpay.ts";

const createSchema = z.object({
  amount: z.number().int().min(1).max(10_000_000),
  currency: z.literal("INR"),
  description: z.string(),
  reference_id: z.string().min(1),
  customer: z
    .object({ name: z.string(), email: z.string().optional(), contact: z.string().optional() })
    .optional(),
  expire_by: z.number().int().positive().optional(),
  reminder_enable: z.literal(false),
});

type MockLink = z.infer<typeof createSchema> & {
  id: string;
  short_url: string;
  status: PaymentLinkStatus;
  payments: { payment_id: string }[];
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function checkoutPage(link: MockLink): string {
  const amount = `₹${(link.amount / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const pending = link.status === "created" || link.status === "partially_paid";
  const heading = pending
    ? "A little peace of mind."
    : link.status === "paid"
      ? "You’re all done."
      : "Request closed.";
  const message = pending
    ? "Review your test payment below."
    : link.status === "paid"
      ? "Test payment recorded. No money moved."
      : `This test request is ${link.status}. No money moved.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RelayIt · Test checkout</title><style>
*{box-sizing:border-box}body{margin:0;padding:48px 20px;background:#f3f5ef;color:#233d34;font:15px/1.6 system-ui,sans-serif}
main{max-width:400px;margin:0 auto;background:#fffef9;border:1px solid #dfe6db;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px #233d3409}
.ribbon{text-align:center;padding:9px;background:#e9efdd;color:#526641;font-size:11px;font-weight:750;letter-spacing:.2em}
.content{padding:32px}.brand{font-size:14px;font-weight:750;letter-spacing:-.03em}.mark{display:inline-grid;place-items:center;background:#e4eee6;border-radius:12px;width:38px;height:38px;margin-right:10px}
h1{font-size:25px;line-height:1.25;letter-spacing:-.045em;margin:32px 0 8px}p{color:#69796d;margin:0}.amount{font-size:clamp(32px,9vw,46px);font-weight:650;letter-spacing:-.05em;margin:28px 0 0;font-variant-numeric:tabular-nums}
.payee{overflow-wrap:anywhere;color:#506359;margin:4px 0 28px}.label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#7b887c}.divider{height:1px;background:#e8ece3;margin:24px 0}
button{width:100%;border:0;border-radius:12px;padding:15px 10px;font:600 14px system-ui;cursor:pointer}.pay{background:#295941;color:white}.cancel{margin-top:10px;background:#eef2e9;color:#526452}
button:hover{filter:brightness(.96)}button:focus-visible{outline:3px solid #9db799;outline-offset:3px}footer{text-align:center;font-size:11px;color:#7a877b;margin-top:25px}.done{padding:16px;border-radius:12px;background:#e9f1e5;color:#355c42;text-align:center}
</style></head><body><main><div class="ribbon">TEST MODE · NO REAL MONEY</div><div class="content">
<div class="brand"><span class="mark" aria-hidden="true">↗</span>RelayIt</div>
<h1>${heading}</h1><p role="status">${message}</p><div class="amount">${amount}</div>
<div class="label">Paying</div><div class="payee">${escapeHtml(link.description || "RelayIt test merchant")}</div><div class="divider"></div>
${
  pending
    ? `<form method="post" action="/pay/${link.id}/complete"><button class="pay" type="submit">Pay ${amount} (test)</button></form>
<form method="post" action="/pay/${link.id}/cancel"><button class="cancel" type="submit">Cancel</button></form>`
    : `<div class="done">${link.status === "paid" ? "✓ Test payment complete" : "Test checkout closed"}</div>`
}
<footer>A local simulation. No bank details or UPI PIN needed.</footer></div></main></body></html>`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startMockCheckout({ port = 0 }: { port?: number } = {}) {
  const links = new Map<string, MockLink>();
  // eslint-disable-next-line prefer-const -- assigned once the server is listening
  let origin: string;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 400, { error: "Invalid checkout request" });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && path === "/v1/payment_links") {
      // Browser forms must not create local links on behalf of another origin.
      if (req.headers.origin && req.headers.origin !== origin) {
        sendJson(res, 403, { error: "Origin not allowed" });
        return;
      }
      const input = createSchema.safeParse(await readJson(req));
      if (!input.success) {
        sendJson(res, 400, { error: "Invalid payment-link input" });
        return;
      }
      if ([...links.values()].some((link) => link.reference_id === input.data.reference_id)) {
        sendJson(res, 409, { error: "Reference already exists" });
        return;
      }
      const id = `plink_${randomUUID().replaceAll("-", "")}`;
      const link: MockLink = {
        ...input.data,
        id,
        short_url: `${origin}/pay/${id}`,
        status: "created",
        payments: [],
      };
      links.set(id, link);
      sendJson(res, 200, link);
      return;
    }
    const api = /^\/v1\/payment_links\/([^/]+)$/.exec(path);
    const page = /^\/pay\/([^/]+)(?:\/(complete|cancel))?$/.exec(path);
    const id = api?.[1] ?? page?.[1];
    const link = id ? links.get(id) : undefined;
    if (!link) {
      sendJson(res, 404, { error: "Payment link not found" });
      return;
    }
    if (link.expire_by && link.expire_by <= Date.now() / 1000 && link.status === "created")
      link.status = "expired";
    if (api && req.method === "GET") {
      sendJson(res, 200, link);
      return;
    }
    const action = page?.[2];
    if (page && ((req.method === "GET" && !action) || (req.method === "POST" && action))) {
      if (req.method === "POST") {
        if (req.headers.origin && req.headers.origin !== origin) {
          sendJson(res, 403, { error: "Origin not allowed" });
          return;
        }
        if (link.status === "created") {
          link.status = action === "complete" ? "paid" : "cancelled";
          if (link.status === "paid")
            link.payments.push({ payment_id: `pay_mock_${randomUUID()}` });
        }
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(checkoutPage(link));
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock checkout failed to bind");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    port: address.port,
    origin,
    baseUrl: `${origin}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
