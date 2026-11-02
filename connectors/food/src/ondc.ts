import type {
  Cart,
  CartInput,
  FoodProvider,
  Order,
  SearchInput,
  SearchResult,
  Restaurant,
  MenuItem,
} from "./provider.ts";

/** Integration boundary only: no ONDC network calls or real orders are made. */
export class OndcFoodProvider implements FoodProvider {
  /** BAP search/on_search discovers restaurants and their catalogues. */
  async searchRestaurants(_q: SearchInput): Promise<SearchResult[]> {
    throw new Error("not implemented");
  }
  /** Read the merchant catalogue returned by ONDC on_search. */
  async getMenu(
    _restaurantId: string,
  ): Promise<{ restaurant: Restaurant; categories: { name: string; items: MenuItem[] }[] }> {
    throw new Error("not implemented");
  }
  /** BAP select/on_select quotes items; init/on_init supplies fulfilment and payment terms. */
  async quote(_cartInput: CartInput): Promise<Cart> {
    throw new Error("not implemented");
  }
  /** Read the persisted select/init quote used by the approval preview. */
  async getCart(_cartId: string): Promise<Cart> {
    throw new Error("not implemented");
  }
  /** BAP confirm/on_confirm creates an order using the stored init quote and transaction ID. */
  async placeOrder(_cartId: string, _idempotencyKey?: string): Promise<Order> {
    throw new Error("not implemented");
  }
  /** BAP status/on_status and fulfilment callbacks populate the order timeline. */
  async getOrder(_orderId: string): Promise<Order> {
    throw new Error("not implemented");
  }
  /** Reconcile a verified payment with ONDC payment terms and update/confirm callbacks. */
  async confirmPayment(_orderId: string, _paymentRef: string): Promise<Order> {
    throw new Error("not implemented");
  }
}
