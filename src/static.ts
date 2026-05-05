import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function contentType(path: string) {
  return TYPES[extname(path)] ?? "application/octet-stream";
}

export async function serveWebAsset(distRoot: string, pathname: string) {
  const candidate = pathname === "/" ? "index.html" : pathname.slice(1);
  const normalized = normalize(candidate).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = resolve(distRoot, normalized);

  if (!absolute.startsWith(resolve(distRoot))) {
    return new Response("Not Found", { status: 404 });
  }

  const fallback = join(distRoot, "index.html");
  const filePath = (await exists(absolute)) ? absolute : fallback;

  if (!(await exists(filePath))) {
    return new Response(
      "Web bundle not built yet. Run `bun run build:web` and refresh this page.",
      {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType(filePath) },
  });
}
