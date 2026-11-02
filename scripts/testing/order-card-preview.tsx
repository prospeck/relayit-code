import { createRoot } from "react-dom/client";
import { ApprovalCard } from "../../src/components/ApprovalCard";
import { PendingApprovalPanel, pendingApprovals } from "../../src/components/PendingApproval";
import { PaymentRequestCard } from "../../src/components/PaymentRequestCard";
import { ASK_QUIET_ANSWER, ASK_SECONDARY_BUTTON } from "../../src/components/AskCard";
import type { Message } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const { summary, payment } = await fetch("/__order-cards.json").then((response) => response.json());
applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "daylight" : "midnight");
const message: Message = { id: "order", role: "bot", kind: "options", card: {
  title: "Approval needed", subtitle: summary, options: ["Allow", "Deny"], requestId: "order", tool: "india_food_place_order",
} };
const pending = pendingApprovals([message])[0]!;
createRoot(document.getElementById("root")!).render(<main className="min-h-screen bg-app p-6 text-ink">
  <div className="mx-auto max-w-2xl space-y-6">
    <p className="text-sm text-ink-secondary">Mock data · existing approval and payment components · preview buttons are inert</p>
    <div className="rounded-2xl border border-hairline bg-card">
      <PendingApprovalPanel pending={pending} count={1} index={0} botName="Relay" actions={<>
        <button type="button" className={ASK_QUIET_ANSWER}>Deny</button>
        <button type="button" className={ASK_SECONDARY_BUTTON}>Allow once</button>
      </>} />
    </div>
    <PaymentRequestCard name="india_payments_payments_create_request" output={JSON.stringify(payment)} ok />
    <ApprovalCard bot={{ name: "Relay" }} message={{ ...message, card: { ...message.card!, answered: "allow" } }} />
  </div>
</main>);
