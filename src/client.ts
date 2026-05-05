// Native fetch-based client. Replaces the previous tRPC client. Consumer
// API is preserved for source compatibility:
//
//   client.fs.tree.query({ path: "/" })
//   client.graph.execute.mutate({ graph })
//
// `.query()` and `.mutate()` are aliases — both POST to /api/<path>.

type Caller = (input?: unknown) => Promise<unknown>;

function makeBranch(baseUrl: string, path: string[]): unknown {
  const target: Caller = () => Promise.reject(new Error("invalid call site"));
  return new Proxy(target, {
    get(_t, key) {
      if (typeof key !== "string") return undefined;
      if (key === "query" || key === "mutate") {
        return async (input?: unknown) => {
          const res = await fetch(`${baseUrl}/api/${path.join(".")}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input ?? null),
          });
          const text = await res.text();
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            // surface raw text if JSON parsing fails
          }
          if (!res.ok) {
            const err =
              parsed && typeof parsed === "object" && "error" in parsed
                ? String((parsed as { error: unknown }).error)
                : `${res.status} ${res.statusText}`;
            throw new Error(`${path.join(".")}: ${err}`);
          }
          return parsed;
        };
      }
      return makeBranch(baseUrl, [...path, key]);
    },
  });
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.CANVAS_URL ?? "http://127.0.0.1:4567";
}

// Loose typing — the consumer side currently relies on runtime shape rather
// than static types. Tightening with an `Api` type would require a recursive
// transform; deferred until a consumer needs the help.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export function makeBrowserClient(): any {
  return makeBranch(getBaseUrl(), []);
}

// biome-ignore lint/suspicious/noExplicitAny: see comment above
export function makeClient(url = getBaseUrl()): any {
  return makeBranch(url, []);
}
