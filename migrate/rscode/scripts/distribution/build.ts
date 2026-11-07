import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..", "..");
const outputRoot = join(repositoryRoot, "out", "native");
const pkg = await Bun.file(join(repositoryRoot, "package.json")).json();
const platform = process.platform;
const arch = process.arch;
if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) {
  throw new Error(`Unsupported native distribution target: ${platform}-${arch}`);
}
const sourceSha = process.env.RSCODE_SOURCE_SHA || process.env.GITHUB_SHA || await gitHead();
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("Cannot establish 40-character source SHA");
const name = `RSCode-v${pkg.version}-${platform}-${arch}`;
const stage = join(outputRoot, name);
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!browsersPath) throw new Error("Set PLAYWRIGHT_BROWSERS_PATH and install Chromium before packaging");
await stat(join(repositoryRoot, "dist", "web", "index.html"));
await stat(join(repositoryRoot, "node_modules", "playwright-chromium"));
const browserFiles = await readdir(browsersPath);
if (!browserFiles.some((entry) => entry.startsWith("chromium-"))) {
  throw new Error("Provisioned Chromium binary not found under PLAYWRIGHT_BROWSERS_PATH");
}
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "bin"), { recursive: true });
await mkdir(join(stage, "dist"), { recursive: true });
for (const path of ["package.json", "bun.lock", "tsconfig.json"]) {
  await cp(join(repositoryRoot, path), join(stage, path));
}
for (const path of ["src", "node_modules"]) {
  await cp(join(repositoryRoot, path), join(stage, path), { recursive: true });
}
// Bun's node_modules/.bin may contain absolute symlinks back into the checkout.
// These command shims are not needed by the installed runtime and would make
// Linux tar extraction unsafe and the payload non-portable.
await rm(join(stage, "node_modules", ".bin"), { recursive: true, force: true });
await cp(join(repositoryRoot, "dist", "web"), join(stage, "dist", "web"), { recursive: true });
await cp(browsersPath, join(stage, "browsers"), { recursive: true });
await cp(process.execPath, join(stage, "bin", platform === "win32" ? "bun.exe" : "bun"));
await rejectNonPortableSymlinks(stage);
for (const filename of ["launch.ts", "browser-probe.ts", "terminal-probe.ts"]) {
  await cp(join(import.meta.dir, filename), join(stage, "bin", filename));
}
if (platform === "win32") {
  await writeFile(join(stage, "canvas.cmd"),
    '@echo off\r\nsetlocal\r\n"%~dp0bin\\bun.exe" "%~dp0bin\\launch.ts" %*\r\nexit /b %ERRORLEVEL%\r\n');
} else {
  await writeFile(join(stage, "canvas"),
    '#!/bin/sh\nset -eu\nroot="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$root/bin/bun" "$root/bin/launch.ts" "$@"\n');
  await chmod(join(stage, "canvas"), 0o755);
  await chmod(join(stage, "bin", "bun"), 0o755);
}
const provenance = {
  name,
  version: pkg.version,
  platform,
  arch,
  sourceSha,
  bunVersion: Bun.version,
  chromiumRoots: browserFiles.filter((entry) => entry.startsWith("chromium-")).sort(),
  distribution: "portable-native-bun-and-playwright",
  browserProvisioning: "bundled-playwright-chromium",
  signing: "unsigned",
};
await writeFile(join(stage, "distribution.json"), `${JSON.stringify(provenance, null, 2)}\n`);
const inspected = await readFile(join(stage, "src", "server", "server.ts"), "utf8");
if (!inspected.includes('dist", "web')) throw new Error("Runtime asset layout assumption changed");
console.log(JSON.stringify({ stage, provenance, browserFileCount: browserFiles.length }, null, 2));

async function gitHead(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: repositoryRoot, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error("Unable to identify Git HEAD");
  return output.trim();
}

async function rejectNonPortableSymlinks(dir: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = resolve(dir, await readlink(path));
      if (!target.startsWith(stage + sep) && target !== stage) {
        throw new Error(`Non-portable distribution symlink outside stage: ${path} -> ${target}`);
      }
    } else if (info.isDirectory()) {
      await rejectNonPortableSymlinks(path);
    }
  }
}
