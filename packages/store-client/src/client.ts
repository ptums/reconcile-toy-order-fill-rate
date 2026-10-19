import type { CalculatedOrder, Order } from "./models.js";
import type { GraphQLVariables, StoreClient } from "./store-client.js";

/** The store returned GraphQL errors (or userErrors). `errors` holds them as the store sent them. */
export class StoreError extends Error {
  readonly errors: unknown;

  constructor(errors: unknown, message = "The store returned errors") {
    super(`${message}: ${JSON.stringify(errors)}`);
    this.name = "StoreError";
    this.errors = errors;
  }
}

/** The store's rate-limit bucket is empty. A transient error: retry after a wait. */
export class ThrottledError extends StoreError {
  constructor(errors: unknown) {
    super(errors, "The store throttled the request");
    this.name = "ThrottledError";
  }
}

/** The rate-limit data from `extensions.cost.throttleStatus` in each response. */
export class ThrottleStatus {
  constructor(
    readonly maximumAvailable: number,
    readonly currentlyAvailable: number,
    readonly restoreRate: number,
  ) {}

  /** Seconds to wait before a query with this cost can run (Lesson 1, part 3). */
  waitSeconds(cost: number): number {
    return Math.max(0, (cost - this.currentlyAvailable) / this.restoreRate);
  }
}

export interface StoreConfig {
  readonly graphqlUrl: string;
  readonly token: string;
}

export function storeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  return {
    graphqlUrl: env.STORE_GRAPHQL_URL ?? "http://localhost:8001/graphql",
    token: env.STORE_TOKEN ?? "mock-token",
  };
}

/** The shape of the global fetch. Tests inject a fake one. */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

interface GraphQLError {
  message?: string;
  extensions?: { code?: string };
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: GraphQLError[];
  extensions?: {
    cost?: {
      throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
    };
  };
}

interface UserErrorsResult {
  userErrors?: { field?: string[] | null; message: string }[];
}

interface FindOrderData {
  orders: { edges: { node: { id: string; name: string } }[] };
}

interface BeginEditData {
  orderEditBegin: UserErrorsResult & {
    calculatedOrder: {
      id: string;
      originalOrder: { name: string };
      lineItems: { edges: { node: { id: string; sku: string | null; quantity: number } }[] };
    };
  };
}

/** One GraphQL client for the mock and for real Shopify. Queries always use variables. */
export class GraphQLStoreClient implements StoreClient {
  lastThrottle: ThrottleStatus | null = null;

  constructor(
    readonly config: StoreConfig,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  async execute(query: string, variables: GraphQLVariables = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(this.config.graphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.config.token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`The store returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as GraphQLResponse;

    const throttle = body.extensions?.cost?.throttleStatus;
    if (throttle) {
      this.lastThrottle = new ThrottleStatus(
        throttle.maximumAvailable,
        throttle.currentlyAvailable,
        throttle.restoreRate,
      );
    }

    const errors = body.errors ?? [];
    if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
      throw new ThrottledError(errors);
    }
    if (errors.length > 0) {
      throw new StoreError(errors);
    }
    return body.data ?? {};
  }

  // Order operations. Same GraphQL operations as legacy/utils/regular-queries.js, but with
  // variables instead of string building, and userErrors thrown instead of ignored.

  async findOrder(orderName: string): Promise<Order | null> {
    const data = (await this.execute(FIND_ORDER, { query: `name:${orderName}` })) as unknown as FindOrderData;
    const node = data.orders.edges[0]?.node;
    return node ? { id: node.id, name: node.name } : null;
  }

  async beginEdit(orderId: string): Promise<CalculatedOrder> {
    const data = (await this.execute(BEGIN_EDIT, { id: orderId })) as unknown as BeginEditData;
    const result = data.orderEditBegin;
    raiseUserErrors(result);
    const calc = result.calculatedOrder;
    return {
      id: calc.id,
      orderName: calc.originalOrder.name,
      lineItems: calc.lineItems.edges.map((e) => ({ id: e.node.id, sku: e.node.sku, quantity: e.node.quantity })),
    };
  }

  async setQuantity(calculatedOrderId: string, lineItemId: string, quantity: number): Promise<void> {
    const data = await this.execute(SET_QUANTITY, { id: calculatedOrderId, lineItemId, quantity });
    raiseUserErrors(data.orderEditSetQuantity as UserErrorsResult);
  }

  async commitEdit(calculatedOrderId: string): Promise<void> {
    const data = await this.execute(COMMIT_EDIT, { id: calculatedOrderId });
    raiseUserErrors(data.orderEditCommit as UserErrorsResult);
  }
}

/** Mutations report business errors in userErrors with HTTP 200. The 2021 code ignored them. */
export function raiseUserErrors(result: UserErrorsResult | null | undefined): void {
  if (result?.userErrors && result.userErrors.length > 0) {
    throw new StoreError(result.userErrors, "The store returned userErrors");
  }
}

export const FIND_ORDER = /* GraphQL */ `
query FindOrder($query: String!) {
  orders(first: 1, query: $query) { edges { node { id name } } }
}
`;

export const BEGIN_EDIT = /* GraphQL */ `
mutation BeginEdit($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder {
      id
      originalOrder { name }
      lineItems(first: 250) { edges { node { id sku quantity } } }
    }
    userErrors { field message }
  }
}
`;

export const SET_QUANTITY = /* GraphQL */ `
mutation SetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
  orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
    calculatedOrder { id }
    userErrors { field message }
  }
}
`;

export const COMMIT_EDIT = /* GraphQL */ `
mutation CommitEdit($id: ID!) {
  orderEditCommit(id: $id) {
    order { id }
    userErrors { field message }
  }
}
`;
