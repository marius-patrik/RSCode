const webPort = portFromEnv(["CANVAS_DEV_WEB_PORT", "CANVAS_WEB_PORT", "CANVAS_PORT"], 4567);
const apiPort = portFromEnv(["CANVAS_DEV_API_PORT", "CANVAS_API_PORT"], webPort + 1);
const host = process.env.CANVAS_HOST ?? "127.0.0.1";

const apiEnv = {
  ...process.env,
  CANVAS_PORT: String(apiPort),
  CANVAS_URL: `http://${host}:${apiPort}`,
  CANVAS_DEV_API_PORT: String(apiPort),
  CANVAS_DEV_WEB_PORT: String(webPort),
};

const webEnv = {
  ...process.env,
  CANVAS_DEV_API_PORT: String(apiPort),
  CANVAS_DEV_WEB_PORT: String(webPort),
};

const children = [
  spawn("api", ["bun", "--watch", "src/server/index.ts"], apiEnv),
  spawn("web", ["node_modules/.bin/rsbuild", "dev", "--host", host, "--port", String(webPort)], webEnv),
];

console.log(`canvas dev web: http://${host}:${webPort}`);
console.log(`canvas dev api: http://${host}:${apiPort}`);

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

await Promise.race(
  children.map(async ({ name, proc }) => {
    const code = await proc.exited;
    if (!shuttingDown) {
      console.error(`${name} exited with code ${code}`);
      await shutdown(code || 1);
    }
  }),
);

function spawn(name: string, cmd: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(cmd, {
    env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return { name, proc };
}

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of children) {
    if (!proc.killed) proc.kill("SIGTERM");
  }
  await Promise.all(children.map(({ proc }) => proc.exited.catch(() => 0)));
  process.exit(code);
}

function portFromEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    const port = Number(value);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return fallback;
}

export {};
