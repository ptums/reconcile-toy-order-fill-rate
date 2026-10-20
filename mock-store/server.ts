import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";
import { loadOrders, Session, type Order } from "./store.ts";

const typeDefs = /* GraphQL */ `
  type Shop {
    name: String!
  }
  type LineItem {
    id: ID!
    sku: String
    quantity: Int!
  }
  type LineItemEdge {
    node: LineItem!
  }
  type LineItemConnection {
    edges: [LineItemEdge!]!
  }
  type Order {
    id: ID!
    name: String!
    lineItems(first: Int = 50): LineItemConnection!
  }
  type OrderEdge {
    node: Order!
  }
  type OrderConnection {
    edges: [OrderEdge!]!
  }
  type Query {
    shop: Shop!
    orders(first: Int = 1, query: String = ""): OrderConnection!
  }
  type CalculatedOrder {
    id: ID!
    lineItems(first: Int = 50): LineItemConnection!
  }
  type OrderEditBeginPayload {
    calculatedOrder: CalculatedOrder
    userErrors: [UserError!]!
  }
  type OrderEditSetQuantityPayload {
    calculatedOrder: CalculatedOrder
    calculatedLineItem: LineItem
    userErrors: [UserError!]!
  }
  type OrderEditCommitPayload {
    order: Order
    userErrors: [UserError!]!
  }
  type UserError {
    field: [String!]
    message: String!
  }
  type Mutation {
    orderEditBegin(id: ID!): OrderEditBeginPayload!
    orderEditSetQuantity(
      id: ID!
      lineItemId: ID!
      quantity: Int!
    ): OrderEditSetQuantityPayload!
    orderEditCommit(id: ID!): OrderEditCommitPayload!
  }
`;

const orders = loadOrders();
const sessions = new Map<string, Session>();
let nextSessionId = 1;

const resolvers = {
  Query: {
    shop: () => ({ name: "Mock Store" }),
    orders: (_: unknown, args: { first: number; query: string }) => {
      const search = args.query.replace("name:", "").replace("#", "").trim();
      const found = search
        ? orders.filter((o) => o.name === `#${search}`)
        : orders;
      return { edges: found.slice(0, args.first).map((node) => ({ node })) };
    },
  },
  Order: {
    lineItems: (order: Order, args: { first: number }) => ({
      edges: order.lineItems.slice(0, args.first).map((node) => ({ node })),
    }),
  },
  Mutation: {
    orderEditBegin: (_: unknown, args: { id: string }) => {
      const order = orders.find((o) => o.id === args.id);
      if (!order) {
        return {
          calculatedOrder: null,
          userErrors: [{ field: ["id"], message: "Order does not exist" }],
        };
      }
      const session: Session = {
        id: `gid://shopify/CalculatedOrder/${nextSessionId++}`,
        orderId: order.id,
        lineItems: order.lineItems.map((li) => ({ ...li })),
        changed: new Set(),
      };
      sessions.set(session.id, session);
      return { calculatedOrder: session, userErrors: [] };
    },
    orderEditSetQuantity: (
      _: unknown,
      args: { id: string; lineItemId: string; quantity: number },
    ) => {
      const fail = (field: string, message: string) => ({
        calculatedOrder: null,
        calculatedLineItem: null,
        userErrors: [{ field: [field], message }],
      });
      const session = sessions.get(args.id);
      if (!session) return fail("id", "Calculated order does not exist");
      const line = session.lineItems.find((li) => li.id === args.lineItemId);
      if (!line)
        return fail("lineItemId", "Line item does not exist on this order");
      if (args.quantity < 0)
        return fail("quantity", "Quantity must be 0 or more");
      line.quantity = args.quantity;
      session.changed.add(line.id);
      return {
        calculatedOrder: session,
        calculatedLineItem: line,
        userErrors: [],
      };
    },
    orderEditCommit: (_: unknown, args: { id: string }) => {
      const session = sessions.get(args.id);
      const order = orders.find((o) => o.id === session?.orderId);
      if (!session || !order) {
        return {
          order: null,
          userErrors: [
            { field: ["id"], message: "Calculated order does not exist" },
          ],
        };
      }
      for (const staged of session.lineItems) {
        if (!session.changed.has(staged.id)) continue;
        const line = order.lineItems.find((li) => li.id === staged.id);
        if (line) line.quantity = staged.quantity;
      }
      sessions.delete(session.id);
      return { order, userErrors: [] };
    },
  },
  CalculatedOrder: {
    lineItems: (session: Session, args: { first: number }) => ({
      edges: session.lineItems.slice(0, args.first).map((node) => ({
        node,
      })),
    }),
  },
};

const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) });
const port = Number(process.env.PORT ?? 8001);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  yoga(req, res); // every other request goes to GraphQL
});

server.listen(port, () =>
  console.log(`mock store on
  http://localhost:${port}/graphql`),
);
