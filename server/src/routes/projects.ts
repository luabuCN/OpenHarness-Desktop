import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rootPath: z.string().trim().min(1),
  description: z.string().trim().max(500).optional(),
  defaultAgentId: z.string().trim().min(1).max(100).optional(),
  defaultModelId: z.string().trim().min(1).max(200).optional(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  isActive: z.boolean().optional(),
});

async function assertRootDirectory(value: string): Promise<string> {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved)) throw new Error("项目路径必须是绝对路径");
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("项目路径不存在或不是目录");
  return resolved;
}

function serializeProject(project: Awaited<ReturnType<typeof prisma.project.findFirstOrThrow>>) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export const projectRoutes = new Hono();

projectRoutes.get("/", async (c) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { conversations: true } } },
  });
  return c.json({
    projects: projects.map((project) => ({
      ...serializeProject(project),
      conversationCount: project._count.conversations,
    })),
  });
});

projectRoutes.post("/", async (c) => {
  const input = createProjectSchema.parse(await c.req.json());
  let rootPath: string;
  try {
    rootPath = await assertRootDirectory(input.rootPath);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid project path" }, 400);
  }

  const project = await prisma.project.create({ data: { ...input, rootPath } });
  return c.json({ project: serializeProject(project) }, 201);
});

projectRoutes.put("/:id", async (c) => {
  const input = updateProjectSchema.parse(await c.req.json());
  let nextRootPath: string | undefined;
  if (input.rootPath !== undefined) {
    try {
      nextRootPath = await assertRootDirectory(input.rootPath);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid project path" }, 400);
    }
  }

  const { rootPath: requestedRootPath, ...data } = input;
  void requestedRootPath;
  const project = await prisma.project.update({
    where: { id: c.req.param("id") },
    data: {
      ...data,
      ...(nextRootPath ? { rootPath: nextRootPath } : {}),
    },
  });
  return c.json({ project: serializeProject(project) });
});

projectRoutes.delete("/:id", async (c) => {
  await prisma.project.delete({ where: { id: c.req.param("id") } });
  return c.json({ ok: true });
});
