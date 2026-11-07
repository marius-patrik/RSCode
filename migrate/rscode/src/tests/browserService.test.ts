import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserFrameMessage, BrowserFrameService, type BrowserStateMessage } from "@/server/browserService";
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
          profilePath: join(tempRoot, "profiles", "workspace-test", "blank-profile"),
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


test(
  "disconnected browser streams release orphan Chromium contexts",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-idle-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined, 50);
    const session = browserSession("<title>Idle cleanup</title>");
    try {
      const handle = await service.stream(session, { send: () => undefined });
      const internals = service as unknown as { liveBrowsers: Map<string, unknown> };
      expect(internals.liveBrowsers.size).toBe(1);
      handle.close();
      await waitFor(() => internals.liveBrowsers.size === 0, "idle Chromium cleanup");
    } finally {
      await service.close();
    }
  },
  20_000,
);

test(
  "failed browser stream initialization detaches its subscriber and releases resources",
  async () => {
    // The cleanup contract is tested with a controlled failure, rather than
    // launching Chromium against a malformed URL (which can hang its driver).
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-failed-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined, 10);
    const session = browserSession("<title>Stream failure</title>");
    let closed = false;
    const live = {
      session,
      subscribers: new Map<number, unknown>(),
      persistSubscriberId: null as number | null,
      pendingDialog: null,
      pendingFileChooser: null,
      idleTimer: null as ReturnType<typeof setTimeout> | null,
      context: { close: async () => { closed = true; } },
    };
    const internals = service as unknown as {
      liveBrowsers: Map<string, Promise<unknown>>;
      startScreencast: (live: unknown) => Promise<void>;
    };
    internals.liveBrowsers.set(session.profilePath, Promise.resolve(live));
    internals.startScreencast = async () => { throw new Error("fixture screencast failure"); };
    try {
      await expect(service.stream(session, { send: () => undefined }))
        .rejects.toThrow("fixture screencast failure");
      expect(live.subscribers.size).toBe(0);
      await waitFor(() => closed && internals.liveBrowsers.size === 0, "failed stream cleanup");
    } finally {
      await service.close();
    }
  },
  10_000,
);

test(
  "browser file chooser rejects malformed bytes and accepts valid host uploads",
  async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-upload-"));
    const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
    const session = browserSession(
      "<title>upload</title><input id='upload' type='file' style='position:absolute;left:20px;top:20px;width:200px;height:40px' onchange='document.title=this.files[0]?.name ?? \"missing\"'>",
    );
    const messages: Array<{ type: string; title?: string }> = [];
    try {
      const handle = await service.stream(session, { send: (message) => { messages.push(message); } });
      try {
        await service.interact(session, { type: "viewport", width: 500, height: 320 });
        await service.interact(session, { type: "mouse", event: "down", x: 60, y: 40, button: "left" });
        await service.interact(session, { type: "mouse", event: "up", x: 60, y: 40, button: "left" });
        await waitFor(() => messages.some((message) => message.type === "fileChooser"), "file picker event");
        await expect(service.interact(session, {
          type: "chooseFiles",
          files: [{ name: "bad.txt", mimeType: "text/plain", data: "%%%%" }],
        })).rejects.toThrow("file chooser rejected");
        await service.interact(session, {
          type: "chooseFiles",
          files: [{ name: "fixture.txt", mimeType: "text/plain", data: Buffer.from("hello").toString("base64") }],
        });
        await waitFor(() => messages.some((message) => message.type === "state" && message.title === "fixture.txt"), "file chooser upload");
      } finally {
        handle.close();
      }
    } finally {
      await service.close();
    }
  },
  20_000,
);

