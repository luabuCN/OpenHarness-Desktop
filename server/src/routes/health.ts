import { Hono } from "hono";
import { config } from "../env.js";
import { prisma } from "../db.js";
import { agentRuntime } from "../runtime/agent-runtime.js";
import { resolveModelConfig } from "../providers/provider-service.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  await prisma.$queryRaw`select 1`;
  let model: string | undefined;
  let modelSource = "none";
  try {
    const resolved = await resolveModelConfig();
    model = resolved.model;
    modelSource = resolved.source;
  } catch {
    // No provider configured yet; the web UI shows the settings page instead.
  }
  return c.json({
    status: "ok",
    model,
    modelSource,
    workspace: true,
    bash: config.enableBash,
  capabilities: agentRuntime.describe(),
  });
});
