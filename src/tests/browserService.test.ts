import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserFrameService } from "@/server/browserService";
import type { BrowserSession } from "@/shared/schema";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

test(
  "browser frame service renders a Chromium frame",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const html = "<title>Canvas Browser Smoke</title><body style='background:#000;color:#fff'>rendered</body>";
    const session: BrowserSession = {
      workspaceId: "workspace:test",
      paneId: "browser:test",
      url: `data:text/html,${encodeURIComponent(html)}`,
      title: "Browser",
      canGoBack: false,
      canGoForward: false,
      profilePath: join(tempRoot, "profile"),
    };

    try {
      const frame = await service.frameFor(session);
      expect(frame.renderer).toBe("chromium");
      expect(frame.mimeType).toBe("image/png");
      expect(frame.image.startsWith("data:image/png;base64,")).toBe(true);
    } finally {
      await service.close();
    }
  },
  20_000,
);
