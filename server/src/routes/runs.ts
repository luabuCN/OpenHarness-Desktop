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
  action: z.enum(["approve", "reject"]),
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
      status: input.action === "approve" ? "approved" : "rejected",
      decisionBy: input.decisionBy ?? "user",
      decidedAt: new Date(),
    },
  });
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
