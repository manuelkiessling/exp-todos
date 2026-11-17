import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isPlainObject, type Todo, type TodoChanges } from "../shared/todo.ts";

/** Version of the data file's format. Bump it when the shape changes. */
export const DATA_VERSION = 1;

interface DataFile {
  version: number;
  todos: Todo[];
}

export interface StoreOptions {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Keeps all todos in memory, in creation order, and writes the whole list to
 * one JSON file after every change. A change resolves once it is on disk.
 */
export class TodoStore {
  readonly #file: string;
  readonly #now: () => Date;
  readonly #newId: () => string;
  #todos: Todo[];
  // Writes run one at a time, in the order the changes happened.
  #lastWrite: Promise<void> = Promise.resolve();

  private constructor(file: string, todos: Todo[], options: StoreOptions) {
    this.#file = file;
    this.#todos = todos;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  /**
   * Opens the store backed by `file`. A missing file is an empty list; a file
   * that cannot be read as todos is an error, so it is never overwritten.
   */
  static async open(file: string, options: StoreOptions = {}): Promise<TodoStore> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return new TodoStore(file, [], options);
      }
      throw error;
    }
    return new TodoStore(file, parseDataFile(text, file), options);
  }

  list(): Todo[] {
    return this.#todos.map((todo) => ({ ...todo }));
  }

  get(id: string): Todo | undefined {
    const todo = this.#todos.find((candidate) => candidate.id === id);
    return todo && { ...todo };
  }

  async create(title: string): Promise<Todo> {
    const todo: Todo = {
      id: this.#newId(),
      title,
      completed: false,
      createdAt: this.#now().toISOString(),
    };
    this.#todos.push(todo);
    await this.#save();
    return { ...todo };
  }

  /** Applies `changes` to one todo; undefined when there is no such todo. */
  async update(id: string, changes: TodoChanges): Promise<Todo | undefined> {
    const todo = this.#todos.find((candidate) => candidate.id === id);
    if (!todo) {
      return undefined;
    }
    Object.assign(todo, changes);
    await this.#save();
    return { ...todo };
  }

  /** Marks every todo completed or active, and returns the whole list. */
  async setAllCompleted(completed: boolean): Promise<Todo[]> {
    for (const todo of this.#todos) {
      todo.completed = completed;
    }
    await this.#save();
    return this.list();
  }

  /** Deletes one todo; false when there is no such todo. */
  async remove(id: string): Promise<boolean> {
    const index = this.#todos.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return false;
    }
    this.#todos.splice(index, 1);
    await this.#save();
    return true;
  }

  /** Deletes every completed todo and returns how many were deleted. */
  async removeCompleted(): Promise<number> {
    const before = this.#todos.length;
    this.#todos = this.#todos.filter((todo) => !todo.completed);
    const removed = before - this.#todos.length;
    if (removed > 0) {
      await this.#save();
    }
    return removed;
  }

  #save(): Promise<void> {
    const data: DataFile = { version: DATA_VERSION, todos: this.#todos };
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

function parseDataFile(text: string, file: string): Todo[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (!isPlainObject(data) || data.version !== DATA_VERSION || !Array.isArray(data.todos)) {
    throw new Error(`${file} is not a version ${DATA_VERSION} todos file`);
  }
  for (const todo of data.todos) {
    if (!isTodo(todo)) {
      throw new Error(`${file} contains an invalid todo: ${JSON.stringify(todo)}`);
    }
  }
  return data.todos;
}

function isTodo(value: unknown): value is Todo {
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
