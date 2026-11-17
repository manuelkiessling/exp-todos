import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { isPlainObject, parseListBody, parseNewTodo, parseTodoChanges } from "../shared/todo.ts";
import {
  HttpError,
  methodNotAllowed,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
} from "./http.ts";
import { serveStatic, type StaticOptions } from "./static.ts";
import { StoreError, type StoreErrorKind, type TodoStore } from "./store.ts";

const STORE_ERROR_STATUS: Record<StoreErrorKind, number> = {
  "list-not-found": 404,
  "todo-not-found": 404,
  "duplicate-list-name": 409,
  "last-list": 409,
};

/**
 * The app's request handler.
 *
 * API (JSON in, JSON out; errors are `{ "error": "<message>" }`):
 *
 *   GET    /api/lists                            all lists, oldest first
 *   POST   /api/lists                            create one: { name }
 *   PATCH  /api/lists/:id                        rename one: { name }
 *   DELETE /api/lists/:id                        delete one with its todos (not the last list)
 *   POST   /api/lists/:id/todos                  create a todo in the list: { title }
 *   PATCH  /api/lists/:id/todos                  mark all of the list's todos: { completed }
 *   DELETE /api/lists/:id/todos?completed=true   delete the list's completed todos: → { removed }
 *   GET    /api/todos                            all todos of all lists, oldest first
 *   PATCH  /api/todos/:id                        change one: { title?, completed?, listId? }
 *   DELETE /api/todos/:id                        delete one
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
      if (error instanceof StoreError) {
        sendError(response, new HttpError(STORE_ERROR_STATUS[error.kind], error.message));
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
  const route = matchApiRoute(url.pathname);

  switch (route?.name) {
    case "lists":
      await handleLists(store, method, request, response);
      return;
    case "list":
      await handleList(store, method, route.id, request, response);
      return;
    case "listTodos":
      await handleListTodos(store, method, route.id, url, request, response);
      return;
    case "todos":
      if (method !== "GET") {
        throw methodNotAllowed(["GET"]);
      }
      sendJson(response, 200, store.todos());
      return;
    case "todo":
      await handleTodo(store, method, route.id, request, response);
      return;
    case undefined:
      break;
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

type ApiRoute =
  | { name: "lists" }
  | { name: "list"; id: string }
  | { name: "listTodos"; id: string }
  | { name: "todos" }
  | { name: "todo"; id: string };

function matchApiRoute(pathname: string): ApiRoute | undefined {
  if (pathname === "/api/lists") {
    return { name: "lists" };
  }
  if (pathname === "/api/todos") {
    return { name: "todos" };
  }
  const match = /^\/api\/(lists|todos)\/([^/]+)(\/todos)?$/.exec(pathname);
  if (!match?.[2]) {
    return undefined;
  }
  const [, collection, segment, nested] = match;
  const id = decodeId(segment);
  if (collection === "lists") {
    return nested ? { name: "listTodos", id } : { name: "list", id };
  }
  return nested ? undefined : { name: "todo", id };
}

function decodeId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(404, "not found");
  }
}

async function handleLists(
  store: TodoStore,
  method: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (method) {
    case "GET":
      sendJson(response, 200, store.lists());
      return;
    case "POST": {
      const parsed = parseListBody(await readJson(request));
      if (!parsed.ok) {
        throw new HttpError(400, parsed.error);
      }
      sendJson(response, 201, await store.createList(parsed.value.name));
      return;
    }
    default:
      throw methodNotAllowed(["GET", "POST"]);
  }
}

async function handleList(
  store: TodoStore,
  method: string,
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (method) {
    case "PATCH": {
      const parsed = parseListBody(await readJson(request));
      if (!parsed.ok) {
        throw new HttpError(400, parsed.error);
      }
      sendJson(response, 200, await store.renameList(id, parsed.value.name));
      return;
    }
    case "DELETE":
      await store.removeList(id);
      sendNoContent(response);
      return;
    default:
      throw methodNotAllowed(["PATCH", "DELETE"]);
  }
}

async function handleListTodos(
  store: TodoStore,
  method: string,
  listId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  switch (method) {
    case "POST": {
      const parsed = parseNewTodo(await readJson(request));
      if (!parsed.ok) {
        throw new HttpError(400, parsed.error);
      }
      sendJson(response, 201, await store.createTodo(listId, parsed.value.title));
      return;
    }
    case "PATCH": {
      const body = await readJson(request);
      if (!isPlainObject(body) || Object.keys(body).join() !== "completed" || typeof body.completed !== "boolean") {
        throw new HttpError(400, "body must be { completed: boolean }");
      }
      sendJson(response, 200, await store.setAllCompleted(listId, body.completed));
      return;
    }
    case "DELETE":
      // Deleting all of a list's todos at once is deliberately not offered.
      if (url.searchParams.get("completed") !== "true") {
        throw new HttpError(400, "only completed todos can be deleted in bulk: use ?completed=true");
      }
      sendJson(response, 200, { removed: await store.removeCompleted(listId) });
      return;
    default:
      throw methodNotAllowed(["POST", "PATCH", "DELETE"]);
  }
}

async function handleTodo(
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
      sendJson(response, 200, await store.updateTodo(id, parsed.value));
      return;
    }
    case "DELETE":
      await store.removeTodo(id);
      sendNoContent(response);
      return;
    default:
      throw methodNotAllowed(["PATCH", "DELETE"]);
  }
}