test("concurrent Chromium profile allocation never exceeds the 24-context ceiling", async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "canvas-browser-cap-"));
  const service = new BrowserFrameService(join(tempRoot, "profiles"), () => undefined);
  const internals = service as unknown as {
    liveBrowserFor: (session: BrowserSession) => Promise<unknown>;
    createLiveBrowser: (session: BrowserSession) => Promise<unknown>;
  };
  // Avoid starting 50 Chromium instances; simulate slow context creation and
  // keep each profile subscribed so it is not eligible for idle eviction.
  internals.createLiveBrowser = async () => {
    await Bun.sleep(5);
    return {
      subscribers: new Map([[1, true]]),
      idleTimer: null,
      context: { close: async () => undefined },
    };
  };
  try {
    const requests = Array.from({ length: 50 }, (_, index) => ({
      ...browserSession("<title>Capacity</title>"),
      profilePath: join(tempRoot, "profiles", String(index)),
    }));
    const results = await Promise.allSettled(requests.map((session) => internals.liveBrowserFor(session)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(24);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(26);
    for (const result of results) {
      if (result.status === "rejected") expect(String(result.reason)).toContain("too many active Chromium profiles");
    }
  } finally {
    await service.close();
  }
}, 10_000);


test("concurrent screencast subscribers await exactly one CDP startup", async () => {
  const service = new BrowserFrameService("/tmp/unused-screencast-test", () => undefined);
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
  const service = new BrowserFrameService("/tmp/unused-screencast-test", () => undefined);
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

test("closing browser service during CDP startup rejects pending screencast", async () => {
  const service = new BrowserFrameService("/tmp/unused-screencast-test", () => undefined);
  let abortEnable!: (error: Error) => void;
  const enable = new Promise<void>((_resolve, reject) => { abortEnable = reject; });
  const live = {
    screencastStarted: false,
    screencastStarting: null as Promise<void> | null,
    idleTimer: null,
    context: { close: async () => { abortEnable(new Error("CDP connection closed")); } },
    cdp: {
      send: async (name: string) => { if (name === "Page.enable") await enable; },
      on: () => undefined,
      off: () => undefined,
    },
  };
  const internal = service as unknown as {
    startScreencast: (live: unknown) => Promise<void>;
    liveBrowsers: Map<string, Promise<unknown>>;
  };
  internal.liveBrowsers.set("fixture", Promise.resolve(live));
  const pending = internal.startScreencast(live);
  const result = Promise.allSettled([pending]);
  await service.close();
  const [settlement] = await result;
  expect(settlement.status).toBe("rejected");
  expect(live.screencastStarting).toBeNull();
  expect(live.screencastStarted).toBe(false);
});

function browserSession(html: string): BrowserSession {
  return {
    workspaceId: "workspace:test",
    paneId: "browser:test",
    url: `data:text/html,${encodeURIComponent(html)}`,
    title: "Browser",
    canGoBack: false,
    canGoForward: false,
    profilePath: join(tempRoot, "profiles", "workspace-test", "profile"),
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
      "<title>Dialog fixture</title><script>setTimeout(() => { document.title = confirm('Proceed?') ? 'confirmed' : 'cancelled'; }, 1200);</script>",
    );
    const messages: Array<{ type: string; message?: string }> = [];
    try {
      console.error("DIALOG_TIMER_TRACE before stream");
      const handle = await service.stream(session, { send: (message) => { messages.push(message); } });
      console.error("DIALOG_TIMER_TRACE stream ready");
      try {
        console.error("DIALOG_TIMER_TRACE waiting for dialog");
        await waitFor(() => messages.some((message) => message.type === "dialog"), "browser confirmation dialog");
        console.error("DIALOG_TIMER_TRACE dialog received");
        expect(messages.some((message) => message.message === "Proceed?")).toBe(true);
        await service.interact(session, { type: "dialogResponse", accept: true });
        console.error("DIALOG_TIMER_TRACE accepted");
        const state = await service.stateFor(session);
        console.error("DIALOG_TIMER_TRACE state read");
        expect(state.title).toBe("confirmed");
      } finally {
        console.error("DIALOG_TIMER_TRACE handle closing");
        handle.close();
      }
    } finally {
      console.error("DIALOG_TIMER_TRACE service closing");
      await service.close();
      console.error("DIALOG_TIMER_TRACE service closed");
    }
  },
  20_000,
);
