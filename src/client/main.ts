// The browser UI: one in-memory copy of all lists and todos, re-rendered after
// every change. Every change goes to the server first; the UI shows the result.
//
// The URL names the selected list and filter: #/lists/<id>, #/lists/<id>/active
// or #/lists/<id>/completed. Anything else shows the first list.

import { MAX_TITLE_LENGTH, parseListName, parseTitle, type Todo, type TodoList } from "../shared/todo.ts";
import * as api from "./api.ts";

type Filter = "all" | "active" | "completed";

const EMPTY_MESSAGES: Record<Filter, string> = {
  all: "This list is empty. Add a todo above.",
  active: "No active todos.",
  completed: "No completed todos.",
};

const state: {
  lists: TodoList[];
  todos: Todo[];
  editingId: string | null;
  renamingList: boolean;
} = {
  lists: [],
  todos: [],
  editingId: null,
  renamingList: false,
};

const errorBox = element<HTMLParagraphElement>("error");
const listLinks = element<HTMLUListElement>("lists");
const newListForm = element<HTMLFormElement>("new-list-form");
const newListInput = element<HTMLInputElement>("new-list");
const listName = element<HTMLHeadingElement>("list-name");
const renameForm = element<HTMLFormElement>("rename-list-form");
const renameInput = element<HTMLInputElement>("rename-list-input");
const renameLabel = element<HTMLLabelElement>("rename-list-label");
const cancelRename = element<HTMLButtonElement>("cancel-rename");
const listActions = element<HTMLDivElement>("list-actions");
const renameButton = element<HTMLButtonElement>("rename-list");
const deleteButton = element<HTMLButtonElement>("delete-list");
const newTodoForm = element<HTMLFormElement>("new-todo-form");
const newTodoInput = element<HTMLInputElement>("new-todo");
const toggleAllRow = element<HTMLDivElement>("toggle-all-row");
const toggleAll = element<HTMLInputElement>("toggle-all");
const todoList = element<HTMLUListElement>("todo-list");
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

function parseRoute(hash: string): { listId: string | undefined; filter: Filter } {
  const list = /^#\/lists\/([^/]+)(?:\/(active|completed))?$/.exec(hash);
  if (list?.[1]) {
    let listId: string | undefined;
    try {
      listId = decodeURIComponent(list[1]);
    } catch {
      listId = undefined;
    }
    return { listId, filter: (list[2] as Filter | undefined) ?? "all" };
  }
  // Links from before there were lists open the first list.
  const legacy = /^#\/(active|completed)$/.exec(hash);
  return { listId: undefined, filter: (legacy?.[1] as Filter | undefined) ?? "all" };
}

function hashFor(listId: string, filter: Filter): string {
  const base = `#/lists/${encodeURIComponent(listId)}`;
  return filter === "all" ? base : `${base}/${filter}`;
}

/** The selected list and filter; an unknown list falls back to the first one. */
function currentView(): { list: TodoList; filter: Filter } | undefined {
  const route = parseRoute(location.hash);
  const list = state.lists.find((candidate) => candidate.id === route.listId) ?? state.lists[0];
  return list && { list, filter: route.filter };
}

function todosOf(listId: string): Todo[] {
  return state.todos.filter((todo) => todo.listId === listId);
}

function activeCount(listId: string): number {
  return todosOf(listId).filter((todo) => !todo.completed).length;
}

function visibleTodos(listId: string, filter: Filter): Todo[] {
  const todos = todosOf(listId);
  switch (filter) {
    case "active":
      return todos.filter((todo) => !todo.completed);
    case "completed":
      return todos.filter((todo) => todo.completed);
    case "all":
      return todos;
  }
}

