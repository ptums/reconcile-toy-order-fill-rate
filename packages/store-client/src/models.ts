/** Models: the data the store returns. Models describe data; the interface describes behavior. */

/** A real order in the store. Its id is a GID, for example gid://shopify/Order/1001. */
export interface Order {
  readonly id: string;
  /** What the CSV report uses, for example "#1001". */
  readonly name: string;
}

/** A line item inside an edit session. Its id differs from the original line item's id. */
export interface CalculatedLineItem {
  readonly id: string;
  readonly sku: string | null;
  readonly quantity: number;
}

/** A draft copy of an order. Changes go here first; commitEdit saves them to the order. */
export interface CalculatedOrder {
  readonly id: string;
  readonly orderName: string;
  readonly lineItems: readonly CalculatedLineItem[];
}
