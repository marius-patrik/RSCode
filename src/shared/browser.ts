export const STORED_BLANK_BROWSER_URL = "about:blank";
export const INTERNAL_BLANK_BROWSER_URL =
  "data:text/html,<title>Blank</title><body style='background:%23111111;color:white'></body>";

export function browserRuntimeUrl(url: string): string {
  const stored = browserStoredUrl(url);
  if (stored === STORED_BLANK_BROWSER_URL) return INTERNAL_BLANK_BROWSER_URL;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(stored)) return stored;
  return `https://${stored}`;
}

export function browserStoredUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed === STORED_BLANK_BROWSER_URL || isInternalBlankBrowserUrl(trimmed)) {
    return STORED_BLANK_BROWSER_URL;
  }
  return trimmed;
}

function isInternalBlankBrowserUrl(url: string): boolean {
  if (url === INTERNAL_BLANK_BROWSER_URL) return true;
  if (!url.startsWith("data:text/html")) return false;
  const decoded = safeDecode(url);
  return decoded.includes("<title>Blank</title>") && decoded.includes("background:#111111");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
