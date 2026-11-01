import type { ModelProvider } from "../models/types.ts";
import { complete } from "../models/types.ts";

const KEYWORDS: Record<string, RegExp> = {
  email: /\b(e-?mail|mail|inbox|gmail|reply|replies|unread|newsletter|thread|send .* to)\b/i,
  calendar: /\b(calendar|meeting|meetings|events?|schedule|reschedule|free time|busy|today|tomorrow|week|standup|appointment|invite)\b/i,
  food: /\b(order|food|eat|hungry|pizza|biryani|dosa|burger|restaurant|swiggy|zomato|dinner|lunch|breakfast|snack|coffee|dessert|cart)\b/i,
  grocery: /\b(grocer(y|ies)|zepto|blinkit|instamart|milk|eggs|vegetables|swish|bigbasket)\b/i,
  travel: /\b(train|irctc|ticket|metro|namma metro|cab|uber|ola|rapido|auto|ride|travel|trip|flight|bus|station|pnr)\b/i,
  payments: /\b(pay|payment|upi|qr|bill|paid|refund|razorpay)\b/i,
  meetings: /\b(meeting notes?|transcript|wispr|call notes?|what did .* say)\b/i,
  web: /\b(search|look up|research|find out|news|latest|compare|review)\b/i,
  browser: /\b(website|site|browser|log ?in|book on|zepto|blinkit|swiggy|zomato|uber)\b/i,
  demo: /\b(demo|test action|try an action)\b/i,
};

/**
 * Picks which tool domains a request needs, so only those tools are sent to the model.
 * Uses the cheap model when configured; otherwise (or on failure) keyword heuristics.
 */
export async function routeDomains(opts: {
  text: string;
  available: string[];
  totalTools: number;
  provider?: ModelProvider | null;
  routerModel?: string | null;
  recentDomains?: string[];
}): Promise<string[] | "all"> {
  const { text, available } = opts;
  if (opts.totalTools <= 24) return "all";
  if (opts.provider && opts.routerModel) {
    try {
      const res = await complete(opts.provider, {
        model: opts.routerModel,
        system: `Classify which tool domains a personal-assistant request needs. Available domains: ${available.join(", ")}. Reply as JSON: {"domains": string[]} using only available domains. Include every plausibly needed domain (e.g. ordering food usually needs "food" and "payments"). Use [] if no tools are needed.`,
        messages: [{ role: "user", content: text.slice(0, 2000) }],
        maxTokens: 100,
        temperature: 0,
        json: true,
        signal: AbortSignal.timeout(8000),
      });
      const m = /\{[\s\S]*\}/.exec(res.text);
      const parsed = m ? (JSON.parse(m[0]) as { domains?: unknown }) : null;
      if (parsed && Array.isArray(parsed.domains)) {
        const picked = parsed.domains.filter((d): d is string => typeof d === "string" && available.includes(d));
        return withCompanions([...picked, ...(opts.recentDomains ?? [])], available);
      }
    } catch {
      /* fall through to heuristics */
    }
  }
  const picked = Object.entries(KEYWORDS).filter(([, re]) => re.test(text)).map(([d]) => d);
  // Whole intents that keywords miss.
  if (/\b(what needs me|needs (?:my|me)|my attention|morning brief|triage|what'?s (?:on|up) today)\b/i.test(text)) picked.push("email", "calendar");
  if (/\btell (?:my )?(?:manager|boss|team|him|her|them)\b|\blet (?:\w+ )?know\b/i.test(text)) picked.push("email");
  const merged = withCompanions([...picked, ...(opts.recentDomains ?? [])], available);
  return merged.length ? merged : "all";
}

function withCompanions(domains: string[], available: string[]): string[] {
  const set = new Set(domains);
  if (set.has("food") || set.has("grocery")) set.add("payments");
  if (set.has("food") || set.has("grocery") || set.has("travel")) set.add("browser");
  if (set.has("email")) set.add("calendar");
  return [...set].filter((d) => available.includes(d));
}
