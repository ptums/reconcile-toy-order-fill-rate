import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";
import { loadOrders, type Order } from "./store.ts";

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
`;

const orders = loadOrders();

const resolvers = {
  Query: {
    shop: () => ({ name: "Mock Store" }),
    orders: (_: unknown, args: { first: number; query: string }) => {
      const search = args.query.replace("name:", "").replace("#", "").trim();
      const found = search ? orders.filter((o) => o.name === `#${search}`) : orders;
      return { edges: found.slice(0, args.first).map((node) => ({ node })) };
    },
  },
  Order: {
    lineItems: (order: Order, args: { first: number }) => ({
      edges: order.lineItems.slice(0, args.first).map((node) => ({ node })),
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
