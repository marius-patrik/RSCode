import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserFrameMessage, BrowserFrameService, type BrowserStateMessage, retryChromiumNativeCrash } from "@/server/browserService";
import type { BrowserSession } from "@/shared/schema";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

test(
  "browser frame service streams Chromium frames and resizes the viewport",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const session = browserSession(
      "<title>Canvas Browser Smoke</title><body style='background:#000;color:#fff'>rendered</body>",
    );
    const frames: BrowserFrameMessage[] = [];

    try {
      const handle = await service.stream(session, {
        send: (message) => {
          if (message.type === "frame") frames.push(message);
        },
      });
      try {
        await waitFor(() => frames.length > 0, "initial screencast frame");
        expect(frames[0]?.renderer).toBe("chromium");
        expect(frames[0]?.mimeType).toBe("image/png");
        expect(frames[0]?.image.startsWith("data:image/png;base64,")).toBe(true);

        // Repeated small, large and small resizes must always produce truthful
        // frame metadata and complete PNGs, even during compositor transitions.
        for (const { width, height } of [
          { width: 333, height: 222 },
          { width: 500, height: 320 },
          { width: 333, height: 222 },
        ]) {
          frames.length = 0;
          await service.interact(session, { type: "viewport", width, height });
          await waitFor(() => frames.some((frame) => frame.width === width && frame.height === height), "resized frame");
          const resized = frames.find((frame) => frame.width === width && frame.height === height);
          expect(resized).toBeDefined();
          const png = Buffer.from(resized?.image.split(",")[1] ?? "", "base64");
          expect(png.toString("ascii", 1, 4)).toBe("PNG");
          expect(png.readUInt32BE(16)).toBe(width);
          expect(png.readUInt32BE(20)).toBe(height);

          // Screencast frames can arrive while the viewport changes; their
          // reported dimensions must match the encoded image, too.
          for (const frame of frames) {
            const actual = Buffer.from(frame.image.split(",")[1] ?? "", "base64");
            expect(actual.readUInt32BE(16)).toBe(frame.width);
            expect(actual.readUInt32BE(20)).toBe(frame.height);
          }
        }
      } finally {
        handle.close();
      }
    } finally {
      await service.close();
    }
  },
  20_000,
);

test(
  "browser frame service streams native blank pages",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const frames: BrowserFrameMessage[] = [];

    try {
      const handle = await service.stream(
        {
          workspaceId: "workspace:test",
          paneId: "browser:blank",
          url: "about:blank",
          title: "Browser",
          canGoBack: false,
          canGoForward: false,
          profilePath: join(tempRoot, "blank-profile"),
        },
        {
          send: (message) => {
            if (message.type === "frame") frames.push(message);
          },
        },
      );
      try {
        await waitFor(() => frames.some((frame) => frame.url === "about:blank"), "blank screencast frame");
      } finally {
        handle.close();
      }
    } finally {
      await service.close();
    }
  },
  20_000,
);

test(
  "browser stream forwards mouse, text, and in-page navigation events",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const nextUrl = "about:blank#next-page";
    let currentSession = browserSession(`
      <title>ready</title>
      <body>
        <input id="field" style="position:absolute;left:20px;top:20px;width:180px;height:32px"
          oninput="document.title='typed:' + this.value" />
        <button id="go" style="position:absolute;left:20px;top:80px;width:120px;height:32px"
          onclick="location.href='${nextUrl}'">go</button>
      </body>
    `);
    const states: BrowserStateMessage[] = [];
    const navigatedUrls: string[] = [];

    try {
      const handle = await service.stream(currentSession, {
        send: (message) => {
          if (message.type === "state") states.push(message);
        },
        onNavigation: async (url) => {
          navigatedUrls.push(url);
          currentSession = { ...currentSession, url, canGoBack: true };
          return currentSession;
        },
      });
      try {
        await service.interact(currentSession, { type: "viewport", width: 500, height: 320 });
        await service.interact(currentSession, { type: "mouse", event: "down", x: 40, y: 36, button: "left" });
        await service.interact(currentSession, { type: "mouse", event: "up", x: 40, y: 36, button: "left" });
        await service.interact(currentSession, { type: "text", text: "hi" });
        await waitFor(
          () => states.some((state) => state.title === "typed:hi"),
          "text input title update",
        );

        await service.interact(currentSession, { type: "mouse", event: "down", x: 40, y: 96, button: "left" });
        await service.interact(currentSession, { type: "mouse", event: "up", x: 40, y: 96, button: "left" });
        await waitFor(() => navigatedUrls.includes(nextUrl), "in-page navigation callback");
      } finally {
        handle.close();
      }
    } finally {
      await service.close();
    }
  },
  20_000,
);

test("native Chromium SIGSEGV during launch retries once after profile cleanup", async () => {
  let launches = 0;
  let cleanups = 0;
  const value = await retryChromiumNativeCrash(
    async () => {
      launches++;
      if (launches === 1) throw new Error("persistentContext: browser closed [pid][err] Received signal 11 SI_KERNEL");
      return "recovered";
    },
    async () => { cleanups++; },
  );
  expect(value).toBe("recovered");
  expect(launches).toBe(2);
  expect(cleanups).toBe(1);
});

