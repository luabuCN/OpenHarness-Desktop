import { Hono } from "hono";
import { z } from "zod";
import { agentConfigService, type AgentConfigInput } from "../runtime/agents.js";
import { toolRecordService } from "../runtime/tools/index.js";

export const agentRoutes = new Hono();

const subAgentSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
});

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(50_000),
  subAgents: z.array(subAgentSchema).max(10).optional(),
  defaultProviderId: z.string().trim().min(1).nullable().optional(),
  defaultModelId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

// Legacy alias of GET /api/tools kept for the settings page; the catalog now
// comes from the provider registry merged with ToolRecord switch state.
agentRoutes.get("/tools", async (c) => c.json({ tools: await toolRecordService.listCatalog() }));

agentRoutes.get("/", async (c) => {
  return c.json({ agents: await agentConfigService.list() });
});

agentRoutes.post("/", async (c) => {
  const input = createAgentSchema.parse(await c.req.json());
  return c.json({ agent: await agentConfigService.create(input as AgentConfigInput) }, 201);
});

agentRoutes.get("/:id", async (c) => {
  try {
    return c.json({ agent: await agentConfigService.get(c.req.param("id")) });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "Agent not found" }, 404);
  }
});

agentRoutes.put("/:id", async (c) => {
  const input = updateAgentSchema.parse(await c.req.json());
  try {
    return c.json({ agent: await agentConfigService.update(c.req.param("id"), input as AgentConfigInput) });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "Update failed" }, 400);
  }
});

agentRoutes.delete("/:id", async (c) => {
  try {
    await agentConfigService.remove(c.req.param("id"));
    return c.json({ ok: true });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "Delete failed" }, 400);
  }
});
