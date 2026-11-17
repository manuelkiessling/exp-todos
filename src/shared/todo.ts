// The todo model and its validation rules. Shared by the server, which
// enforces them, and the browser, which uses them to reject bad input early.

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface TodoChanges {
  title?: string;
  completed?: boolean;
}

export const MAX_TITLE_LENGTH = 200;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseTitle(input: unknown): Result<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "title must be a string" };
  }
  const title = input.trim();
  if (title === "") {
    return { ok: false, error: "title must not be empty" };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be at most ${MAX_TITLE_LENGTH} characters` };
  }
  return { ok: true, value: title };
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
  const unknown = unknownKeys(body, ["title", "completed"]);
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
  if (Object.keys(changes).length === 0) {
    return { ok: false, error: "body must change title or completed" };
  }
  return { ok: true, value: changes };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(body: Record<string, unknown>, allowed: string[]): string | undefined {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  return extra.length > 0 ? `unknown field: ${extra.join(", ")}` : undefined;
}
