import { createServer } from "node:http";
import { createApp } from "./app.ts";

const yoga = createApp();
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
