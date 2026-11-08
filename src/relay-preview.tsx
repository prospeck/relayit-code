// Dev-only gallery of RelayIt's own surfaces over a fixed store, served at /relay-preview.html; not in the packaged
// app. ?view=today|chat&skin=daylight|midnight&lang=hi
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "@/components/ChatView";
import { RelaySidebar } from "@/components/relay/RelaySidebar";
import { TodayPage } from "@/components/relay/TodayPage";
import { loadLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, StoreContext, type AppState, type Bot, type Message } from "@/state/store";
import "./styles.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "today";
const skin = params.get("skin") ?? "daylight";
setAdvancedMode(false);
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "daylight");
await loadLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const AT = NOW - 6 * 60_000;
const message = (id: string, minutes: number, fields: Partial<Message>): Message =>
  ({ id, at: AT + minutes * 60_000, role: "bot", kind: "text", text: "", ...fields }) as Message;
const tool = (id: string, minutes: number, name: string): Message => message(id, minutes, { kind: "activity", tool: { name, ok: true } });

const ORDER = [
  "Order from California Pizza Kitchen",
  "1 × Margherita Pizza, 1 × Caesar Salad from California Pizza Kitchen. Delivered to Home, 12th Main, Indiranagar. Demo only; no real food or payment.",
  "To: California Pizza Kitchen",
  "Total: ₹593.00",
  "Items: 1 × Margherita Pizza, 1 × Caesar Salad",
  "Deliver to: Home: 12th Main, Indiranagar",
  "ETA: 35 min",
  "Breakdown: Items ₹498.00 + delivery ₹40.00 + platform ₹10.00 + GST ₹25.00 + packaging ₹20.00 = ₹593.00",
].join("\n");

const messages: Message[] = [
  message("ask", 0, { role: "user", text: "Order something from California Pizza" }),
  tool("t1", 0.2, "search_restaurants"),
  tool("t2", 0.4, "get_menu"),
  tool("t3", 0.6, "prepare_order"),
  message("reply", 0.8, { text: "I picked a Margherita and a Caesar salad from California Pizza Kitchen in Indiranagar, about 35 minutes away. Hold the button when you're happy and I'll place it; you'll pay in your own UPI app." }),
  message("card", 1, { kind: "options", text: ORDER, card: { title: "Approval needed", subtitle: ORDER, options: ["Allow", "Deny"], requestId: "req-1",
    requestType: "permission", tool: "mcp__india-food__place_order", verifiedPreview: true } }),
];

const PAYMENT = JSON.stringify({ type: "payment", id: "pay_1", orderId: "ord_1", amountInr: 593, payeeName: "California Pizza Kitchen",
  payeeVpa: "cpk.indiranagar@okaxis", status: "pending", upiUri: null, checkoutUrl: "http://127.0.0.1:8799/demo-checkout/pay_1", demo: true });
const paid: Message[] = [
  ...messages.slice(0, 5),
  message("card", 1, { kind: "options", text: ORDER, card: { title: "Approval needed", subtitle: ORDER, options: ["Allow", "Deny"], requestId: "req-1",
    requestType: "permission", tool: "mcp__india-food__place_order", verifiedPreview: true, answered: "allow" } }),
  tool("t4", 1.2, "place_order"),
  message("pay", 1.4, { kind: "activity", tool: { name: "mcp__india-payments__payments_create_request", ok: true, output: PAYMENT } }),
  message("after", 1.5, { text: "Ordered. Pay ₹593 in your UPI app and I'll keep an eye on the delivery." }),
];

const relayit: Bot = {
  id: "relayit", name: "RelayIt", title: "", description: "", notifications: true, unread: false, color: "coral", defaultBot: { person: "" },
  welcomed: true, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, threadId: "cpk", busy: true, activity: "waiting-on-you",
  tasks: [
    { threadId: "cpk", title: "Dinner from California Pizza Kitchen", createdAt: AT, lastThreadOrderAt: AT + 60_000, activity: "waiting-on-you", openAsks: 1 },
    { threadId: "priya", title: "Reply to Priya about Saturday", createdAt: NOW - 50 * 60_000, lastThreadOrderAt: NOW - 40 * 60_000, activity: "waiting-on-you", openAsks: 1 },
    { threadId: "train", title: "Train to Mysuru on Friday", createdAt: NOW - 3 * 60_000, lastThreadOrderAt: NOW - 60_000, busy: true, activity: "working" },
    { threadId: "bescom", title: "Pay the BESCOM electricity bill", createdAt: NOW - 5 * 3600_000, lastThreadOrderAt: NOW - 5 * 3600_000 },
    { threadId: "amma", title: "Gift ideas for Amma's birthday", createdAt: NOW - 26 * 3600_000, lastThreadOrderAt: NOW - 26 * 3600_000 },
  ],
  messages: view === "pay" ? paid : messages,
  ...(view === "pay" ? { busy: false, activity: "idle", tasks: [{ threadId: "cpk", title: "Dinner from California Pizza Kitchen", createdAt: AT, lastThreadOrderAt: AT + 90_000 }] } : {}),
} as unknown as Bot;

function Frame({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh w-full overflow-hidden bg-app text-ink">{children}</div>;
}

function Gallery() {
  const state: AppState = {
    ...initialState, bots: [relayit], selectedId: "relayit", connected: true, hydrated: true, activeView: view === "today" ? "today" : "chat",
    routines: [], routinesLoadState: "ready",
    config: { ...(initialState.config ?? {}), profile: { name: "Taran" } } as AppState["config"],
  };
  const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return (
    <StoreContext.Provider value={value}>
      <Frame>
        <RelaySidebar bot={relayit} open onClose={() => {}} />
        {view !== "today" ? <div className="flex min-w-0 flex-1 flex-col"><ChatView bot={relayit} /></div> : <TodayPage bot={relayit} />}
      </Frame>
    </StoreContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
