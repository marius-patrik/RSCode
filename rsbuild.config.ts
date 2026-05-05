import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import tailwindcssPostcss from "@tailwindcss/postcss";

const webPort = portFromEnv(["CANVAS_DEV_WEB_PORT", "CANVAS_WEB_PORT", "CANVAS_PORT"], 4567);
const apiPort = portFromEnv(["CANVAS_DEV_API_PORT", "CANVAS_API_PORT"], webPort + 1);
const host = process.env.CANVAS_HOST ?? "127.0.0.1";
const apiTarget = `http://${host}:${apiPort}`;

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    title: "Canvas Dev Space",
  },
  source: {
    entry: {
      index: "./src/main.tsx",
    },
    tsconfigPath: "./tsconfig.json",
  },
  output: {
    distPath: {
      root: "dist/web",
    },
    cleanDistPath: true,
  },
  server: {
    host,
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        ws: true,
      },
      "/health": {
        target: apiTarget,
      },
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  tools: {
    postcss: (_config, { addPlugins }) => {
      addPlugins(tailwindcssPostcss());
    },
  },
});

function portFromEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    const port = Number(value);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return fallback;
}
