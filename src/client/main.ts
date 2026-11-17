// The browser UI: one in-memory copy of the todo list, re-rendered after every
// change. Every change goes to the server first; the UI shows the result.

import { MAX_TITLE_LENGTH, parseTitle, type Todo } from "../shared/todo.ts";
import * as api from "./api.ts";

type Filter = "all" | "active" | "completed";

const EMPTY_MESSAGES: Record<Filter, string> = {
  all: "Nothing to do yet. Add a todo above.",
  active: "No active todos.",
  completed: "No completed todos.",
};

const state: { todos: Todo[]; editingId: string | null } = {
  todos: [],
  editingId: null,
};

const form = element<HTMLFormElement>("new-todo-form");
const newTodo = element<HTMLInputElement>("new-todo");
const errorBox = element<HTMLParagraphElement>("error");
const toggleAllRow = element<HTMLDivElement>("toggle-all-row");
const toggleAll = element<HTMLInputElement>("toggle-all");
const list = element<HTMLUListElement>("todo-list");
const empty = element<HTMLParagraphElement>("empty");
const footer = element<HTMLElement>("footer");
const count = element<HTMLSpanElement>("todo-count");
const clearButton = element<HTMLButtonElement>("clear-completed");

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`missing element #${id}`);
  }
  return found as T;
}

function currentFilter(): Filter {
  switch (location.hash) {
    case "#/active":
      return "active";
    case "#/completed":
      return "completed";
    default:
      return "all";
  }
}

function visibleTodos(filter: Filter): Todo[] {
  switch (filter) {
    case "active":
      return state.todos.filter((todo) => !todo.completed);
    case "completed":
      return state.todos.filter((todo) => todo.completed);
    case "all":
      return state.todos;
  }
}

function render(): void {
  const filter = currentFilter();
  const visible = visibleTodos(filter);
  const activeCount = state.todos.filter((todo) => !todo.completed).length;
  const completedCount = state.todos.length - activeCount;

  list.replaceChildren(...visible.map(renderTodo));
  empty.hidden = visible.length > 0;
  empty.textContent = EMPTY_MESSAGES[filter];

  toggleAllRow.hidden = state.todos.length === 0;
  toggleAll.checked = state.todos.length > 0 && activeCount === 0;

  footer.hidden = state.todos.length === 0;
  count.textContent = `${activeCount} ${activeCount === 1 ? "item" : "items"} left`;
  clearButton.hidden = completedCount === 0;
  for (const link of footer.querySelectorAll<HTMLAnchorElement>("a[data-filter]")) {
    if (link.dataset.filter === filter) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  const editField = list.querySelector<HTMLInputElement>("input.edit-field");
  if (editField) {
    editField.focus();
    editField.setSelectionRange(editField.value.length, editField.value.length);
  }
}

function renderTodo(todo: Todo): HTMLLIElement {
  const item = document.createElement("li");
  item.className = todo.completed ? "todo completed" : "todo";
  item.dataset.id = todo.id;

  if (state.editingId === todo.id) {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "edit-field";
    field.value = todo.title;
    field.maxLength = MAX_TITLE_LENGTH;
    field.setAttribute("aria-label", `Edit “${todo.title}”`);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void finishEditing(todo.id, field.value);
      } else if (event.key === "Escape") {
        state.editingId = null;
        render();
      }
    });
    field.addEventListener("blur", () => void finishEditing(todo.id, field.value));
    item.append(field);
    return item;
  }

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "toggle";
  toggle.checked = todo.completed;
  toggle.setAttribute("aria-label", `Mark “${todo.title}” as ${todo.completed ? "active" : "complete"}`);
  toggle.addEventListener("change", () => void run(() => replaceTodo(api.updateTodo(todo.id, { completed: toggle.checked }))));

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = todo.title;
  title.addEventListener("dblclick", () => startEditing(todo.id));

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit “${todo.title}”`);
  edit.addEventListener("click", () => startEditing(todo.id));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Delete";
  remove.setAttribute("aria-label", `Delete “${todo.title}”`);
  remove.addEventListener("click", () => void run(() => removeTodo(todo.id)));

  const actions = document.createElement("span");
  actions.className = "actions";
  actions.append(edit, remove);

  item.append(toggle, title, actions);
  return item;
}

function startEditing(id: string): void {
  state.editingId = id;
  render();
}

/** Saves an edit; like the classic todo apps, an empty title deletes the todo. */
async function finishEditing(id: string, value: string): Promise<void> {
  // Enter re-renders, which blurs the field: only the first of the two saves counts.
  if (state.editingId !== id) {
    return;
  }
  state.editingId = null;
  if (value.trim() === "") {
    await run(() => removeTodo(id));
    return;
  }
  const original = state.todos.find((todo) => todo.id === id);
  const title = parseTitle(value);
  if (!title.ok || title.value === original?.title) {
    render();
    if (!title.ok) {
      showError(title.error);
    }
    return;
  }
  await run(() => replaceTodo(api.updateTodo(id, { title: title.value })));
}

async function replaceTodo(pending: Promise<Todo>): Promise<void> {
  const updated = await pending;
  state.todos = state.todos.map((todo) => (todo.id === updated.id ? updated : todo));
}

async function removeTodo(id: string): Promise<void> {
  await api.deleteTodo(id);
  state.todos = state.todos.filter((todo) => todo.id !== id);
}

/** Runs one change against the server, then re-renders; a failure is shown, not thrown. */
async function run(change: () => Promise<void>): Promise<void> {
  try {
    await change();
    showError(null);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
  render();
}

function showError(message: string | null): void {
  errorBox.hidden = message === null;
  errorBox.textContent = message ?? "";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = parseTitle(newTodo.value);
  if (!title.ok) {
    showError(title.error);
    return;
  }
  void run(async () => {
    state.todos = [...state.todos, await api.createTodo(title.value)];
    newTodo.value = "";
  });
});

toggleAll.addEventListener("change", () => {
  void run(async () => {
    state.todos = await api.setAllCompleted(toggleAll.checked);
  });
});

clearButton.addEventListener("click", () => {
  void run(async () => {
    await api.clearCompleted();
    state.todos = state.todos.filter((todo) => !todo.completed);
  });
});

window.addEventListener("hashchange", render);

void run(async () => {
  state.todos = await api.listTodos();
});
