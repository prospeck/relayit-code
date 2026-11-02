/** Optional servers shipped with the app. They start only when the person enables them. */
export const INDIA_SERVICES = [
  { id: "food", name: "india-food", labelKey: "india.builtins.food" },
  { id: "travel", name: "india-travel", labelKey: "india.builtins.travel" },
  { id: "payments", name: "india-payments", labelKey: "india.builtins.payments" },
] as const;

/** Tools on these servers that only look something up or build a draft. Nothing here spends money or reaches a person,
 * so they run without a card. Placing an order, creating a payment request and marking one paid still ask. */
export const INDIA_FREE_TOOLS: Readonly<Record<string, ReadonlySet<string>>> = {
  "india-food": new Set(["search_restaurants", "get_menu", "prepare_order", "preview_place_order", "get_order_status"]),
  "india-travel": new Set(["resolve_station", "find_trains", "irctc_booking_handoff", "metro_route", "cab_handoff"]),
  "india-payments": new Set(["payments_check_status"]),
};
