import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.ts";
import { TodoStore } from "./store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.TODOS_DATA_FILE ?? `${root}data/todos.json`;

const store = await TodoStore.open(dataFile);
const server = createServer(createApp(store, { publicDir: `${root}public`, srcDir: `${root}src` }));

server.listen(port, host, () => {
  console.log(`todos: listening on http://${host}:${port} (data: ${dataFile})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
