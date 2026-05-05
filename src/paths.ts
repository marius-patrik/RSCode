import { resolve } from "node:path";

export function getCanvasHome(): string {
  const env = process.env.CANVAS_HOME;
  if (env) return resolve(env);
  const home = process.env.HOME ?? process.cwd();
  return resolve(home, ".canvas-dev-space");
}

export function getServicePort(): number {
  const env = process.env.CANVAS_PORT ?? "4567";
  const port = Number(env);
  return Number.isFinite(port) && port > 0 ? port : 4567;
}

export function getServiceUrl(): string {
  const env = process.env.CANVAS_URL;
  return env?.replace(/\/$/, "") ?? `http://127.0.0.1:${getServicePort()}`;
}

export function getPaths() {
  const root = getCanvasHome();
  const runtimeDir = resolve(root, "runtime");
  const logsDir = resolve(root, "logs");
  const sessionsDir = resolve(root, "sessions");
  const workspacesDir = resolve(root, "workspaces");
  const browserProfilesDir = resolve(root, "browser-profiles");
  return {
    root,
    runtimeDir,
    logsDir,
    sessionsDir,
    sessionsIndexFile: resolve(sessionsDir, "index.json"),
    workspacesDir,
    workspacesIndexFile: resolve(workspacesDir, "index.json"),
    browserProfilesDir,
    runtimeFile: resolve(runtimeDir, "service.json"),
    serviceLogFile: resolve(logsDir, "service.log"),
  };
}
