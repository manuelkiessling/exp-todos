import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface StaticOptions {
  /** Directory with index.html, styles and other assets. */
  publicDir: string;
  /** The repository's src directory. The browser loads src/client and src/shared from it. */
  srcDir: string;
}

/**
 * Serves the UI: files from the public directory, and the browser's
 * TypeScript modules with their types stripped, so there is no build step.
 * Returns false when the path names nothing it serves.
 */
export async function serveStatic(
  pathname: string,
  response: ServerResponse,
  options: StaticOptions,
): Promise<boolean> {
  const browserModule = /^\/src\/(client|shared)\/(.+)$/.exec(pathname);
  if (browserModule) {
    const [, dir = "", relative = ""] = browserModule;
    if (extname(relative) !== ".ts") {
      return false;
    }
    // Confined to its own directory: an encoded "../" must not reach src/server.
    const source = await readInside(resolve(options.srcDir, dir), relative);
    if (source === undefined) {
      return false;
    }
    send(response, "text/javascript; charset=utf-8", stripTypeScriptTypes(source.toString("utf8")));
    return true;
  }

  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const type = CONTENT_TYPES[extname(relative)];
  if (!type) {
    return false;
  }
  const content = await readInside(options.publicDir, relative);
  if (content === undefined) {
    return false;
  }
  send(response, type, content);
  return true;
}

/** Reads `relative` inside `root`; undefined when it is missing or outside `root`. */
async function readInside(root: string, relative: string): Promise<Buffer | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return undefined;
  }
  const path = resolve(root, decoded);
  if (!path.startsWith(resolve(root) + sep)) {
    return undefined;
  }
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

function send(response: ServerResponse, type: string, body: string | Buffer): void {
  response.writeHead(200, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    // The app serves the working tree as it is; never let the browser keep an old copy.
    "cache-control": "no-store",
  });
  response.end(body);
}
