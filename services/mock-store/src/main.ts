import { createServer } from "node:http";

import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8001);
const yoga = createApp();

createServer(yoga).listen(port, () => {
  console.log(`mock store ready on http://localhost:${port}/graphql`);
});
