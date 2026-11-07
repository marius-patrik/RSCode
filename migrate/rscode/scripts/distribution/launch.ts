// Installed entrypoint: use the bundled Bun executable, never the host runtime.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installRoot = resolve(import.meta.dir, "..");
const home = homedir();
if (!process.env.CANVAS_HOME) {
  if (process.platform === "win32") {
    process.env.CANVAS_HOME = join(process.env.APPDATA || join(home, "AppData", "Roaming"), "RSCode");
  } else if (process.platform === "darwin") {
    process.env.CANVAS_HOME = join(home, "Library", "Application Support", "RSCode");
  } else {
    process.env.CANVAS_HOME = join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "rscode");
  }
}
process.env.PLAYWRIGHT_BROWSERS_PATH = join(installRoot, "browsers");
process.chdir(process.env.CANVAS_WORKSPACE_CWD || home);

if (process.argv.includes("--version")) {
  const manifest = await Bun.file(join(installRoot, "distribution.json")).json();
  console.log(`RSCode ${manifest.version} ${manifest.platform}-${manifest.arch}`);
} else {
  await import(pathToFileURL(join(installRoot, "src", "server", "index.ts")).href);
}