function render(): void {
  const view = currentView();
  if (!view) {
    return;
  }
  const { list, filter } = view;
  // Show the URL of what is on screen, so a reload or bookmark returns here.
  const canonical = hashFor(list.id, filter);
  if (location.hash !== canonical) {
    history.replaceState(null, "", canonical);
  }
  document.title = `${list.name} · Todos`;

  listLinks.replaceChildren(...state.lists.map((candidate) => renderListLink(candidate, candidate.id === list.id)));

  listName.textContent = list.name;
  renameLabel.textContent = `New name for “${list.name}”`;
  listName.hidden = state.renamingList;
  renameForm.hidden = !state.renamingList;
  listActions.hidden = state.renamingList;
  const onlyList = state.lists.length === 1;
  deleteButton.disabled = onlyList;
  deleteButton.title = onlyList ? "The last list can't be deleted" : "";
  if (state.renamingList && document.activeElement !== renameInput) {
    renameInput.value = list.name;
    renameInput.focus();
    renameInput.select();
  }

  const todos = todosOf(list.id);
  const visible = visibleTodos(list.id, filter);
  const left = activeCount(list.id);
  const completedCount = todos.length - left;

  todoList.replaceChildren(...visible.map(renderTodo));
  empty.hidden = visible.length > 0;
  empty.textContent = EMPTY_MESSAGES[filter];

  toggleAllRow.hidden = todos.length === 0;
  toggleAll.checked = todos.length > 0 && left === 0;

  footer.hidden = todos.length === 0;
  count.textContent = `${left} ${left === 1 ? "item" : "items"} left`;
  clearButton.hidden = completedCount === 0;
  for (const link of footer.querySelectorAll<HTMLAnchorElement>("a[data-filter]")) {
    const linkFilter = link.dataset.filter as Filter;
    link.href = hashFor(list.id, linkFilter);
    if (linkFilter === filter) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  const editField = todoList.querySelector<HTMLInputElement>("input.edit-field");
  if (editField) {
    editField.focus();
    editField.setSelectionRange(editField.value.length, editField.value.length);
  }
}

function renderListLink(list: TodoList, selected: boolean): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = hashFor(list.id, "all");
  if (selected) {
    link.setAttribute("aria-current", "page");
  }
  const name = document.createElement("span");
  name.className = "list-name";
  name.textContent = list.name;
  const left = activeCount(list.id);
  const badge = document.createElement("span");
  badge.className = "count";
  badge.textContent = String(left);
  const hint = document.createElement("span");
  hint.className = "visually-hidden";
  hint.textContent = ` ${left === 1 ? "item" : "items"} left`;
  badge.append(hint);
  link.append(name, badge);
  item.append(link);
  return item;
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

  const actions = document.createElement("span");
  actions.className = "actions";

  if (state.lists.length > 1) {
    const move = document.createElement("select");
    move.className = "move";
    move.setAttribute("aria-label", `Move “${todo.title}” to list`);
    for (const list of state.lists) {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.name;
      option.selected = list.id === todo.listId;
      move.append(option);
    }
    move.addEventListener("change", () => void run(() => replaceTodo(api.updateTodo(todo.id, { listId: move.value }))));
    actions.append(move);
  }

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

newListForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = parseListName(newListInput.value);
  if (!name.ok) {
    showError(name.error);
    return;
  }
  void run(async () => {
    const list = await api.createList(name.value);
    state.lists = [...state.lists, list];
    newListInput.value = "";
    history.pushState(null, "", hashFor(list.id, "all"));
    newTodoInput.focus();
  });
});

renameButton.addEventListener("click", () => {
  state.renamingList = true;
  render();
});

cancelRename.addEventListener("click", () => {
  state.renamingList = false;
  render();
});

renameInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    state.renamingList = false;
    render();
  }
});

renameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const view = currentView();
  if (!view) {
    return;
  }
  const name = parseListName(renameInput.value);
  if (!name.ok) {
    showError(name.error);
    return;
  }
  if (name.value === view.list.name) {
    state.renamingList = false;
    render();
    return;
  }
  void run(async () => {
    const renamed = await api.renameList(view.list.id, name.value);
    state.lists = state.lists.map((list) => (list.id === renamed.id ? renamed : list));
    // Only a successful rename closes the form, so a taken name can be fixed in place.
    state.renamingList = false;
  });
});

deleteButton.addEventListener("click", () => {
  const view = currentView();
  if (!view) {
    return;
  }
  const { list } = view;
  const todoCount = todosOf(list.id).length;
  if (todoCount > 0) {
    const what = todoCount === 1 ? "1 todo" : `${todoCount} todos`;
    if (!confirm(`Delete the list “${list.name}” and its ${what}?`)) {
      return;
    }
  }
  void run(async () => {
    await api.deleteList(list.id);
    state.lists = state.lists.filter((candidate) => candidate.id !== list.id);
    state.todos = state.todos.filter((todo) => todo.listId !== list.id);
  });
});

newTodoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const view = currentView();
  if (!view) {
    return;
  }
  const title = parseTitle(newTodoInput.value);
  if (!title.ok) {
    showError(title.error);
    return;
  }
  void run(async () => {
    state.todos = [...state.todos, await api.createTodo(view.list.id, title.value)];
    newTodoInput.value = "";
  });
});

toggleAll.addEventListener("change", () => {
  const view = currentView();
  if (!view) {
    return;
  }
  void run(async () => {
    const updated = await api.setAllCompleted(view.list.id, toggleAll.checked);
    const byId = new Map(updated.map((todo) => [todo.id, todo]));
    state.todos = state.todos.map((todo) => byId.get(todo.id) ?? todo);
  });
});

clearButton.addEventListener("click", () => {
  const view = currentView();
  if (!view) {
    return;
  }
  void run(async () => {
    await api.clearCompleted(view.list.id);
    state.todos = state.todos.filter((todo) => todo.listId !== view.list.id || !todo.completed);
  });
});

window.addEventListener("hashchange", () => {
  state.editingId = null;
  state.renamingList = false;
  render();
});

void run(async () => {
  const [lists, todos] = await Promise.all([api.listLists(), api.listTodos()]);
  state.lists = lists;
  state.todos = todos;
});
