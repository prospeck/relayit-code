// Small local models tell a person they can't do something with the tools right there, ask in words instead of acting,
// and state prices they never looked up. A prompt rule doesn't hold them to it: these send the reply back before the
// person sees it. Hosted models don't need this and never get it.
const AMOUNT = /(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d+)?)/gi;
const NO_ACCESS = /\b(?:don['’]?t|do not|can['’]?t|cannot|unable to)\b[^.!?\n]{0,30}\b(?:have )?(?:direct )?access\b|\bno access\b/i;
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
export function localModelRedirect(reply: string, toolResults: readonly string[], toolsCalled: readonly string[] = []): LocalModelRedirect | null {
  const invented = amountsNotLookedUp(reply, toolResults);
  if (invented.length) {
    return {
      mustHold: true,
      message: `[RelayIt: you stated ₹${invented.join(", ₹")}, which no tool returned. Never state a price you did not get from a tool. Call the tool that gives it, then answer from its result.]`,
    };
  }
  if (NO_ACCESS.test(reply)) {
    return { mustHold: false, message: "[RelayIt: you do have tools for this. Look at your tool list and use them now instead of saying you can't.]" };
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
