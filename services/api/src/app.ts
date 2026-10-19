/** Upload API (producer). Lesson 3 adds: store the CSV in S3, create the job, publish rows to the queue. */

import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));
