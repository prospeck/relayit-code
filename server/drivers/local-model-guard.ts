// Small local models tell a person they can't do something with the tools right there, ask in words instead of acting,
// and state prices they never looked up. A prompt rule doesn't hold them to it: these send the reply back before the
// person sees it. Hosted models don't need this and never get it.
const AMOUNT = /(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d+)?)/gi;
const NO_ACCESS = /\b(?:don['’]?t|do not|can['’]?t|cannot|unable to)\b[^.!?\n]{0,30}\b(?:have )?(?:direct )?access\b|\bno access\b/i;
const NO_SERVICE = /\b(?:can['’]?t|cannot|unable to)\b[^.!?\n]{0,50}\b(?:order(?:ing)?|book(?:ing)?|access)\b|\bnot available\b[^.!?\n]{0,50}\b(?:catalog|service)/i;
const ASKS_TO_ACT = /\b(?:would you like(?: me)? to|shall i|should i|do you want(?: me)? to|want me to)\b[^.?!]{0,60}\b(?:proceed|place|book|send|confirm|go ahead|go with|order|create|schedule|prepare|try)\b|\b(?:please confirm|ready to proceed|shall we proceed)\b/i;

const plainNumber = (digits: string) => {
  const number = digits.replace(/,/g, "");
  return number.includes(".") ? number.replace(/\.?0+$/, "") : number;
};

/** Amounts in a reply that no tool result in this conversation contains. */
export function amountsNotLookedUp(reply: string, toolResults: readonly string[]): string[] {
  const looked = new Set(toolResults.join("\n").match(/\d[\d,]*(?:\.\d+)?/g)?.map(plainNumber));
  return [...new Set([...reply.matchAll(AMOUNT)].map((match) => plainNumber(match[1]!)))].filter((amount) => !looked.has(amount));
}

export type LocalModelRedirect = { message: string; mustHold: boolean };

/** What to send the model back with, or null when the reply can go to the person. `mustHold`: never show it as it stands. */
export function localModelRedirect(reply: string, toolResults: readonly string[], toolsCalled: readonly string[] = [], paymentAvailable = false, orderRequested = false): LocalModelRedirect | null {
  const invented = amountsNotLookedUp(reply, toolResults);
  if (invented.length) {
    return {
      mustHold: true,
      message: `[RelayIt: you stated ₹${invented.join(", ₹")}, which no tool returned. Never state a price you did not get from a tool. Call the tool that gives it, then answer from its result.]`,
    };
  }
  if (!toolResults.length && (NO_ACCESS.test(reply) || NO_SERVICE.test(reply))) {
    return { mustHold: true, message: "[RelayIt: you have not looked this up. Use the enabled lookup tools now; for food, call search_restaurants with the person's restaurant name before claiming it is unavailable.]" };
  }
  const facts = toolResults.flatMap((text) => {
    try {
      let value = JSON.parse(text);
      if (value.ok === false) return [];
      if (typeof value.result === "string") value = JSON.parse(value.result);
      return value && typeof value === "object" ? [value] : [];
    } catch { return []; }
  });
  const awaiting = facts.filter((value) => value.status === "awaiting_payment" && typeof value.orderId === "string").at(-1);
  if (paymentAvailable && toolsCalled.some((name) => name.endsWith("place_order") && !name.endsWith("preview_place_order")) && awaiting && !toolsCalled.some((name) => name.endsWith("payments_create_request"))) {
    return { mustHold: true, message: `[RelayIt: this order awaits payment. Call payments_create_request now with ${JSON.stringify({ orderId: awaiting.orderId, amountInr: awaiting.amountInr, payeeName: awaiting.payee?.name, payeeVpa: awaiting.payee?.vpa, note: "Food order" })}. Its result shows the payment card; do not claim the order is confirmed.]` };
  }
  const plainReply = reply.replace(/\*/g, "");
  const claimsCompletion = /\b(?:order|payment|checkout)\b/i.test(plainReply) && (
    /\b(?:i(?:['’]ve| have)?|we(?:['’]ve| have)?)\s+(?:checked|verified)\b/i.test(plainReply)
    || /\b(?:order|payment|checkout)\b[^.!?\n]{0,60}\b(?:is|was|has been|have been)\s+(?:successfully\s+)?(?:confirmed|paid|completed|verified|successful)\b/i.test(plainReply)
    || /\b(?:order|payment|checkout)(?:\s+status)?\s*:\s*(?:confirmed|paid|completed|verified|successful)\b/i.test(plainReply)
    || /\b(?:confirmed|paid|completed|verified|successful)\s+(?:order|payment|checkout)\b/i.test(plainReply)
  );
  if (paymentAvailable && claimsCompletion && !(toolsCalled.some((name) => name.endsWith("payments_check_status")) && toolsCalled.some((name) => name.endsWith("get_order_status")))) {
    return { mustHold: true, message: "[RelayIt: you have not checked payment and order status with tools in this turn. Call payments_check_status and get_order_status using the IDs in the conversation before claiming either is checked or completed. A user assertion is not verified payment.]" };
  }
  if (orderRequested && toolsCalled.some((name) => name.endsWith("get_menu")) && !toolsCalled.some((name) => name.endsWith("prepare_order"))) {
    return { mustHold: true, message: "[RelayIt: the person asked you to order, not just show a menu. Choose one or two dishes from the returned menu and call prepare_order with their exact IDs and the supplied delivery address. If required information is missing, use ask_user. Then call place_order to show the approval card.]" };
  }
  // A cart that's ready and never placed leaves the person with nothing to approve.
  if (toolsCalled.some((name) => name.endsWith("prepare_order")) && !toolsCalled.some((name) => name.endsWith("place_order") && !name.endsWith("preview_place_order"))) {
    return { mustHold: false, message: "[RelayIt: the cart is ready but you didn't place it. Call place_order now with the cartId from prepare_order's result. That shows the person an approval card, and nothing is ordered until they approve.]" };
  }
  if (ASKS_TO_ACT.test(reply)) {
    return { mustHold: false, message: "[RelayIt: don't ask in words. Call the next tool now. An action that needs approval shows the person a card with the details when you call it, so that card is the question.]" };
  }
  return null;
}
