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
import type { Todo } from "../src/shared/todo.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

let dir: string;
let server: Server;
let baseUrl: string;

// Each test gets a fresh store behind the same server.
let store: TodoStore;

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
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(baseUrl + path, init);
}

async function create(title: string): Promise<Todo> {
  const response = await call("POST", "/api/todos", { title });
  assert.equal(response.status, 201);
  return (await response.json()) as Todo;
}

describe("todos API", () => {
  test("creates, lists, changes and deletes a todo", async () => {
    const todo = await create("  write tests ");
    assert.equal(todo.title, "write tests");
    assert.equal(todo.completed, false);

    let response = await call("PATCH", `/api/todos/${todo.id}`, { completed: true, title: "write more tests" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...todo, completed: true, title: "write more tests" });

    response = await call("GET", "/api/todos");
    assert.deepEqual(await response.json(), [{ ...todo, completed: true, title: "write more tests" }]);

    response = await call("DELETE", `/api/todos/${todo.id}`);
    assert.equal(response.status, 204);
    assert.deepEqual(await (await call("GET", "/api/todos")).json(), []);
  });

  test("marks all todos and clears the completed ones", async () => {
    await create("a");
    const b = await create("b");

    let response = await call("PATCH", "/api/todos", { completed: true });
    assert.ok(((await response.json()) as Todo[]).every((todo) => todo.completed));
    await call("PATCH", `/api/todos/${b.id}`, { completed: false });

    response = await call("DELETE", "/api/todos?completed=true");
    assert.deepEqual(await response.json(), { removed: 1 });
    assert.deepEqual(((await (await call("GET", "/api/todos")).json()) as Todo[]).map((todo) => todo.title), ["b"]);
  });

  test("never deletes every todo in bulk", async () => {
    await create("survivor");
    const response = await call("DELETE", "/api/todos");
    assert.equal(response.status, 400);
    assert.equal(((await (await call("GET", "/api/todos")).json()) as Todo[]).length, 1);
  });

  test("rejects invalid bodies with a message", async () => {
    const todo = await create("x");
    const cases: Array<[string, string, unknown, string]> = [
      ["POST", "/api/todos", { title: "" }, "title must not be empty"],
      ["POST", "/api/todos", { title: "x", completed: true }, "unknown field: completed"],
      ["PATCH", `/api/todos/${todo.id}`, {}, "body must change title or completed"],
      ["PATCH", "/api/todos", { completed: "yes" }, "body must be { completed: boolean }"],
    ];
    for (const [method, path, body, error] of cases) {
      const response = await call(method, path, body);
      assert.equal(response.status, 400, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error });
    }
  });

  test("rejects malformed requests", async () => {
    let response = await fetch(`${baseUrl}/api/todos`, { method: "POST", body: "title=x" });
    assert.equal(response.status, 415);

    response = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);

    response = await call("POST", "/api/todos", { title: "x".repeat(70 * 1024) });
    assert.equal(response.status, 413);
  });

  test("answers unknown todos, routes and methods", async () => {
    assert.equal((await call("PATCH", "/api/todos/missing", { completed: true })).status, 404);
    assert.equal((await call("DELETE", "/api/todos/missing")).status, 404);
    assert.equal((await call("GET", "/api/nothing")).status, 404);

    const response = await call("PUT", "/api/todos");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST, PATCH, DELETE");
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
