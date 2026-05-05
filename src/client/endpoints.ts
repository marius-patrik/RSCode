export function websocketUrl(baseUrl: string | undefined, path: string): string {
  const origin = typeof window === "undefined" ? "http://127.0.0.1:4567" : window.location.origin;
  const base = baseUrl ? new URL(baseUrl, origin).toString() : origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
