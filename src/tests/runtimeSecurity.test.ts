import { expect, test } from "bun:test";
import { lookupHandler } from "@/server/api";
import { BrowserFrameService } from "@/server/browserService";
import { isBrowserInteractionMessage, isTrustedLocalRequest } from "@/server/server";
import type { BrowserSession } from "@/shared/schema";

function localRequest(host: string, origin?: string): Request {
  return new Request("http://127.0.0.1:4567/api/fs.delete", {
    headers: { host, ...(origin !== undefined ? { origin } : {}) },
  });
}

test("only canonical IPv4 first-party origins can access the privileged runtime", () => {
  const api = "127.0.0.1:4567";
  const web = "127.0.0.1:7000";
  expect(isTrustedLocalRequest(localRequest(api), 4567)).toBe(true); // local CLI
  expect(isTrustedLocalRequest(localRequest(api, "http://127.0.0.1:4567"), 4567)).toBe(true);
  expect(isTrustedLocalRequest(localRequest(api, "http://127.0.0.1:7000"), 4567, 7000)).toBe(true);
  expect(isTrustedLocalRequest(localRequest(web, "http://127.0.0.1:7000"), 4567, 7000)).toBe(true);
  expect(isTrustedLocalRequest(localRequest(web), 4567, 7000)).toBe(true); // proxy health
  expect(isTrustedLocalRequest(localRequest(api, "http://127.0.0.1:7000"), 4567)).toBe(false);

  // Same numeric port does not make another browser host a first-party origin.
  for (const origin of [
    "http://localhost:4567", "http://[::1]:4567",
    "http://localhost:7000", "http://[::1]:7000",
    "http://127.0.0.1:9999", "https://127.0.0.1:4567",
    "http://127.0.0.1:4567/path", "http://127.0.0.1:4567/",
    "http://127.0.0.1:4567?query", "http://127.0.0.1:4567#fragment",
    "http://user@127.0.0.1:4567", "http://127.0.0.1.attacker.invalid:4567",
    "null", "", "not an origin", "http://127.0.0.1:4567 http://evil.invalid",
  ]) {
    expect(isTrustedLocalRequest(localRequest(api, origin), 4567, 7000)).toBe(false);
  }
  for (const host of [
    "localhost:4567", "[::1]:4567", "attacker.invalid:4567",
    "127.0.0.1.attacker.invalid:4567", "127.0.0.1:9999",
    "127.0.0.1:4567@evil.invalid", "127.0.0.1:04567",
  ]) {
    expect(isTrustedLocalRequest(localRequest(host, "http://127.0.0.1:4567"), 4567, 7000)).toBe(false);
  }
});

test("API lookup never crosses into Object or Function prototypes", () => {
  expect(typeof lookupHandler("workspace.list")).toBe("function");
  for (const path of ["constructor", "toString", "__proto__", "fs.__proto__", "fs.tree.constructor"]) {
    expect(lookupHandler(path)).toBeNull();
  }
});

test("browser interaction payloads reject non-finite coordinates and unbounded text", () => {
  expect(isBrowserInteractionMessage({ type: "viewport", width: 800, height: 600 })).toBe(true);
  expect(isBrowserInteractionMessage({ type: "viewport", width: Number.POSITIVE_INFINITY, height: 600 })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "viewport", width: -1, height: 600 })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "viewport", width: 500, height: 400, deviceScaleFactor: "invalid" })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "viewport", width: 500, height: 400, deviceScaleFactor: 0 })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "viewport", width: 500, height: 400, deviceScaleFactor: 2 })).toBe(true);
  expect(isBrowserInteractionMessage({ type: "mouse", event: "down", x: Number.NaN, y: 3 })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "wheel", x: 0, y: 0, deltaX: Number.POSITIVE_INFINITY, deltaY: 0 })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "paste", text: "x".repeat(65_537) })).toBe(false);
  expect(isBrowserInteractionMessage({ type: "paste", text: "hello" })).toBe(true);
  expect(isBrowserInteractionMessage({ type: "chooseFiles", files: [{ name: "x", mimeType: "text/plain", data: "a".repeat(8_000_001) }] })).toBe(false);
});

test("Chromium refuses persistence outside the designated browser profile root", async () => {
  const root = "/tmp/rscode-test-profiles";
  const session: BrowserSession = {
    workspaceId: "..",
    paneId: "..",
    url: "about:blank",
    title: "Browser",
    canGoBack: false,
    canGoForward: false,
    profilePath: "/tmp/rscode-external-profile",
  };
  const service = new BrowserFrameService(root, () => undefined);
  try {
    await expect(service.stream(session, { send: () => undefined }))
      .rejects.toThrow("browser profile is outside");
  } finally {
    await service.close();
  }
});
