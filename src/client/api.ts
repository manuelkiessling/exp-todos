// Typed calls to the server's JSON API (see src/server/app.ts).

import type { Todo, TodoChanges } from "../shared/todo.ts";

export function listTodos(): Promise<Todo[]> {
  return request<Todo[]>("GET", "/api/todos");
}

export function createTodo(title: string): Promise<Todo> {
  return request<Todo>("POST", "/api/todos", { title });
}

export function updateTodo(id: string, changes: TodoChanges): Promise<Todo> {
  return request<Todo>("PATCH", `/api/todos/${encodeURIComponent(id)}`, changes);
}

export async function deleteTodo(id: string): Promise<void> {
  await request<void>("DELETE", `/api/todos/${encodeURIComponent(id)}`);
}

export function setAllCompleted(completed: boolean): Promise<Todo[]> {
  return request<Todo[]>("PATCH", "/api/todos", { completed });
}

export async function clearCompleted(): Promise<number> {
  const { removed } = await request<{ removed: number }>("DELETE", "/api/todos?completed=true");
  return removed;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not a JSON error body; fall through to the status line.
  }
  return `request failed: ${response.status} ${response.statusText}`;
}
