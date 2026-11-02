export type Restaurant = {
  id: string;
  name: string;
  area: string;
  cuisines: string[];
  aliases: string[];
  rating: number;
  costForTwoInr: number;
  etaMin: number;
  pureVeg: boolean;
  openingHours: string;
  tags: string[];
};
export type MenuItem = {
  id: string;
  name: string;
  description: string;
  priceInr: number;
  veg: boolean;
  bestseller: boolean;
  category: string;
  spiceLevel: 0 | 1 | 2 | 3;
  customisations?: { name: string; options: string[] }[];
};
export type SearchInput = {
  query?: string;
  area?: string;
  vegOnly?: boolean;
  maxEtaMin?: number;
  cuisine?: string;
};
export type SearchResult = Pick<
  Restaurant,
  "id" | "name" | "area" | "rating" | "etaMin" | "costForTwoInr" | "cuisines"
> & { matchedDishes: string[] };
export type CartInput = {
  restaurantId: string;
  items: { itemId: string; qty: number; note?: string }[];
  deliveryAddress: { label: string; line: string };
  instructions?: string;
};
export type Cart = {
  cartId: string;
  restaurant: Restaurant;
  lines: {
    itemId: string;
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    veg: boolean;
    note?: string;
  }[];
  deliveryAddress: CartInput["deliveryAddress"];
  instructions?: string;
  itemTotalInr: number;
  deliveryFeeInr: number;
  platformFeeInr: number;
  gstInr: number;
  packagingInr: number;
  totalInr: number;
  etaMin: number;
  expiresAt: string;
};
export type Order = {
  orderId: string;
  cartId: string;
  status: "awaiting_payment" | "confirmed" | "preparing" | "out_for_delivery" | "delivered";
  amountInr: number;
  restaurant: Restaurant;
  payee: { name: string; vpa: string; merchantCode: "5812" };
  etaMin: number;
  createdAt: string;
  paidAt?: string;
  paymentRef?: string;
  timeline: { status: Order["status"]; at: string }[];
  _parts: [];
};
export interface FoodProvider {
  searchRestaurants(q: SearchInput): Promise<SearchResult[]>;
  getMenu(
    restaurantId: string,
  ): Promise<{ restaurant: Restaurant; categories: { name: string; items: MenuItem[] }[] }>;
  quote(cartInput: CartInput): Promise<Cart>;
  /** Read the stored quote so approval previews use exactly the quoted amount. */
  getCart(cartId: string): Promise<Cart>;
  placeOrder(cartId: string, idempotencyKey?: string): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  confirmPayment(orderId: string, paymentRef: string): Promise<Order>;
}
