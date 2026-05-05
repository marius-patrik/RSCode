import { canvasGraphSchema, canvasSessionSchema } from "@/schema.ts";
import {
  type CanvasStore,
  createFsFile,
  deleteFsEntry,
  listFsTree,
  mkdirFs,
  readFsFile,
  writeFsFile,
} from "@/store.ts";
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

  session: {
    list: async (ctx: AppContext) => ctx.store.listSessions(),
    active: async (ctx: AppContext) => ({ session: await ctx.store.getActiveSession() }),
    get: schema(z.object({ id: z.string().trim().min(1) }), async (ctx, input) => ({
      session: await ctx.store.getSession(input.id),
    })),
    create: schema(
      z.object({
        label: z.string().trim().min(1).optional(),
        rootPath: z.string().trim().min(1).optional(),
      }),
      async (ctx, input) => ({ session: await ctx.store.createSession(input) }),
    ),
    save: schema(z.object({ session: canvasSessionSchema }), async (ctx, input) => ({
      session: await ctx.store.saveSession(input.session),
    })),
    rename: schema(
      z.object({ id: z.string().trim().min(1), label: z.string().trim().min(1) }),
      async (ctx, input) => ({ session: await ctx.store.renameSession(input.id, input.label) }),
    ),
    setActive: schema(z.object({ id: z.string().trim().min(1) }), async (ctx, input) => ({
      session: await ctx.store.setActiveSession(input.id),
    })),
    close: schema(z.object({ id: z.string().trim().min(1) }), async (ctx, input) =>
      ctx.store.closeSession(input.id),
    ),
  },

  graph: {
    get: async (ctx: AppContext) => ({ graph: await ctx.store.loadGraph() }),
    save: schema(z.object({ graph: canvasGraphSchema }), async (ctx, input) => ({
      graph: await ctx.store.saveGraph(input.graph),
    })),
    validate: schema(z.object({ graph: canvasGraphSchema }), (ctx, input) => ({
      issues: ctx.store.validateGraph(input.graph),
    })),
    execute: schema(
      z.object({
        graph: canvasGraphSchema.optional(),
        nodeId: z.string().nullable().optional(),
      }),
      async (ctx, input) => {
        const graph = input.graph ?? (await ctx.store.loadGraph());
        const result = await ctx.store.executeGraph(graph, input.nodeId ?? null);
        return { result };
      },
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
