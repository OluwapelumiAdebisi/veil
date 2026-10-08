import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port }, () => {
  console.log(`Veil coordinator listening on http://127.0.0.1:${port}`);
});
