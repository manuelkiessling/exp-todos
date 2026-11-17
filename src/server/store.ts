import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isPlainObject, sameListName, type Todo, type TodoChanges, type TodoList } from "../shared/todo.ts";

/** Version of the data file's format. Bump it when the shape changes. */
export const DATA_VERSION = 2;

/** The list that a fresh store starts with, and that version 1 todos move into. */
export const DEFAULT_LIST_NAME = "Todos";

interface DataFile {
  version: number;
  lists: TodoList[];
  todos: Todo[];
}

export interface StoreOptions {
  now?: () => Date;
  newId?: () => string;
}

/** Why a change was refused. The API maps each kind to a status code. */
export type StoreErrorKind = "list-not-found" | "todo-not-found" | "duplicate-list-name" | "last-list";

export class StoreError extends Error {
  readonly kind: StoreErrorKind;

  constructor(kind: StoreErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Keeps all lists and todos in memory, each in creation order, and writes
 * everything to one JSON file after every change. A change resolves once it
 * is on disk. There is always at least one list.
 */
export class TodoStore {
  readonly #file: string;
  readonly #now: () => Date;
  readonly #newId: () => string;
  #lists: TodoList[];
  #todos: Todo[];
  // Writes run one at a time, in the order the changes happened.
  #lastWrite: Promise<void> = Promise.resolve();

  private constructor(file: string, data: DataFile, options: StoreOptions) {
    this.#file = file;
    this.#lists = data.lists;
    this.#todos = data.todos;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  /**
   * Opens the store backed by `file`. A missing file starts with one empty
   * list, and a version 1 file is migrated; both are written right away, so
   * the default list keeps its id across restarts. A file that cannot be read
   * as todos is an error, so it is never overwritten.
   */
  static async open(file: string, options: StoreOptions = {}): Promise<TodoStore> {
    let text: string | undefined;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    const store = new TodoStore(file, { version: DATA_VERSION, lists: [], todos: [] }, options);
    if (text === undefined) {
      store.#lists.push(store.#newList(DEFAULT_LIST_NAME));
      await store.#save();
      return store;
    }
    const data = parseDataFile(text, file);
    if (data.version === 1) {
      const list = store.#newList(DEFAULT_LIST_NAME);
      store.#lists = [list];
      store.#todos = data.todos.map((todo) => ({ ...todo, listId: list.id }));
      await store.#save();
      return store;
    }
    store.#lists = data.lists;
    store.#todos = data.todos;
    return store;
  }

  lists(): TodoList[] {
    return this.#lists.map((list) => ({ ...list }));
  }

  /** All todos of all lists, oldest first. */
  todos(): Todo[] {
    return this.#todos.map((todo) => ({ ...todo }));
  }

  getTodo(id: string): Todo | undefined {
    const todo = this.#todos.find((candidate) => candidate.id === id);
    return todo && { ...todo };
  }

  async createList(name: string): Promise<TodoList> {
    this.#assertNameAvailable(name);
    const list = this.#newList(name);
    this.#lists.push(list);
    await this.#save();
    return { ...list };
  }

  async renameList(id: string, name: string): Promise<TodoList> {
    const list = this.#findList(id);
    this.#assertNameAvailable(name, id);
    list.name = name;
    await this.#save();
    return { ...list };
  }

  /** Deletes a list together with its todos, and returns how many todos were deleted. */
  async removeList(id: string): Promise<number> {
    this.#findList(id);
    if (this.#lists.length === 1) {
      throw new StoreError("last-list", "the last list cannot be deleted");
    }
    const before = this.#todos.length;
    this.#lists = this.#lists.filter((list) => list.id !== id);
    this.#todos = this.#todos.filter((todo) => todo.listId !== id);
    await this.#save();
    return before - this.#todos.length;
  }

  async createTodo(listId: string, title: string): Promise<Todo> {
    this.#findList(listId);
    const todo: Todo = {
      id: this.#newId(),
      listId,
      title,
      completed: false,
      createdAt: this.#now().toISOString(),
    };
    this.#todos.push(todo);
    await this.#save();
    return { ...todo };
  }

  /** Applies `changes` to one todo; a `listId` moves it to that list. */
  async updateTodo(id: string, changes: TodoChanges): Promise<Todo> {
    const todo = this.#findTodo(id);
    if (changes.listId !== undefined) {
      this.#findList(changes.listId);
    }
    Object.assign(todo, changes);
    await this.#save();
    return { ...todo };
  }

  async removeTodo(id: string): Promise<void> {
    this.#findTodo(id);
    this.#todos = this.#todos.filter((todo) => todo.id !== id);
    await this.#save();
  }

  /** Marks every todo of one list completed or active, and returns that list's todos. */
  async setAllCompleted(listId: string, completed: boolean): Promise<Todo[]> {
    this.#findList(listId);
    for (const todo of this.#todos) {
      if (todo.listId === listId) {
        todo.completed = completed;
      }
    }
    await this.#save();
    return this.todos().filter((todo) => todo.listId === listId);
  }

  /** Deletes the completed todos of one list and returns how many were deleted. */
  async removeCompleted(listId: string): Promise<number> {
    this.#findList(listId);
    const before = this.#todos.length;
    this.#todos = this.#todos.filter((todo) => todo.listId !== listId || !todo.completed);
    const removed = before - this.#todos.length;
    if (removed > 0) {
      await this.#save();
    }
    return removed;
  }

  #newList(name: string): TodoList {
    return { id: this.#newId(), name, createdAt: this.#now().toISOString() };
  }

  #findList(id: string): TodoList {
    const list = this.#lists.find((candidate) => candidate.id === id);
    if (!list) {
      throw new StoreError("list-not-found", "list not found");
    }
    return list;
  }

  #findTodo(id: string): Todo {
    const todo = this.#todos.find((candidate) => candidate.id === id);
    if (!todo) {
      throw new StoreError("todo-not-found", "todo not found");
    }
    return todo;
  }

  /** `exceptId` lets a list keep its own name, in a different case if it likes. */
  #assertNameAvailable(name: string, exceptId?: string): void {
    const taken = this.#lists.some((list) => list.id !== exceptId && sameListName(list.name, name));
    if (taken) {
      throw new StoreError("duplicate-list-name", `a list named "${name}" already exists`);
    }
  }

