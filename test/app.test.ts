import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { createApp } from "../src/server/app.ts";
import { TodoStore } from "../src/server/store.ts";
import type { Todo, TodoList } from "../src/shared/todo.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

let dir: string;
let server: Server;
let baseUrl: string;

// Each test gets a fresh store behind the same server.
let store: TodoStore;
let defaultList: TodoList;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "todos-app-"));
  server = createServer((request, response) =>
    createApp(store, { publicDir: join(root, "public"), srcDir: join(root, "src") })(request, response),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  store = await TodoStore.open(join(dir, `${crypto.randomUUID()}.json`));
  defaultList = store.lists()[0]!;
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(baseUrl + path, init);
}

async function json<T>(method: string, path: string, body?: unknown, status = 200): Promise<T> {
  const response = await call(method, path, body);
  assert.equal(response.status, status, `${method} ${path}`);
  return (await response.json()) as T;
}

async function createList(name: string): Promise<TodoList> {
  return json<TodoList>("POST", "/api/lists", { name }, 201);
}

async function createTodo(listId: string, title: string): Promise<Todo> {
  return json<Todo>("POST", `/api/lists/${listId}/todos`, { title }, 201);
}

async function titles(): Promise<string[]> {
  return (await json<Todo[]>("GET", "/api/todos")).map((todo) => todo.title);
}

describe("lists API", () => {
  test("starts with the default list", async () => {
    assert.deepEqual(await json<TodoList[]>("GET", "/api/lists"), [defaultList]);
    assert.equal(defaultList.name, "Todos");
  });

  test("creates, renames and deletes a list", async () => {
    const work = await createList("  Work ");
    assert.equal(work.name, "Work");

    const renamed = await json<TodoList>("PATCH", `/api/lists/${work.id}`, { name: "Office" });
    assert.deepEqual(renamed, { ...work, name: "Office" });
    assert.deepEqual(await json<TodoList[]>("GET", "/api/lists"), [defaultList, renamed]);

    assert.equal((await call("DELETE", `/api/lists/${work.id}`)).status, 204);
    assert.deepEqual(await json<TodoList[]>("GET", "/api/lists"), [defaultList]);
  });

  test("deleting a list deletes its todos", async () => {
    const work = await createList("Work");
    await createTodo(work.id, "report");
    await createTodo(defaultList.id, "milk");

    await call("DELETE", `/api/lists/${work.id}`);
    assert.deepEqual(await titles(), ["milk"]);
  });

  test("refuses duplicate names and deleting the last list with 409", async () => {
    await createList("Work");
    let response = await call("POST", "/api/lists", { name: "WORK" });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'a list named "WORK" already exists' });

    response = await call("PATCH", `/api/lists/${defaultList.id}`, { name: "work" });
    assert.equal(response.status, 409);

    await call("DELETE", `/api/lists/${(await json<TodoList[]>("GET", "/api/lists"))[1]!.id}`);
    response = await call("DELETE", `/api/lists/${defaultList.id}`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "the last list cannot be deleted" });
  });

  test("validates list names", async () => {
    const cases: Array<[unknown, string]> = [
      [{ name: "" }, "name must not be empty"],
      [{ name: "x".repeat(51) }, "name must be at most 50 characters"],
      [{ name: 3 }, "name must be a string"],
      [{ name: "a", color: "red" }, "unknown field: color"],
    ];
    for (const [body, error] of cases) {
      assert.deepEqual(await json("POST", "/api/lists", body, 400), { error });
    }
    assert.equal((await call("POST", "/api/lists", { name: "x".repeat(50) })).status, 201);
  });

  test("answers unknown lists with 404", async () => {
    assert.equal((await call("PATCH", "/api/lists/nope", { name: "x" })).status, 404);
    assert.equal((await call("DELETE", "/api/lists/nope")).status, 404);
    assert.equal((await call("POST", "/api/lists/nope/todos", { title: "x" })).status, 404);
    assert.equal((await call("PATCH", "/api/lists/nope/todos", { completed: true })).status, 404);
    assert.equal((await call("DELETE", "/api/lists/nope/todos?completed=true")).status, 404);
  });
});

