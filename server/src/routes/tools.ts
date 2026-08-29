import { Hono } from "hono";
import { z } from "zod";
import { toolProviderRegistry, toolRecordService } from "../runtime/tools/index.js";

export const toolRoutes = new Hono();

toolRoutes.get("/", async (c) => {
  const [tools, providers] = await Promise.all([
    toolRecordService.listCatalog(),
    Promise.resolve(toolProviderRegistry.list().map(({ id, label }) => ({ id, label }))),
  ]);
  return c.json({ tools, providers });
});

toolRoutes.patch("/:id", async (c) => {
  const input = z.object({ isActive: z.boolean() }).parse(await c.req.json());
  try {
    await toolRecordService.setActive(c.req.param("id"), input.isActive);
    return c.json({ ok: true });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "Update failed" }, 400);
  }
});
