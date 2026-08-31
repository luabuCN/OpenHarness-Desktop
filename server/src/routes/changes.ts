import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";

export const changeRoutes = new Hono();

interface ChangeSummaryRow {
  id: string;
  conversationId: string;
  projectId: string | null;
  path: string;
  changeKind: string;
  unifiedDiff: string | null;
  additions: number;
  deletions: number;
  createdAt: Date;
}

interface FileChangeRow extends ChangeSummaryRow {
  before: string | null;
}

function serializeChange(row: ChangeSummaryRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    projectId: row.projectId,
    path: row.path,
    changeKind: row.changeKind,
    unifiedDiff: row.unifiedDiff,
    additions: row.additions,
    deletions: row.deletions,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Latest edit per path across the project (or one conversation), newest first.
 * The changes panel renders this as "what is currently different". */
changeRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const conversationId = c.req.query("conversationId");
  if (!projectId && !conversationId) {
    return c.json({ error: "projectId 或 conversationId 至少提供一个" }, 400);
  }

  const rows = await prisma.fileChange.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 1_000,
    select: {
      id: true,
      conversationId: true,
      projectId: true,
      path: true,
      changeKind: true,
      unifiedDiff: true,
      additions: true,
      deletions: true,
      createdAt: true,
    },
  });

  const latestByPath = new Map<string, ChangeSummaryRow>();
  for (const row of rows) {
    if (!latestByPath.has(row.path)) latestByPath.set(row.path, row);
  }
  const changes = [...latestByPath.values()].map(serializeChange);

  return c.json({
    changes,
    totals: {
      files: changes.length,
      additions: changes.reduce((sum, change) => sum + change.additions, 0),
      deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
    },
  });
});

async function projectRootFor(row: { projectId: string | null }): Promise<string> {
  if (!row.projectId) throw new Error("该变更没有关联项目，无法撤销");
  const project = await prisma.project.findUnique({ where: { id: row.projectId } });
  if (!project?.isActive) throw new Error("项目不存在或已停用");
  return path.resolve(project.rootPath);
}

/** Restore one path to its pre-conversation state (the earliest row's before
 * snapshot); rows for that path are dropped afterwards. */
async function revertPath(rows: FileChangeRow[]): Promise<{ path: string; action: string }> {
  const earliest = rows[0];
  const root = await projectRootFor(earliest);
  const absolute = path.resolve(root, earliest.path);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`访问被拒绝：${earliest.path}`);
  }

  if (earliest.changeKind === "create" && earliest.before === null) {
    await fs.rm(absolute, { force: true });
  } else if (earliest.before !== null) {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, earliest.before, "utf8");
  } else {
    throw new Error(`无法撤销 ${earliest.path}：缺少原始内容快照`);
  }

  await prisma.fileChange.deleteMany({
    where: { conversationId: earliest.conversationId, path: earliest.path },
  });
  return { path: earliest.path, action: earliest.changeKind === "create" ? "deleted" : "restored" };
}

const revertSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

changeRoutes.post("/revert", async (c) => {
  const input = revertSchema.parse(await c.req.json());
  const rows = await prisma.fileChange.findMany({ where: { id: { in: input.ids } } });
  if (rows.length === 0) return c.json({ error: "未找到对应的变更记录" }, 404);

  const results: Array<{ path: string; action: string }> = [];
  const failures: Array<{ path: string; error: string }> = [];
  for (const row of rows) {
    try {
      // Revert needs every recorded edit of that path so the row set is complete.
      const history = await prisma.fileChange.findMany({
        where: { conversationId: row.conversationId, path: row.path },
        orderBy: { createdAt: "asc" },
      });
      results.push(await revertPath(history));
    } catch (error) {
      failures.push({ path: row.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return c.json({ results, failures });
});

const revertConversationSchema = z.object({ conversationId: z.string().min(1) });

changeRoutes.post("/revert-conversation", async (c) => {
  const { conversationId } = revertConversationSchema.parse(await c.req.json());
  const rows = await prisma.fileChange.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return c.json({ results: [], failures: [] });

  const paths = [...new Set(rows.map((row) => row.path))];
  const results: Array<{ path: string; action: string }> = [];
  const failures: Array<{ path: string; error: string }> = [];
  for (const path of paths) {
    try {
      results.push(await revertPath(rows.filter((row) => row.path === path)));
    } catch (error) {
      failures.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return c.json({ results, failures });
});
