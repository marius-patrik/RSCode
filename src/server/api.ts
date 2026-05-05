import {
  createFsFile,
  deleteFsEntry,
  listFsTree,
  mkdirFs,
  readFsFile,
  writeFsFile,
} from "@/server/store";
import type { CanvasStore } from "@/server/store";
import { workspaceSchema } from "@/shared/schema";
import { z } from "zod";

export type AppContext = { store: CanvasStore };
type Handler = (ctx: AppContext, input: unknown) => unknown | Promise<unknown>;

function schema<T>(
  validator: z.ZodType<T>,
  fn: (ctx: AppContext, input: T) => unknown | Promise<unknown>,
): Handler {
  return (ctx, input) => fn(ctx, validator.parse(input ?? {}));
}

const fsPathSchema = z.string().min(1);
const workspaceIdSchema = z.string().trim().min(1);
const paneIdSchema = z.string().trim().min(1);

export const api = {
  health: () => ({ ok: true, ts: Date.now() }),

  runtime: {
    status: (ctx: AppContext) => ctx.store.getRuntimeStatus(),
    logs: async (ctx: AppContext) => ({ content: await ctx.store.readLogTail() }),
  },

  fs: {
    tree: schema(z.object({ path: fsPathSchema }), async (_ctx, input) => ({
      entries: await listFsTree(input.path),
    })),
    readFile: schema(z.object({ path: fsPathSchema }), async (_ctx, input) => ({
      body: await readFsFile(input.path),
    })),
    writeFile: schema(
      z.object({ path: fsPathSchema, body: z.string() }),
      async (_ctx, input) => {
        await writeFsFile(input.path, input.body);
        return { ok: true };
      },
    ),
    mkdir: schema(z.object({ path: fsPathSchema }), async (_ctx, input) => {
      await mkdirFs(input.path);
      return { ok: true };
    }),
    createFile: schema(
      z.object({
        path: fsPathSchema,
        kind: z.enum(["markdown", "json", "yaml", "typescript", "plain"]),
      }),
      async (_ctx, input) => ({ path: await createFsFile(input.path, input.kind) }),
    ),
    delete: schema(z.object({ path: fsPathSchema }), async (_ctx, input) => {
      await deleteFsEntry(input.path);
      return { ok: true };
    }),
  },

  workspace: {
    list: async (ctx: AppContext) => ctx.store.listWorkspaces(),
    active: async (ctx: AppContext) => ({ workspace: await ctx.store.getActiveWorkspace() }),
    get: schema(z.object({ id: workspaceIdSchema }), async (ctx, input) => ({
      workspace: await ctx.store.getWorkspace(input.id),
    })),
    create: schema(
      z.object({
        label: z.string().trim().min(1).optional(),
        rootPath: z.string().trim().min(1).optional(),
      }),
      async (ctx, input) => ({ workspace: await ctx.store.createWorkspace(input) }),
    ),
    save: schema(z.object({ workspace: workspaceSchema }), async (ctx, input) => ({
      workspace: await ctx.store.saveWorkspace(input.workspace),
    })),
    rename: schema(
      z.object({ id: workspaceIdSchema, label: z.string().trim().min(1) }),
      async (ctx, input) => ({ workspace: await ctx.store.renameWorkspace(input.id, input.label) }),
    ),
    setActive: schema(z.object({ id: workspaceIdSchema }), async (ctx, input) => ({
      workspace: await ctx.store.setActiveWorkspace(input.id),
    })),
    close: schema(z.object({ id: workspaceIdSchema }), async (ctx, input) =>
      ctx.store.closeWorkspace(input.id),
    ),
  },

  git: {
    repositories: schema(
      z.object({ rootPath: fsPathSchema, depth: z.number().int().min(0).max(10).optional() }),
      async (ctx, input) => ({
        repositories: await ctx.store.listGitRepositories(input.rootPath, input.depth),
      }),
    ),
    status: schema(z.object({ repoPath: fsPathSchema }), async (ctx, input) => ({
      status: await ctx.store.getGitStatus(input.repoPath),
    })),
    diff: schema(
      z.object({ repoPath: fsPathSchema, path: z.string().default(".") }),
      async (ctx, input) => ({ diff: await ctx.store.getGitDiff(input.repoPath, input.path) }),
    ),
  },

  browser: {
    session: schema(
      z.object({ workspaceId: workspaceIdSchema, paneId: paneIdSchema }),
      async (ctx, input) => ({ browser: await ctx.store.getBrowserSession(input.workspaceId, input.paneId) }),
    ),
    navigate: schema(
      z.object({
        workspaceId: workspaceIdSchema,
        paneId: paneIdSchema,
        url: z.string().min(1),
        replace: z.boolean().optional(),
      }),
      async (ctx, input) => ctx.store.navigateBrowserPane(input),
    ),
  },
} as const;

export function lookupHandler(path: string): Handler | null {
  let cur: unknown = api;
  for (const part of path.split(".")) {
    if (!part || cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "function" ? (cur as Handler) : null;
}

export type Api = typeof api;
