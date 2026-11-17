import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { isPlainObject, parseNewTodo, parseTodoChanges } from "../shared/todo.ts";
import {
  HttpError,
  methodNotAllowed,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
} from "./http.ts";
import { serveStatic, type StaticOptions } from "./static.ts";
import type { TodoStore } from "./store.ts";

/**
 * The app's request handler.
 *
 * API (JSON in, JSON out; errors are `{ "error": "<message>" }`):
 *
 *   GET    /api/todos                  all todos, oldest first
 *   POST   /api/todos                  create one: { title }
 *   PATCH  /api/todos                  mark all: { completed }
 *   DELETE /api/todos?completed=true   delete the completed ones: → { removed }
 *   PATCH  /api/todos/:id              change one: { title?, completed? }
 *   DELETE /api/todos/:id              delete one
 *
 * Every other GET serves the UI (see static.ts).
 */
export function createApp(store: TodoStore, staticOptions: StaticOptions): RequestListener {
  return (request, response) => {
    handle(store, staticOptions, request, response).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(response, error);
        return;
      }
      console.error(error);
      if (!response.headersSent) {
        sendError(response, new HttpError(500, "internal server error"));
      } else {
        response.destroy();
      }
    });
  };
}

async function handle(
  store: TodoStore,
  staticOptions: StaticOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (url.pathname === "/api/todos") {
    await handleCollection(store, method, url, request, response);
    return;
  }
  const item = /^\/api\/todos\/([^/]+)$/.exec(url.pathname);
  if (item?.[1]) {
    await handleItem(store, method, decodeId(item[1]), request, response);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    throw new HttpError(404, "not found");
  }

  if (method !== "GET" && method !== "HEAD") {
    throw methodNotAllowed(["GET", "HEAD"]);
  }
  if (!(await serveStatic(url.pathname, response, staticOptions))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found\n");
  }
}

async function handleCollection(
  store: TodoStore,
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (method) {
    case "GET":
      sendJson(response, 200, store.list());
      return;
    case "POST": {
      const parsed = parseNewTodo(await readJson(request));
      if (!parsed.ok) {
        throw new HttpError(400, parsed.error);
      }
      sendJson(response, 201, await store.create(parsed.value.title));
      return;
    }
    case "PATCH": {
      const body = await readJson(request);
      if (!isPlainObject(body) || Object.keys(body).join() !== "completed" || typeof body.completed !== "boolean") {
        throw new HttpError(400, "body must be { completed: boolean }");
      }
      sendJson(response, 200, await store.setAllCompleted(body.completed));
      return;
    }
    case "DELETE":
      // Deleting every todo at once is deliberately not offered.
      if (url.searchParams.get("completed") !== "true") {
        throw new HttpError(400, "only completed todos can be deleted in bulk: use ?completed=true");
      }
      sendJson(response, 200, { removed: await store.removeCompleted() });
      return;
    default:
      throw methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
  }
}

function decodeId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(404, "todo not found");
  }
}

async function handleItem(
  store: TodoStore,
  method: string,
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (method) {
    case "PATCH": {
      const parsed = parseTodoChanges(await readJson(request));
      if (!parsed.ok) {
        throw new HttpError(400, parsed.error);
      }
      const todo = await store.update(id, parsed.value);
      if (!todo) {
        throw new HttpError(404, "todo not found");
      }
      sendJson(response, 200, todo);
      return;
    }
    case "DELETE":
      if (!(await store.remove(id))) {
        throw new HttpError(404, "todo not found");
      }
      sendNoContent(response);
      return;
    default:
      throw methodNotAllowed(["PATCH", "DELETE"]);
  }
}
