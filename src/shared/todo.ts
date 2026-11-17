// The todo model and its validation rules. Shared by the server, which
// enforces them, and the browser, which uses them to reject bad input early.

/** A named list of todos. Every todo belongs to exactly one list. */
export interface TodoList {
  id: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface Todo {
  id: string;
  listId: string;
  title: string;
  completed: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface TodoChanges {
  title?: string;
  completed?: boolean;
  /** Moves the todo to this list. */
  listId?: string;
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_LIST_NAME_LENGTH = 50;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseTitle(input: unknown): Result<string> {
  return parseName(input, "title", MAX_TITLE_LENGTH);
}

export function parseListName(input: unknown): Result<string> {
  return parseName(input, "name", MAX_LIST_NAME_LENGTH);
}

/** List names are unique regardless of upper and lower case. */
export function sameListName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** Validates the body of a request that creates a todo. */
export function parseNewTodo(body: unknown): Result<{ title: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const unknown = unknownKeys(body, ["title"]);
  if (unknown) {
    return { ok: false, error: unknown };
  }
  const title = parseTitle(body.title);
  return title.ok ? { ok: true, value: { title: title.value } } : title;
}

/** Validates the body of a request that changes one todo. */
export function parseTodoChanges(body: unknown): Result<TodoChanges> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const unknown = unknownKeys(body, ["title", "completed", "listId"]);
  if (unknown) {
    return { ok: false, error: unknown };
  }
  const changes: TodoChanges = {};
  if ("title" in body) {
    const title = parseTitle(body.title);
    if (!title.ok) {
      return title;
    }
    changes.title = title.value;
  }
  if ("completed" in body) {
    if (typeof body.completed !== "boolean") {
      return { ok: false, error: "completed must be a boolean" };
    }
    changes.completed = body.completed;
  }
  if ("listId" in body) {
    if (typeof body.listId !== "string" || body.listId === "") {
      return { ok: false, error: "listId must be a non-empty string" };
    }
    changes.listId = body.listId;
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, error: "body must change title, completed or listId" };
  }
  return { ok: true, value: changes };
}

/** Validates the body of a request that creates or renames a list. */
export function parseListBody(body: unknown): Result<{ name: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const unknown = unknownKeys(body, ["name"]);
  if (unknown) {
    return { ok: false, error: unknown };
  }
  const name = parseListName(body.name);
  return name.ok ? { ok: true, value: { name: name.value } } : name;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseName(input: unknown, field: string, maxLength: number): Result<string> {
  if (typeof input !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const value = input.trim();
  if (value === "") {
    return { ok: false, error: `${field} must not be empty` };
  }
  if (value.length > maxLength) {
    return { ok: false, error: `${field} must be at most ${maxLength} characters` };
  }
  return { ok: true, value };
}

function unknownKeys(body: Record<string, unknown>, allowed: string[]): string | undefined {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  return extra.length > 0 ? `unknown field: ${extra.join(", ")}` : undefined;
}