  #save(): Promise<void> {
    const data: DataFile = { version: DATA_VERSION, lists: this.#lists, todos: this.#todos };
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const write = this.#lastWrite.then(() => writeAtomically(this.#file, text));
    // A failed write must not block the writes after it.
    this.#lastWrite = write.catch(() => {});
    return write;
  }
}

/** Writes to a temporary file first, so a crash never leaves half a file behind. */
async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}

type ParsedDataFile =
  | { version: 1; todos: Array<Omit<Todo, "listId">> }
  | { version: 2; lists: TodoList[]; todos: Todo[] };

/** Reads a data file of the current version or of version 1, which had no lists. */
function parseDataFile(text: string, file: string): ParsedDataFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (!isPlainObject(data) || !Array.isArray(data.todos)) {
    throw new Error(`${file} is not a todos file`);
  }
  if (data.version === 1) {
    for (const todo of data.todos) {
      if (!isTodoFields(todo)) {
        throw new Error(`${file} contains an invalid todo: ${JSON.stringify(todo)}`);
      }
    }
    return { version: 1, todos: data.todos };
  }
  if (data.version !== DATA_VERSION) {
    throw new Error(`${file} has unsupported version ${JSON.stringify(data.version)}`);
  }
  if (!Array.isArray(data.lists) || data.lists.length === 0) {
    throw new Error(`${file} has no lists`);
  }
  for (const list of data.lists) {
    if (!isTodoList(list)) {
      throw new Error(`${file} contains an invalid list: ${JSON.stringify(list)}`);
    }
  }
  const listIds = new Set(data.lists.map((list) => list.id));
  for (const todo of data.todos) {
    if (!isTodoFields(todo) || typeof todo.listId !== "string" || !listIds.has(todo.listId)) {
      throw new Error(`${file} contains an invalid todo: ${JSON.stringify(todo)}`);
    }
  }
  return { version: 2, lists: data.lists, todos: data.todos };
}

function isTodoList(value: unknown): value is TodoList {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string"
  );
}

/** The fields every version's todos have. */
function isTodoFields(value: unknown): value is Omit<Todo, "listId"> & Record<string, unknown> {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.completed === "boolean" &&
    typeof value.createdAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
