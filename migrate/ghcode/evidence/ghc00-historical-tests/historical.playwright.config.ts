import { defineConfig } from "@playwright/test";
import currentConfig from "../../playwright.config";

/** Explicit opt-in frozen v0.1.8 reproduction, expected red: NOT a release gate. */
export default defineConfig({
  ...currentConfig,
  testDir: ".",
  testMatch: "ghc00-v018-reproduction.spec.ts",
  testIgnore: [],
});