describe("todos API", () => {
  test("creates, lists, changes and deletes a todo", async () => {
    const todo = await createTodo(defaultList.id, "  write tests ");
    assert.equal(todo.title, "write tests");
    assert.equal(todo.listId, defaultList.id);
    assert.equal(todo.completed, false);

    const changed = await json<Todo>("PATCH", `/api/todos/${todo.id}`, { completed: true, title: "write more tests" });
    assert.deepEqual(changed, { ...todo, completed: true, title: "write more tests" });
    assert.deepEqual(await json<Todo[]>("GET", "/api/todos"), [changed]);

    assert.equal((await call("DELETE", `/api/todos/${todo.id}`)).status, 204);
    assert.deepEqual(await json<Todo[]>("GET", "/api/todos"), []);
  });

  test("lists the todos of every list", async () => {
    const work = await createList("Work");
    await createTodo(defaultList.id, "milk");
    await createTodo(work.id, "report");
    const todos = await json<Todo[]>("GET", "/api/todos");
    assert.deepEqual(
      todos.map(({ title, listId }) => ({ title, listId })),
      [
        { title: "milk", listId: defaultList.id },
        { title: "report", listId: work.id },
      ],
    );
  });

  test("moves a todo to another list", async () => {
    const work = await createList("Work");
    const todo = await createTodo(defaultList.id, "report");

    const moved = await json<Todo>("PATCH", `/api/todos/${todo.id}`, { listId: work.id });
    assert.deepEqual(moved, { ...todo, listId: work.id });

    const response = await call("PATCH", `/api/todos/${todo.id}`, { listId: "nope" });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "list not found" });
  });

  test("marks all and clears completed within one list", async () => {
    const work = await createList("Work");
    await createTodo(defaultList.id, "milk");
    await createTodo(work.id, "report");
    const slides = await createTodo(work.id, "slides");

    const marked = await json<Todo[]>("PATCH", `/api/lists/${work.id}/todos`, { completed: true });
    assert.deepEqual(marked.map((todo) => [todo.title, todo.completed]), [
      ["report", true],
      ["slides", true],
    ]);
    await call("PATCH", `/api/todos/${slides.id}`, { completed: false });

    assert.deepEqual(await json("DELETE", `/api/lists/${work.id}/todos?completed=true`), { removed: 1 });
    assert.deepEqual(await titles(), ["milk", "slides"]);
  });

  test("never deletes all of a list's todos in bulk", async () => {
    await createTodo(defaultList.id, "survivor");
    assert.equal((await call("DELETE", `/api/lists/${defaultList.id}/todos`)).status, 400);
    assert.deepEqual(await titles(), ["survivor"]);
  });

  test("rejects invalid bodies with a message", async () => {
    const todo = await createTodo(defaultList.id, "x");
    const cases: Array<[string, string, unknown, string]> = [
      ["POST", `/api/lists/${defaultList.id}/todos`, { title: "" }, "title must not be empty"],
      ["POST", `/api/lists/${defaultList.id}/todos`, { title: "x", listId: "y" }, "unknown field: listId"],
      ["PATCH", `/api/todos/${todo.id}`, {}, "body must change title, completed or listId"],
      ["PATCH", `/api/todos/${todo.id}`, { listId: "" }, "listId must be a non-empty string"],
      ["PATCH", `/api/lists/${defaultList.id}/todos`, { completed: "yes" }, "body must be { completed: boolean }"],
    ];
    for (const [method, path, body, error] of cases) {
      assert.deepEqual(await json(method, path, body, 400), { error });
    }
  });

  test("rejects malformed requests", async () => {
    const path = `${baseUrl}/api/lists/${defaultList.id}/todos`;
    let response = await fetch(path, { method: "POST", body: "title=x" });
    assert.equal(response.status, 415);

    response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(response.status, 400);

    response = await call("POST", `/api/lists/${defaultList.id}/todos`, { title: "x".repeat(70 * 1024) });
    assert.equal(response.status, 413);
  });

  test("answers unknown todos, routes and methods", async () => {
    assert.equal((await call("PATCH", "/api/todos/missing", { completed: true })).status, 404);
    assert.equal((await call("DELETE", "/api/todos/missing")).status, 404);
    assert.equal((await call("GET", "/api/nothing")).status, 404);
    assert.equal((await call("GET", "/api/todos/x/todos")).status, 404);

    let response = await call("POST", "/api/todos", { title: "x" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");

    response = await call("PUT", "/api/lists");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST");
  });
});

describe("UI files", () => {
  test("serves the page and styles", async () => {
    let response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await response.text(), /<script type="module" src="\/src\/client\/main.ts">/);

    response = await fetch(`${baseUrl}/styles.css`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/css/);
  });

  test("serves browser modules as JavaScript without type annotations", async () => {
    const response = await fetch(`${baseUrl}/src/shared/todo.ts`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/javascript/);
    const code = await response.text();
    assert.match(code, /export function parseTitle\(input\s*\)/);
    assert.doesNotMatch(code, /export interface/);
  });

  test("serves nothing outside the UI", async () => {
    for (const path of [
      "/src/server/store.ts",
      "/package.json",
      "/src/client/../server/store.ts",
      "/src/client/%2e%2e/server/store.ts",
      "/src/client/..%2fserver%2fstore.ts",
      "/src/shared/..%2f..%2fsrc%2fserver%2fstore.ts",
      "/src/client/..%2f..%2fpackage.json",
      "/src/client/tsconfig.json",
      "/%E0%A4%A.css",
    ]) {
      assert.equal((await fetch(baseUrl + path)).status, 404, path);
    }
  });
});
