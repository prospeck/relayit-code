import { describe, expect, it } from "vitest";

import { amountsNotLookedUp, localModelRedirect } from "./local-model-guard.ts";

const MENU = JSON.stringify({ items: [{ name: "Margherita", priceInr: 495 }, { name: "BBQ Chicken", priceInr: 1295.5 }], total: "1,790" });

describe("amountsNotLookedUp", () => {
  it("finds a price no tool gave", () => {
    expect(amountsNotLookedUp("Classic Margherita - ₹599, Pepperoni - Rs. 699", [MENU])).toEqual(["599", "699"]);
    expect(amountsNotLookedUp("That's INR 1,200", [])).toEqual(["1200"]);
  });
  it("accepts prices from tool results, however they're written", () => {
    expect(amountsNotLookedUp("Margherita ₹495, BBQ ₹1,295.50, total ₹1790.00", [MENU])).toEqual([]);
  });
  it("ignores numbers that aren't money", () => {
    expect(amountsNotLookedUp("Rated 4.5, 35 minutes away, 2 pizzas", [])).toEqual([]);
  });
});

describe("localModelRedirect", () => {
  it("holds a reply with an invented price, even with no tools called", () => {
    const redirect = localModelRedirect("Here's their menu: Classic Margherita - ₹599.", [])!;
    expect(redirect.mustHold).toBe(true);
    expect(redirect.message).toContain("₹599");
  });
  it.each([
    "I don't have direct access to their ordering system.",
    "I can't access your orders.",
    "Sorry, I have no access to that.",
  ])("sends back a claim of no access: %s", (reply) => {
    expect(localModelRedirect(reply, [])?.mustHold).toBe(false);
  });
  it.each([
    "I've prepared the cart. Would you like me to place the order?",
    "Would you like me to go with the Margherita?",
    "Shall I book it?",
    "Do you want me to proceed?",
    "Please confirm and I'll send it.",
  ])("sends back asking to act in words: %s", (reply) => {
    expect(localModelRedirect(reply, [])?.message).toContain("don't ask in words");
  });
  it.each([
    "Your Margherita is ordered and arrives in 35 minutes.",
    "Which address should it go to, home or work?",
    "The restaurant is closed right now, so nothing was ordered.",
  ])("lets a real answer or a real question through: %s", (reply) => {
    expect(localModelRedirect(reply, [MENU])).toBeNull();
  });

  it("sends a model back to place a cart it prepared, until it has", () => {
    const summary = "Here's your order: Margherita ₹495.";
    expect(localModelRedirect(summary, [MENU], ["india_food_get_menu", "india_food_prepare_order"])?.message).toContain("place_order");
    expect(localModelRedirect(summary, [MENU], ["india_food_prepare_order", "india_food_preview_place_order"])?.message).toContain("place_order");
    expect(localModelRedirect(summary, [MENU], ["india_food_prepare_order", "india_food_place_order"])).toBeNull();
    expect(localModelRedirect(summary, [MENU], ["india_food_get_menu"])).toBeNull();
  });
});
