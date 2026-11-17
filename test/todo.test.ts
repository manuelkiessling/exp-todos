import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_TITLE_LENGTH, parseNewTodo, parseTitle, parseTodoChanges } from "../src/shared/todo.ts";

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
  test("accepts either or both fields", () => {
    assert.deepEqual(parseTodoChanges({ completed: true }), { ok: true, value: { completed: true } });
    assert.deepEqual(parseTodoChanges({ title: " b " }), { ok: true, value: { title: "b" } });
    assert.deepEqual(parseTodoChanges({ title: "b", completed: false }), {
      ok: true,
      value: { title: "b", completed: false },
    });
  });

  test("rejects empty, mistyped and unknown changes", () => {
    assert.equal(parseTodoChanges({}).ok, false);
    assert.equal(parseTodoChanges({ completed: "yes" }).ok, false);
    assert.equal(parseTodoChanges({ title: "" }).ok, false);
    assert.equal(parseTodoChanges({ id: "x" }).ok, false);
  });
});
