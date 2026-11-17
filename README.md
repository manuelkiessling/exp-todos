# todos

A small todo list web app: a Node.js HTTP server that stores todos in a JSON
file, and a browser UI written in plain TypeScript with no framework.

There are no runtime dependencies and no build step. Node runs the server's
TypeScript directly, and the server strips the types from the browser's
TypeScript modules when it serves them.

## Requirements

Node.js 22.18 or later (`.nvmrc` pins the version this repository is tested with).

## Usage

```sh
npm install        # dev tools only: the TypeScript compiler and Node's type definitions
npm start          # http://127.0.0.1:3000
npm run dev        # the same, restarting when a server file changes
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on |
| `TODOS_DATA_FILE` | `data/todos.json` | Where lists and todos are stored; created when the app starts |

## Features

Todos are kept in lists. There is always at least one list; a fresh install
starts with an empty list named "Todos".

- Create, rename and delete lists. List names are trimmed, must not be empty,
  are at most 50 characters, and are unique regardless of upper and lower case.
  Deleting a list deletes its todos; when it still has todos, the UI asks first.
  The last list cannot be deleted.
- The list overview shows every list, oldest first, with the number of todos left in it.
- Within a list:
  - Add a todo; titles are trimmed, must not be empty, and are at most 200 characters.
  - Mark a todo complete or active, or mark all of the list's todos at once.
  - Edit a title with the Edit button or by double-clicking it. Enter or leaving
    the field saves, Escape cancels, and saving an empty title deletes the todo.
  - Move a todo to another list; it keeps its title and completed state.
  - Delete a todo, or clear the list's completed todos.
  - Filter by All, Active or Completed. The footer counts the todos left to do.
- The URL names the selected list and filter (`#/lists/<id>`, `#/lists/<id>/active`,
  `#/lists/<id>/completed`), so a reload or a bookmark returns to them. A link
  to a list that does not exist shows the first list; the links from before
  there were lists (`#/active`, `#/completed`) open the first list with that filter.

## API

JSON in, JSON out. Errors answer `{ "error": "<message>" }` with a 4xx status.

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/lists` | | `200` all lists, oldest first |
| `POST /api/lists` | `{ "name": string }` | `201` the new list; `409` if the name is taken |
| `PATCH /api/lists/:id` | `{ "name": string }` | `200` the renamed list; `409` if the name is taken |
| `DELETE /api/lists/:id` | | `204`, deleting its todos too; `409` for the last list |
| `POST /api/lists/:id/todos` | `{ "title": string }` | `201` the new todo |
| `PATCH /api/lists/:id/todos` | `{ "completed": boolean }` | `200` the list's todos |
| `DELETE /api/lists/:id/todos?completed=true` | | `200` `{ "removed": number }` |
| `GET /api/todos` | | `200` the todos of all lists, oldest first |
| `PATCH /api/todos/:id` | `{ "title"?: string, "completed"?: boolean, "listId"?: string }` | `200` the changed todo |
| `DELETE /api/todos/:id` | | `204` |

A list is `{ "id": string, "name": string, "createdAt": string }`. A todo is
`{ "id": string, "listId": string, "title": string, "completed": boolean, "createdAt": string }`.
Timestamps are ISO 8601. Unknown fields in a request body are rejected.

## Data file

The data file holds `{ "version": 2, "lists": [...], "todos": [...] }`. When
the app starts on a version 1 file, which had no lists, it moves all todos into
a new list named "Todos" and writes the file as version 2.

## Layout

```text
public/            index.html, styles.css, favicon.svg
src/shared/        the list and todo model and its validation, used by the server and the browser
src/server/        main.ts (entry point), app.ts (routes), store.ts (JSON file store),
                   http.ts (request and response helpers), static.ts (UI files)
src/client/        the browser UI: main.ts (state, rendering, events), api.ts (API calls)
test/              node:test suites
```

## Development

```sh
npm run typecheck  # tsc, for the Node code and the browser code separately
npm test           # node --test
npm run check      # both; run it before every commit
```

Conventions:

- Keep the app free of runtime dependencies. Use what Node and the browser provide.
- Write TypeScript that Node can run by stripping types: no `enum`, no
  `namespace`, no constructor parameter properties (`erasableSyntaxOnly`).
  Import local modules with their `.ts` extension.
- Validate input in `src/shared/` so the server and the browser apply the same
  rules. The server is the authority; the browser only checks early.
- The store owns the data file's format. A change to its shape bumps
  `DATA_VERSION` in `src/server/store.ts` and reads files of the previous version.
- Build the UI with DOM APIs and `textContent`, never `innerHTML`. Give every
  control an accessible name.
- Cover behavior with tests in `test/`: the store with a temporary data file,
  the API through a real server on a random port.
