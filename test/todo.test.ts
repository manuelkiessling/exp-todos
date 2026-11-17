import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_LIST_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  parseListBody,
  parseListName,
  parseNewTodo,
  parseTitle,
  parseTodoChanges,
  sameListName,
} from "../src/shared/todo.ts";

describe("parseTitle", () => {
  test("trims surrounding whitespace", () => {
    assert.deepEqual(parseTitle("  buy milk \n"), { ok: true, value: "buy milk" });
  });

  test("rejects non-strings and blank titles", () => {
    assert.equal(parseTitle(42).ok, false);
    assert.equal(parseTitle(undefined).ok, false);
    assert.equal(parseTitle("   ").ok, false);
  });

  test("accepts titles up to the limit and rejects longer ones", () => {
    assert.equal(parseTitle("x".repeat(MAX_TITLE_LENGTH)).ok, true);
    assert.equal(parseTitle("x".repeat(MAX_TITLE_LENGTH + 1)).ok, false);
  });
});

describe("parseNewTodo", () => {
  test("accepts a title", () => {
    assert.deepEqual(parseNewTodo({ title: " a " }), { ok: true, value: { title: "a" } });
  });

  test("rejects non-objects and unknown fields", () => {
    assert.equal(parseNewTodo(null).ok, false);
    assert.equal(parseNewTodo([]).ok, false);
    assert.deepEqual(parseNewTodo({ title: "a", completed: true }), {
      ok: false,
      error: "unknown field: completed",
    });
  });
});

describe("parseTodoChanges", () => {
  test("accepts any combination of fields", () => {
    assert.deepEqual(parseTodoChanges({ completed: true }), { ok: true, value: { completed: true } });
    assert.deepEqual(parseTodoChanges({ title: " b " }), { ok: true, value: { title: "b" } });
    assert.deepEqual(parseTodoChanges({ listId: "l" }), { ok: true, value: { listId: "l" } });
    assert.deepEqual(parseTodoChanges({ title: "b", completed: false, listId: "l" }), {
      ok: true,
      value: { title: "b", completed: false, listId: "l" },
    });
  });

  test("rejects empty, mistyped and unknown changes", () => {
    assert.deepEqual(parseTodoChanges({}), { ok: false, error: "body must change title, completed or listId" });
    assert.equal(parseTodoChanges({ completed: "yes" }).ok, false);
    assert.equal(parseTodoChanges({ title: "" }).ok, false);
    assert.equal(parseTodoChanges({ listId: "" }).ok, false);
    assert.equal(parseTodoChanges({ listId: 7 }).ok, false);
    assert.equal(parseTodoChanges({ id: "x" }).ok, false);
  });
});

describe("list names", () => {
  test("are trimmed, non-empty and limited in length", () => {
    assert.deepEqual(parseListName("  Work "), { ok: true, value: "Work" });
    assert.deepEqual(parseListName(" "), { ok: false, error: "name must not be empty" });
    assert.equal(parseListName("x".repeat(MAX_LIST_NAME_LENGTH)).ok, true);
    assert.equal(parseListName("x".repeat(MAX_LIST_NAME_LENGTH + 1)).ok, false);
    assert.equal(parseListName(null).ok, false);
  });

  test("compare without regard to case", () => {
    assert.equal(sameListName("Work", "wORK"), true);
    assert.equal(sameListName("Work", "Works"), false);
  });

  test("arrive in a body with only a name", () => {
    assert.deepEqual(parseListBody({ name: " Home " }), { ok: true, value: { name: "Home" } });
    assert.deepEqual(parseListBody({ name: "Home", id: "x" }), { ok: false, error: "unknown field: id" });
    assert.equal(parseListBody([]).ok, false);
  });
});
