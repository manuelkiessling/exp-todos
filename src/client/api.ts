// Typed calls to the server's JSON API (see src/server/app.ts).

import type { Todo, TodoChanges, TodoList } from "../shared/todo.ts";

export function listLists(): Promise<TodoList[]> {
  return request<TodoList[]>("GET", "/api/lists");
}

export function createList(name: string): Promise<TodoList> {
  return request<TodoList>("POST", "/api/lists", { name });
}

export function renameList(id: string, name: string): Promise<TodoList> {
  return request<TodoList>("PATCH", listPath(id), { name });
}

export async function deleteList(id: string): Promise<void> {
  await request<void>("DELETE", listPath(id));
}

export function listTodos(): Promise<Todo[]> {
  return request<Todo[]>("GET", "/api/todos");
}

export function createTodo(listId: string, title: string): Promise<Todo> {
  return request<Todo>("POST", `${listPath(listId)}/todos`, { title });
}

export function updateTodo(id: string, changes: TodoChanges): Promise<Todo> {
  return request<Todo>("PATCH", `/api/todos/${encodeURIComponent(id)}`, changes);
}

export async function deleteTodo(id: string): Promise<void> {
  await request<void>("DELETE", `/api/todos/${encodeURIComponent(id)}`);
}

export function setAllCompleted(listId: string, completed: boolean): Promise<Todo[]> {
  return request<Todo[]>("PATCH", `${listPath(listId)}/todos`, { completed });
}

export async function clearCompleted(listId: string): Promise<number> {
  const { removed } = await request<{ removed: number }>("DELETE", `${listPath(listId)}/todos?completed=true`);
  return removed;
}

function listPath(id: string): string {
  return `/api/lists/${encodeURIComponent(id)}`;
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
