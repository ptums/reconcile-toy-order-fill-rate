/**
 * Mock of a subset of the Shopify Admin GraphQL API.
 *
 * This is not Shopify. It copies the shape of the operations the tool needs, so the
 * real API can replace it by configuration. Lesson 2, part 3 adds orders, order edits,
 * userErrors and the cost-based leaky bucket.
 */

import { createSchema, createYoga, type Plugin } from "graphql-yoga";

const typeDefs = /* GraphQL */ `
  type Shop {
    name: String!
  }

  type Query {
    shop: Shop!
  }
`;

const resolvers = {
  Query: {
    shop: () => ({ name: "Mock Store" }),
  },
};

/** GET /health returns {"status": "ok"}, the same body as the API service. */
function healthEndpoint(): Plugin {
  return {
    onRequest({ url, endResponse, fetchAPI }) {
      if (url.pathname === "/health") {
        endResponse(fetchAPI.Response.json({ status: "ok" }));
      }
    },
  };
}

/** Build the mock store. Tests call `createApp().fetch(...)`; main.ts serves it over HTTP. */
export function createApp() {
  return createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: "/graphql",
    // Move Yoga's built-in health check (an empty 200) away, so /health returns our JSON body.
    healthCheckEndpoint: "/_yoga/health",
    plugins: [healthEndpoint()],
    landingPage: false,
    logging: "warn",
  });
}
