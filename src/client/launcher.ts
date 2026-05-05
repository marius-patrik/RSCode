export function urlForLauncherQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (/^(about|data|file|https?):/i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[^\s/]+\.[^\s]+(?:\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
