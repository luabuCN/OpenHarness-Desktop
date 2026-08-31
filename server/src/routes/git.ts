import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  clampDiff,
  commitPaths,
  confineGitPath,
  createGitClient,
  readLog,
  summarizeStatus,
} from "../runtime/git-utils.js";

export const gitRoutes = new Hono();

/** Git panel endpoints operate on registered projects only; the root comes
 * from the database, never from the request. */
async function projectRoot(projectId: string | undefined): Promise<string> {
  if (!projectId) throw new Error("缺少 projectId");
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project?.isActive) throw new Error("项目不存在或已停用");
  return path.resolve(project.rootPath);
}

gitRoutes.get("/status", async (c) => {
  try {
    const root = await projectRoot(c.req.query("projectId"));
    const status = await summarizeStatus(createGitClient(root), root);
    return c.json(status);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git status 失败" }, 400);
  }
});

gitRoutes.get("/diff", async (c) => {
  try {
    const root = await projectRoot(c.req.query("projectId"));
    const target = c.req.query("path");
    const staged = c.req.query("staged") === "true";
    const git = createGitClient(root);
    const args: string[] = [];
    if (staged) args.push("--cached");
    if (target) args.push(confineGitPath(root, target));
    const raw = await git.diff(args);
    const result = clampDiff(raw);
    return c.json({ path: target ?? null, ...result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git diff 失败" }, 400);
  }
});

gitRoutes.get("/log", async (c) => {
  try {
    const root = await projectRoot(c.req.query("projectId"));
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 10), 1), 50);
    const commits = await readLog(createGitClient(root), limit);
    return c.json({ commits });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git log 失败" }, 400);
  }
});

const commitSchema = z.object({
  projectId: z.string().min(1),
  files: z.array(z.string().min(1)).min(1).max(200),
  message: z.string().trim().min(1).max(500),
});

gitRoutes.post("/commit", async (c) => {
  try {
    const input = commitSchema.parse(await c.req.json());
    const root = await projectRoot(input.projectId);
    const git = createGitClient(root);
    const result = await commitPaths(git, root, input.files, input.message);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git commit 失败" }, 400);
  }
});

const projectIdSchema = z.object({ projectId: z.string().min(1) });

gitRoutes.post("/pull", async (c) => {
  try {
    const { projectId } = projectIdSchema.parse(await c.req.json());
    const root = await projectRoot(projectId);
    const git = createGitClient(root);
    const result = await git.pull({ "--ff-only": null });
    return c.json({
      files: result.files,
      insertions: result.summary.insertions,
      deletions: result.summary.deletions,
    });
  } catch (error) {
    return c.json(
      {
        error:
          (error instanceof Error ? error.message : "git pull 失败") +
          "（仅允许 fast-forward；若分支已分叉请手动处理）",
      },
      400,
    );
  }
});

gitRoutes.post("/push", async (c) => {
  try {
    const { projectId } = projectIdSchema.parse(await c.req.json());
    const root = await projectRoot(projectId);
    const git = createGitClient(root);
    const branch = (await git.branchLocal()).current;
    const upstream = await git.revparse(["--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null);
    const result = upstream ? await git.push() : await git.push("origin", branch, { "--set-upstream": null });
    return c.json({ pushed: result.pushed, branch });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git push 失败" }, 400);
  }
});
