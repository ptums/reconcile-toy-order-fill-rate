import type { CalculatedOrder, Order } from "./models.js";

export type GraphQLVariables = Record<string, unknown>;

/**
 * What the worker needs from a store. Tests can pass a fake that has this shape.
 *
 * TypeScript interfaces are structural, like a Python Protocol: any object with these
 * methods matches, with no `implements` and no inheritance. The interface is erased at
 * runtime; only the type checker sees it.
 */
export interface StoreClient {
  /** Run one GraphQL operation and return its `data`. */
  execute(query: string, variables?: GraphQLVariables): Promise<Record<string, unknown>>;

  /** Find one order by its name. null if the store has no such order. */
  findOrder(orderName: string): Promise<Order | null>;

  /** Find the order to begin to edit. */
  beginEdit(orderId: string): Promise<CalculatedOrder>;

  /** Set the order quantity to be updated. */
  setQuantity(calculatedOrderId: string, lineItemId: string, quantity: number): Promise<void>;

  /** Commit recent order edits. */
  commitEdit(calculatedOrderId: string): Promise<void>;
}
