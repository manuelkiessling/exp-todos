import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { DATA_VERSION, TodoStore } from "../src/server/store.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "todos-store-"));
  file = join(dir, "nested", "todos.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fixedClock(): () => Date {
  return () => new Date("2026-01-02T03:04:05.000Z");
}

function sequentialIds(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

describe("TodoStore", () => {
  test("starts empty when the file does not exist", async () => {
    const store = await TodoStore.open(file);
    assert.deepEqual(store.list(), []);
  });

  test("creates todos in order and writes them to the file", async () => {
    const store = await TodoStore.open(file, { now: fixedClock(), newId: sequentialIds() });
    await store.create("first");
    await store.create("second");

    const expected = [
      { id: "id-1", title: "first", completed: false, createdAt: "2026-01-02T03:04:05.000Z" },
      { id: "id-2", title: "second", completed: false, createdAt: "2026-01-02T03:04:05.000Z" },
    ];
    assert.deepEqual(store.list(), expected);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: DATA_VERSION, todos: expected });
  });

  test("keeps every change across a reopen", async () => {
    const store = await TodoStore.open(file, { newId: sequentialIds() });
    await store.create("keep");
    await store.create("drop");
    await store.create("done");
    await store.update("id-1", { title: "kept" });
    await store.update("id-3", { completed: true });
    await store.remove("id-2");

    const reopened = await TodoStore.open(file);
    assert.deepEqual(
      reopened.list().map(({ title, completed }) => ({ title, completed })),
      [
        { title: "kept", completed: false },
        { title: "done", completed: true },
      ],
    );
  });

  test("reports missing todos instead of changing anything", async () => {
    const store = await TodoStore.open(file);
    assert.equal(await store.update("nope", { completed: true }), undefined);
    assert.equal(await store.remove("nope"), false);
  });

  test("marks all todos and clears the completed ones", async () => {
    const store = await TodoStore.open(file, { newId: sequentialIds() });
    await store.create("a");
    await store.create("b");
    await store.create("c");

    assert.ok((await store.setAllCompleted(true)).every((todo) => todo.completed));
    await store.update("id-2", { completed: false });
    assert.equal(await store.removeCompleted(), 2);
    assert.deepEqual(store.list().map((todo) => todo.title), ["b"]);
    assert.equal(await store.removeCompleted(), 0);
  });

  test("does not let callers change stored todos through returned objects", async () => {
    const store = await TodoStore.open(file);
    const created = await store.create("original");
    created.title = "changed";
    store.list()[0]!.completed = true;
    assert.deepEqual(store.get(created.id), { ...created, title: "original", completed: false });
  });

  test("persists concurrent changes in order", async () => {
    const store = await TodoStore.open(file, { newId: sequentialIds() });
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.create(`todo ${index}`)));

    const reopened = await TodoStore.open(file);
    assert.deepEqual(
      reopened.list().map((todo) => todo.title),
      Array.from({ length: 20 }, (_, index) => `todo ${index}`),
    );
  });

  test("refuses a file it cannot read as todos", async () => {
    await writeFile(join(dir, "broken.json"), "{ not json");
    await assert.rejects(TodoStore.open(join(dir, "broken.json")), /not valid JSON/);

    await writeFile(join(dir, "old.json"), JSON.stringify({ version: 0, todos: [] }));
    await assert.rejects(TodoStore.open(join(dir, "old.json")), /not a version 1 todos file/);

    await writeFile(join(dir, "bad.json"), JSON.stringify({ version: DATA_VERSION, todos: [{ id: 1 }] }));
    await assert.rejects(TodoStore.open(join(dir, "bad.json")), /invalid todo/);
  });
});
