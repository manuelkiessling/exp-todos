import type { IncomingMessage, ServerResponse } from "node:http";

/** The largest request body the API accepts. */
export const MAX_BODY_BYTES = 64 * 1024;

/** An error the API reports to the client with its status code. */
export class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const type = request.headers["content-type"] ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, `body must be at most ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

export function sendError(response: ServerResponse, error: HttpError): void {
  for (const [name, value] of Object.entries(error.headers)) {
    response.setHeader(name, value);
  }
  sendJson(response, error.status, { error: error.message });
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

export function methodNotAllowed(allowed: string[]): HttpError {
  return new HttpError(405, "method not allowed", { allow: allowed.join(", ") });
}
