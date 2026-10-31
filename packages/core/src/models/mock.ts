import type { ChatMessage, ModelEvent, ModelProvider, ModelRequest, ToolCall } from "./types.ts";

/**
 * A deterministic, offline "model" for tests, CI and demo mode (RELAYIT_MOCK_MODEL=1).
 * It follows a few scripted flows so the whole product can be exercised without an API key.
 */
type Step = { text?: string; call?: { name: string; args: Record<string, unknown> } };

export class MockProvider implements ModelProvider {
  readonly id = "mock";
  private delayMs: number;
  constructor(delayMs = 12) {
    this.delayMs = delayMs;
  }

  async listModels(): Promise<string[]> {
    return ["mock-smart", "mock-fast"];
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    if (req.json) {
      yield { type: "text", delta: JSON.stringify(routeGuess(lastUser(req.messages))) };
      yield { type: "usage", inputTokens: 50, outputTokens: 10 };
      yield { type: "done", stopReason: "stop" };
      return;
    }
    const tools = new Set((req.tools ?? []).map((t) => t.name));
    const step = decide(req.messages, tools);
    if (step.text) {
      for (const word of step.text.split(/(?<=\s)/)) {
        if (req.signal?.aborted) return;
        yield { type: "text", delta: word };
        if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      }
    }
    if (step.call) {
      const call: ToolCall = { id: `mock_${Math.random().toString(36).slice(2, 10)}`, name: step.call.name, args: step.call.args, rawArgs: JSON.stringify(step.call.args) };
      yield { type: "tool_call", call };
    }
    yield { type: "usage", inputTokens: 400, outputTokens: 60 };
    yield { type: "done", stopReason: step.call ? "tool_use" : "end_turn" };
  }
}

const lastUser = (msgs: ChatMessage[]) => [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

function routeGuess(text: string) {
  const t = text.toLowerCase();
  const domains: string[] = [];
  if (/order|food|pizza|biryani|hungry|restaurant|dinner|lunch/.test(t)) domains.push("food", "payments");
  if (/mail|email|inbox|reply|gmail/.test(t)) domains.push("email");
  if (/calendar|meeting|event|schedule|today|tomorrow/.test(t)) domains.push("calendar");
  if (/train|irctc|metro|cab|uber|travel|trip|flight/.test(t)) domains.push("travel");
  if (/demo|test/.test(t)) domains.push("demo");
  return { domains: domains.length ? domains : ["general"], intent: t.slice(0, 80) };
}

function parse(content: string): any {
  const m = /<untrusted_data[^>]*>\n?([\s\S]*?)\n?<\/untrusted_data>/.exec(content);
  const raw = m?.[1] ?? content;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function decide(messages: ChatMessage[], tools: Set<string>): Step {
  const last = messages[messages.length - 1];
  const userText = lastUser(messages).toLowerCase();

  if (last?.role === "tool") {
    const out = parse(last.content);
    if (last.isError) return { text: `That didn't work: ${typeof out === "string" ? out : JSON.stringify(out)}` };
    switch (last.name) {
      case "demo_prepare_note":
        return { text: "I've drafted the note. ", call: { name: "demo_send_note", args: { to: out.to, subject: out.subject, body: out.body } } };
      case "demo_send_note":
        if (typeof out === "string" && /refused/i.test(out)) return { text: "No problem — I didn't send it." };
        return { text: `Done. The note to **${out.to ?? "them"}** was sent (demo, nothing left your machine).` };
      case "search_restaurants": {
        const r = out.results?.[0] ?? out[0];
        if (!r) return { text: "I couldn't find that restaurant." };
        return { text: `Found **${r.name}** in ${r.area}. `, call: { name: "get_menu", args: { restaurantId: r.id } } };
      }
      case "get_menu": {
        const items = (out.categories ?? []).flatMap((c: any) => c.items ?? []);
        const pick = items.find((i: any) => i.bestseller) ?? items[0];
        if (!pick) return { text: "The menu looks empty right now." };
        return { text: `Their bestseller is the ${pick.name}. `, call: { name: "prepare_order", args: { restaurantId: out.restaurant?.id ?? out.restaurantId, items: [{ itemId: pick.id, qty: 1 }], deliveryAddress: { label: "Home", line: "Home address" } } } };
      }
      case "prepare_order":
        return { text: `Cart ready: ₹${out.totalInr}. `, call: { name: "place_order", args: { cartId: out.cartId } } };
      case "place_order":
        if (typeof out === "string" && /refused/i.test(out)) return { text: "Okay, I've left the cart as it is." };
        return { text: `Order placed with ${out.restaurant?.name ?? "the restaurant"}. Scan the QR to pay ₹${out.amountInr} in your UPI app.` };
      default:
        return { text: `Here's what I found:\n\n\`\`\`json\n${JSON.stringify(out, null, 2).slice(0, 800)}\n\`\`\`` };
    }
  }

  if (/demo|test action|try an action/.test(userText) && tools.has("demo_prepare_note"))
    return { text: "Sure — let me draft a quick note first. ", call: { name: "demo_prepare_note", args: { to: "Priya", topic: "dinner on Friday" } } };

  const food = /order (something )?from (.+)|order (.+)/.exec(userText);
  if (food && tools.has("search_restaurants")) {
    const q = (food[2] ?? food[3] ?? "").replace(/[.?!]$/, "");
    return { text: "On it. ", call: { name: "search_restaurants", args: { query: q } } };
  }

  if (/^(hi|hello|hey)\b/.test(userText) && tools.has("offer_quick_replies"))
    return { text: "Hi! I'm running in demo mode. What should we do?", call: { name: "offer_quick_replies", args: { options: ["Try a demo action", "Order from California Pizza", "What can you do?"] } } };

  return {
    text:
      "I'm running in **demo mode** (no model connected), so I can only follow a few scripted flows. " +
      "Add an API key or start Ollama in Settings → Model to talk to me properly.",
  };
}
