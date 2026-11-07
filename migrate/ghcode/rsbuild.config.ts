import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginTailwindcss } from "@rsbuild/plugin-tailwindcss";

const { publicVars } = loadEnv();
const standalone = process.env.GHCODE_STANDALONE === "1";

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  source: {
    define: publicVars,
    entry: {
      index: "./src/main.tsx",
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  html: {
    inject: "body",
    template: "./index.html",
  },
  output: {
    ...(standalone
      ? { inlineScripts: true, inlineStyles: true, dataUriLimit: Number.MAX_SAFE_INTEGER }
      : {}),
    assetPrefix: "./",
    distPath: {
      root: "dist",
    },
    cleanDistPath: true,
  },
  ...(standalone
    ? {
        tools: {
          rspack: {
            module: { parser: { javascript: { dynamicImportMode: "eager" as const } } },
            optimization: { runtimeChunk: false },
          },
        },
      }
    : {}),
  server: {
    host: "0.0.0.0",
  },
});
