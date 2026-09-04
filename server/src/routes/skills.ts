import { Hono } from "hono";
import { z } from "zod";
import { skillService } from "../runtime/skills.js";

export const skillRoutes = new Hono();

skillRoutes.get("/", async (c) => {
  const { skills, sources } = await skillService.list();
  return c.json({ skills, sources });
});

const skillCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
  body: z.string().trim().min(1),
});

skillRoutes.post("/", async (c) => {
  const input = skillCreateSchema.parse(await c.req.json());
  try {
    const skill = await skillService.create(input);
    return c.json({ skill }, 201);
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "创建失败" }, 400);
  }
});

skillRoutes.get("/:key/body", async (c) => {
  try {
    const doc = await skillService.readBody(c.req.param("key"));
    return c.json(doc);
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "读取失败" }, 404);
  }
});

const skillUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  body: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

skillRoutes.put("/:key", async (c) => {
  const input = skillUpdateSchema.parse(await c.req.json());
  const { description, ...rest } = input;
  try {
    const skill = await skillService.update(c.req.param("key"), {
      ...rest,
      ...(description !== undefined ? { description: description ?? undefined } : {}),
    });
    return c.json({ skill });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "更新失败" }, 400);
  }
});

skillRoutes.delete("/:key", async (c) => {
  try {
    await skillService.remove(c.req.param("key"));
    return c.json({ ok: true });
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : "删除失败" }, 400);
  }
});
