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
| `TODOS_DATA_FILE` | `data/todos.json` | Where todos are stored; created on the first change |

## Features

- Add a todo; titles are trimmed, must not be empty, and are at most 200 characters.
- Mark a todo complete or active, or mark all of them at once.
- Edit a title with the Edit button or by double-clicking it. Enter or leaving
  the field saves, Escape cancels, and saving an empty title deletes the todo.
- Delete a todo, or clear all completed todos.
- Filter the list by All, Active or Completed. The filter is part of the URL (`#/active`).
- The footer counts the todos left to do.

## API

JSON in, JSON out. Errors answer `{ "error": "<message>" }` with a 4xx status.

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/todos` | | `200` all todos, oldest first |
| `POST /api/todos` | `{ "title": string }` | `201` the new todo |
| `PATCH /api/todos/:id` | `{ "title"?: string, "completed"?: boolean }` | `200` the changed todo |
| `DELETE /api/todos/:id` | | `204` |
| `PATCH /api/todos` | `{ "completed": boolean }` | `200` all todos |
| `DELETE /api/todos?completed=true` | | `200` `{ "removed": number }` |

A todo is `{ "id": string, "title": string, "completed": boolean, "createdAt": string }`,
with `createdAt` as an ISO 8601 timestamp. Unknown fields in a request body are rejected.

## Layout

```text
public/            index.html, styles.css, favicon.svg
src/shared/        the todo model and its validation, used by the server and the browser
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
