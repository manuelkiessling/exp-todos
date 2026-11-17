import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { DATA_VERSION, DEFAULT_LIST_NAME, StoreError, TodoStore } from "../src/server/store.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "todos-store-"));
  file = join(dir, "nested", "todos.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-01-02T03:04:05.000Z";

function options() {
  let next = 0;
  return { now: () => new Date(NOW), newId: () => `id-${++next}` };
}

async function readData(): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

function storeError(kind: StoreError["kind"]): (error: unknown) => boolean {
  return (error) => error instanceof StoreError && error.kind === kind;
}

describe("TodoStore: opening", () => {
  test("starts with one empty default list and writes it right away", async () => {
    const store = await TodoStore.open(file, options());

    const lists = [{ id: "id-1", name: DEFAULT_LIST_NAME, createdAt: NOW }];
    assert.deepEqual(store.lists(), lists);
    assert.deepEqual(store.todos(), []);
    assert.deepEqual(await readData(), { version: DATA_VERSION, lists, todos: [] });

    // The default list keeps its id across a restart.
    assert.deepEqual((await TodoStore.open(file)).lists(), lists);
  });

  test("moves the todos of a version 1 file into the default list", async () => {
    const v1Todos = [
      { id: "a", title: "old one", completed: true, createdAt: "2025-12-01T00:00:00.000Z" },
      { id: "b", title: "old two", completed: false, createdAt: "2025-12-02T00:00:00.000Z" },
    ];
    await writeFile(join(dir, "v1.json"), JSON.stringify({ version: 1, todos: v1Todos }));
    file = join(dir, "v1.json");

    const store = await TodoStore.open(file, options());

    const lists = [{ id: "id-1", name: DEFAULT_LIST_NAME, createdAt: NOW }];
    const todos = v1Todos.map((todo) => ({ ...todo, listId: "id-1" }));
    assert.deepEqual(store.lists(), lists);
    assert.deepEqual(store.todos(), todos);
    assert.deepEqual(await readData(), { version: DATA_VERSION, lists, todos });
  });

  test("migrates an empty version 1 file", async () => {
    await writeFile(join(dir, "v1.json"), JSON.stringify({ version: 1, todos: [] }));
    const store = await TodoStore.open(join(dir, "v1.json"), options());
    assert.deepEqual(store.lists().map((list) => list.name), [DEFAULT_LIST_NAME]);
  });

  test("refuses a file it cannot read as todos, and leaves it alone", async () => {
    const cases: Array<[string, string, RegExp]> = [
      ["broken.json", "{ not json", /not valid JSON/],
      ["unknown.json", JSON.stringify({ version: 3, lists: [], todos: [] }), /unsupported version 3/],
      ["nolists.json", JSON.stringify({ version: 2, lists: [], todos: [] }), /has no lists/],
      ["badlist.json", JSON.stringify({ version: 2, lists: [{ id: 1 }], todos: [] }), /invalid list/],
      ["badv1.json", JSON.stringify({ version: 1, todos: [{ id: 1 }] }), /invalid todo/],
      [
        "orphan.json",
        JSON.stringify({
          version: 2,
          lists: [{ id: "l", name: "L", createdAt: NOW }],
          todos: [{ id: "t", listId: "elsewhere", title: "x", completed: false, createdAt: NOW }],
        }),
        /invalid todo/,
      ],
    ];
    for (const [name, content, message] of cases) {
      const path = join(dir, name);
      await writeFile(path, content);
      await assert.rejects(TodoStore.open(path), message, name);
      assert.equal(await readFile(path, "utf8"), content, `${name} unchanged`);
    }
  });
});

describe("TodoStore: lists", () => {
  test("creates and renames lists, keeping creation order", async () => {
    const store = await TodoStore.open(file, options());
    await store.createList("Work");
    await store.createList("Home");
    await store.renameList("id-2", "Office");

    assert.deepEqual(store.lists().map((list) => list.name), [DEFAULT_LIST_NAME, "Office", "Home"]);
    assert.deepEqual((await TodoStore.open(file)).lists(), store.lists());
  });

  test("refuses a name another list has, ignoring case", async () => {
    const store = await TodoStore.open(file, options());
    await store.createList("Work");
    await store.createList("Home");

    await assert.rejects(store.createList("work"), storeError("duplicate-list-name"));
    await assert.rejects(store.renameList("id-3", "WORK"), storeError("duplicate-list-name"));
    assert.deepEqual(store.lists().map((list) => list.name), [DEFAULT_LIST_NAME, "Work", "Home"]);
  });

  test("lets a list change the case of its own name", async () => {
    const store = await TodoStore.open(file, options());
    await store.createList("work");
    assert.equal((await store.renameList("id-2", "Work")).name, "Work");
  });

  test("deletes a list with its todos and keeps the other lists' todos", async () => {
    const store = await TodoStore.open(file, options());
    const work = await store.createList("Work");
    await store.createTodo(work.id, "report");
    await store.createTodo(work.id, "slides");
    await store.createTodo("id-1", "milk");

    assert.equal(await store.removeList(work.id), 2);
    assert.deepEqual(store.lists().map((list) => list.name), [DEFAULT_LIST_NAME]);
    assert.deepEqual(store.todos().map((todo) => todo.title), ["milk"]);
    assert.deepEqual((await TodoStore.open(file)).todos(), store.todos());
  });

  test("never deletes the last list", async () => {
    const store = await TodoStore.open(file, options());
    await store.createTodo("id-1", "keep me");
    await assert.rejects(store.removeList("id-1"), storeError("last-list"));
    assert.equal(store.lists().length, 1);
    assert.equal(store.todos().length, 1);
  });

  test("reports unknown lists", async () => {
    const store = await TodoStore.open(file, options());
    await assert.rejects(store.renameList("nope", "x"), storeError("list-not-found"));
    await assert.rejects(store.removeList("nope"), storeError("list-not-found"));
    await assert.rejects(store.createTodo("nope", "x"), storeError("list-not-found"));
    await assert.rejects(store.setAllCompleted("nope", true), storeError("list-not-found"));
    await assert.rejects(store.removeCompleted("nope"), storeError("list-not-found"));
  });
});

describe("TodoStore: todos", () => {
  test("creates todos in a list and keeps every change across a reopen", async () => {
    const store = await TodoStore.open(file, options());
    const created = await store.createTodo("id-1", "first");
    assert.deepEqual(created, { id: "id-2", listId: "id-1", title: "first", completed: false, createdAt: NOW });

    await store.createTodo("id-1", "drop");
    await store.createTodo("id-1", "done");
    await store.updateTodo("id-2", { title: "kept" });
    await store.updateTodo("id-4", { completed: true });
    await store.removeTodo("id-3");

    assert.deepEqual(
      (await TodoStore.open(file)).todos().map(({ title, completed }) => ({ title, completed })),
      [
        { title: "kept", completed: false },
        { title: "done", completed: true },
      ],
    );
  });

  test("moves a todo to another list, keeping its title and state", async () => {
    const store = await TodoStore.open(file, options());
    const work = await store.createList("Work");
    const todo = await store.createTodo("id-1", "report");
    await store.updateTodo(todo.id, { completed: true });

    assert.deepEqual(await store.updateTodo(todo.id, { listId: work.id }), {
      ...todo,
      completed: true,
      listId: work.id,
    });
    await assert.rejects(store.updateTodo(todo.id, { listId: "nope" }), storeError("list-not-found"));
    assert.equal(store.getTodo(todo.id)?.listId, work.id);
  });

  test("marks all and clears completed within one list only", async () => {
    const store = await TodoStore.open(file, options());
    const work = await store.createList("Work");
    await store.createTodo("id-1", "milk");
    await store.createTodo(work.id, "report");
    await store.createTodo(work.id, "slides");

    const marked = await store.setAllCompleted(work.id, true);
    assert.deepEqual(marked.map((todo) => todo.title), ["report", "slides"]);
    assert.equal(store.getTodo("id-3")?.completed, false, "other list untouched");

    await store.updateTodo("id-3", { completed: true });
    assert.equal(await store.removeCompleted(work.id), 2);
    assert.deepEqual(store.todos().map((todo) => todo.title), ["milk"]);
    assert.equal(await store.removeCompleted(work.id), 0);
  });

  test("reports unknown todos", async () => {
    const store = await TodoStore.open(file, options());
    await assert.rejects(store.updateTodo("nope", { completed: true }), storeError("todo-not-found"));
    await assert.rejects(store.removeTodo("nope"), storeError("todo-not-found"));
  });

  test("does not let callers change stored data through returned objects", async () => {
    const store = await TodoStore.open(file, options());
    const created = await store.createTodo("id-1", "original");
    created.title = "changed";
    store.todos()[0]!.completed = true;
    store.lists()[0]!.name = "changed";
    assert.deepEqual(store.getTodo(created.id), { ...created, title: "original", completed: false });
    assert.equal(store.lists()[0]?.name, DEFAULT_LIST_NAME);
  });

  test("persists concurrent changes in order", async () => {
    const store = await TodoStore.open(file, options());
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.createTodo("id-1", `todo ${index}`)));

    assert.deepEqual(
      (await TodoStore.open(file)).todos().map((todo) => todo.title),
      Array.from({ length: 20 }, (_, index) => `todo ${index}`),
    );
  });
});
