import type { OrderMessage } from "../queue/queue.ts";
import type { Gql } from "./throttle.ts";

type LineItem = { id: string; sku: string; quantity: number };
type UserError = { field: string[] | null; message: string };

export class PermanentError extends Error {}
// What happened to 1 order.
export interface OrderResult {
  changed: number; // lines the commit changed
  rejected: { sku: string; message: string }[]; // lines that can't change (permanent)
}

// Send a query. A top-level error (not THROTTLED: withThrottle handles that) stops the order.
async function send<T>(gql: Gql, query: string): Promise<T> {
  const res = await gql<T>(query);
  if (res.errors?.length) throw new Error(res.errors[0]!.message);
  return res.data!;
}

// Edit 1 order so each line has the report quantity, in 1 edit session.
export async function applyOrder(
  gql: Gql,
  message: OrderMessage,
): Promise<OrderResult> {
  // 1. Read the order now. The report has SKUs, but the edit needs line item IDs.
  const name = message.orderId.split("/").pop();
  const read = await send<{
    orders: {
      edges: { node: { lineItems: { edges: { node: LineItem }[] } } }[];
    };
  }>(
    gql,
    `{ orders(first: 1, query: "name:${name}") { edges { node { lineItems(first: 250) { edges { node
  { id sku quantity } } } } } } }`,
  );
  const order = read.orders.edges[0]?.node;
  if (!order) throw new PermanentError("Order does not exist");
  const lines = order.lineItems.edges.map((e) => e.node);
  const bySku = new Map(lines.map((line) => [line.sku, line]));

  // 2. Diff: keep only the lines that change. A second run of the same report changes nothing.
  const result: OrderResult = { changed: 0, rejected: [] };
  const changes: { id: string; quantity: number }[] = [];
  for (const { sku, quantity } of message.lines) {
    const line = bySku.get(sku);
    if (!line)
      result.rejected.push({ sku, message: "SKU is not on this order" });
    else if (line.quantity !== quantity)
      changes.push({ id: line.id, quantity });
  }
  if (changes.length === 0) return result;

  // 3. Begin, set each line, commit.
  const begin = await send<{
    orderEditBegin: {
      calculatedOrder: { id: string } | null;
      userErrors: UserError[];
    };
  }>(
    gql,
    `mutation { orderEditBegin(id: "${message.orderId}") { calculatedOrder { id } userErrors { field
  message } } }`,
  );
  const session = begin.orderEditBegin.calculatedOrder?.id;
  if (!session)
    throw new PermanentError(
      begin.orderEditBegin.userErrors[0]?.message ?? "No session",
    );

  for (const change of changes) {
    const set = await send<{
      orderEditSetQuantity: { userErrors: UserError[] };
    }>(
      gql,
      `mutation { orderEditSetQuantity(id: "${session}", lineItemId: "${change.id}", quantity: ${change.quantity}) { userErrors { field message } } }`,
    );
    const error = set.orderEditSetQuantity.userErrors[0];
    const sku = lines.find((line) => line.id === change.id)!.sku;
    if (error)
      result.rejected.push({ sku, message: error.message }); // Peter's rule: the good lines still commit
    else result.changed++;
  }

  const commit = await send<{ orderEditCommit: { userErrors: UserError[] } }>(
    gql,
    `mutation { orderEditCommit(id: "${session}") { userErrors { field message } } }`,
  );
  const error = commit.orderEditCommit.userErrors[0];
  if (error) throw new Error(error.message);
  return result;
}
