import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import { runService } from "../runtime/run-service.js";

export const runRoutes = new Hono();

runRoutes.get("/conversations/:id", async (c) => {
  const runs = await runService.listForConversation(c.req.param("id"));
  return c.json({ runs });
});

runRoutes.get("/:id", async (c) => {
  const run = await runService.find(c.req.param("id"));
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json({ run });
});

const decisionSchema = z.object({
  action: z.enum(["approve", "approve_always", "reject"]),
  decisionBy: z.string().trim().max(80).optional(),
});

runRoutes.post("/:id/approvals/:approvalId", async (c) => {
  const input = decisionSchema.parse(await c.req.json());
  const approval = await prisma.toolApproval.findFirst({
    where: {
      id: c.req.param("approvalId"),
      runId: c.req.param("id"),
      status: "pending",
    },
  });
  if (!approval) return c.json({ error: "Pending approval not found" }, 404);

  await prisma.toolApproval.update({
    where: { id: approval.id },
    data: {
      status: input.action === "reject" ? "rejected" : "approved",
      decisionBy: input.decisionBy ?? "user",
      decidedAt: new Date(),
    },
  });
  if (input.action === "approve_always") {
    await runService.allowAlways(c.req.param("id"), approval.toolName);
  }
  return c.json({ ok: true });
});

runRoutes.post("/conversations/:id/abort", async (c) => {
  const [latest] = await runService.listForConversation(c.req.param("id"));
  if (!latest || latest.status !== "running" && latest.status !== "waiting_approval") {
    return c.json({ ok: false, reason: "No active run" });
  }
  runService.abort(latest.id);
  return c.json({ ok: true, runId: latest.id });
});

/** askUser 工具的答案回传：answers 与 questions 一一对应，null 表示该题被跳过
 * （整卡“放弃”就是把所有位置都置 null 提交，不需要单独的路由）。 */
const askAnswerSchema = z.object({
  answers: z
    .array(z.union([z.null(), z.array(z.string().min(1)).min(1)]))
    .min(1),
});

runRoutes.post("/:id/asks/:askId", async (c) => {
  const input = askAnswerSchema.parse(await c.req.json());
  const ask = await prisma.askUserPrompt.findFirst({
    where: {
      id: c.req.param("askId"),
      runId: c.req.param("id"),
      status: "pending",
    },
  });
  if (!ask) return c.json({ error: "Pending ask not found" }, 404);

  let questionCount = 0;
  try {
    const questions: unknown = JSON.parse(ask.questions);
    if (Array.isArray(questions)) questionCount = questions.length;
  } catch {
    // Fall through; the count check below rejects the mismatched payload.
  }
  if (questionCount === 0 || input.answers.length !== questionCount) {
    return c.json({ error: "Answer count does not match questions" }, 400);
  }

  await prisma.askUserPrompt.update({
    where: { id: ask.id },
    data: { status: "answered", answers: JSON.stringify(input.answers) },
  });
  return c.json({ ok: true });
});
