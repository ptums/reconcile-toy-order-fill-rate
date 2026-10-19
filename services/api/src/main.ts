import { serve } from "@hono/node-server";

import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8002);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api ready on http://localhost:${info.port}`);
});