test("Chromium recovery never retries non-crash failures or an endlessly crashing process", async () => {
  let launches = 0;
  let cleanups = 0;
  await expect(retryChromiumNativeCrash(async () => {
    launches++;
    throw new Error("Profile is in use by another Chromium process");
  }, async () => { cleanups++; })).rejects.toThrow("Profile is in use");
  expect(launches).toBe(1);
  expect(cleanups).toBe(0);

  launches = 0;
  await expect(retryChromiumNativeCrash(async () => {
    launches++;
    throw new Error("persistentContext: Received signal 11 SIGSEGV");
  }, async () => { cleanups++; })).rejects.toThrow("Received signal 11");
  expect(launches).toBe(2);
  expect(cleanups).toBe(1);
});

test("concurrent screencast subscribers await exactly one CDP startup", async () => {
  const service = new BrowserFrameService(join(tmpdir(), "unused-screencast-test"), () => undefined);
  let releaseEnable!: () => void;
  const enable = new Promise<void>((resolve) => { releaseEnable = resolve; });
  const calls: string[] = [];
  const subscriptions: string[] = [];
  const live = {
    screencastStarted: false,
    screencastStarting: null as Promise<void> | null,
    cdp: {
      send: async (name: string) => {
        calls.push(name);
        if (name === "Page.enable") await enable;
      },
      on: (name: string) => { subscriptions.push(name); },
      off: (name: string) => { subscriptions.push(`off:${name}`); },
    },
  };
  const internal = service as unknown as { startScreencast: (live: unknown) => Promise<void> };
  const first = internal.startScreencast(live);
  const second = internal.startScreencast(live);
  expect(calls).toEqual(["Page.enable"]);
  expect(live.screencastStarted).toBe(false);
  releaseEnable();
  await Promise.all([first, second]);
  expect(calls).toEqual(["Page.enable", "Page.startScreencast"]);
  expect(subscriptions).toEqual(["Page.screencastFrame"]);
  expect(live.screencastStarted).toBe(true);
  expect(live.screencastStarting).toBeNull();
  await service.close();
});

test("failed CDP start resets the shared promise and permits exactly one retry", async () => {
  const service = new BrowserFrameService(join(tmpdir(), "unused-screencast-test"), () => undefined);
  let attempts = 0;
  let listeners = 0;
  const live = {
    screencastStarted: false,
    screencastStarting: null as Promise<void> | null,
    cdp: {
      send: async (name: string) => {
        if (name === "Page.startScreencast" && ++attempts === 1) throw new Error("CDP startup failed");
      },
      on: () => { listeners++; },
      off: () => { listeners--; },
    },
  };
  const internal = service as unknown as { startScreencast: (live: unknown) => Promise<void> };
  await expect(internal.startScreencast(live)).rejects.toThrow("CDP startup failed");
  expect(live.screencastStarting).toBeNull();
  expect(live.screencastStarted).toBe(false);
  expect(listeners).toBe(0);
  await Promise.all([internal.startScreencast(live), internal.startScreencast(live)]);
  expect(attempts).toBe(2);
  expect(listeners).toBe(1);
  expect(live.screencastStarted).toBe(true);
  await service.close();
});

function browserSession(html: string): BrowserSession {
  return {
    workspaceId: "workspace:test",
    paneId: "browser:test",
    url: `data:text/html,${encodeURIComponent(html)}`,
    title: "Browser",
    canGoBack: false,
    canGoForward: false,
    profilePath: join(tempRoot, "profile"),
  };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 6_000) {
    if (predicate()) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test(
  "browser confirmation dialogs reach subscribers and can be answered",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const session = browserSession(
      '<title>Dialog fixture</title><button style="position:absolute;left:20px;top:20px;width:120px;height:32px" onclick="document.title = confirm(\'Proceed?\') ? \'confirmed\' : \'cancelled\'">Ask</button>',
    );
    const messages: Array<{ type: string; message?: string }> = [];
    try {
      const handle = await service.stream(session, { send: (message) => { messages.push(message); } });
      try {
        // A timer firing during the initial screencast/page setup can block
        // launch itself and deadlock this test before its dialog subscriber is ready.
        // Initiate the dialog only after the subscriber has been established.
        await service.interact(session, { type: "mouse", event: "down", x: 40, y: 36, button: "left" });
        const clicked = service.interact(session, { type: "mouse", event: "up", x: 40, y: 36, button: "left" });
        try {
          await waitFor(() => messages.some((message) => message.type === "dialog"), "browser confirmation dialog");
          expect(messages.some((message) => message.message === "Proceed?")).toBe(true);
          await service.interact(session, { type: "dialogResponse", accept: true });
          await clicked;
          const state = await service.stateFor(session);
          expect(state.title).toBe("confirmed");
        } finally {
          // Ensure a pending dialog never survives into browser process disposal.
          await service.interact(session, { type: "dialogResponse", accept: false }).catch(() => undefined);
          await clicked.catch(() => undefined);
        }
      } finally {
        handle.close();
      }
    } finally {
      await service.close();
    }
  },
  20_000,
);
