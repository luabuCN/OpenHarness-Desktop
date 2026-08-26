import { Hono } from "hono";
import { config } from "../env.js";
import { prisma } from "../db.js";
import { agentCapabilities } from "../conversations/conversation-service.js";
import { resolveModelConfig } from "../providers/provider-service.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  await prisma.$queryRaw`select 1`;
  const resolved = await resolveModelConfig();
  return c.json({
    status: "ok",
    model: resolved.model,
    modelSource: resolved.source,
    workspace: true,
    bash: config.enableBash,
    capabilities: agentCapabilities,
  });
});
