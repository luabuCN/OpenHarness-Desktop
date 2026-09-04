import { Hono } from "hono";
import { z } from "zod";
import type { ChatUIMessage } from "../chat-types.js";
import { sessionRepository } from "../repositories/session-repository.js";

const createSessionSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().uuid().optional(),
});

const saveMessagesSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  messages: z.array(z.custom<ChatUIMessage>()).min(1),
});

/** 会话元数据更新：重命名 / 置顶 / 归档。 */
const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const sessionRoutes = new Hono();

sessionRoutes.get("/", async (c) => {
  return c.json({ sessions: await sessionRepository.list() });
});

// 注意必须注册在 GET /:id 之前，否则 "archived" 会被当成会话 id。
sessionRoutes.get("/archived", async (c) => {
  return c.json({ sessions: await sessionRepository.listArchived() });
});

sessionRoutes.post("/", async (c) => {
  const body = createSessionSchema.parse(await c.req.json());
  const session = await sessionRepository.ensure(
    body.id ?? crypto.randomUUID(),
    body.title ?? "New chat",
    body.projectId,
  );
  return c.json({ session }, 201);
});

sessionRoutes.get("/:id", async (c) => {
  const result = await sessionRepository.findWithUIMessages(c.req.param("id"));
  if (!result) return c.json({ error: "Conversation not found" }, 404);
  return c.json(result);
});

sessionRoutes.patch("/:id", async (c) => {
  const body = updateSessionSchema.parse(await c.req.json());
  const session = await sessionRepository.update(c.req.param("id"), body);
  return c.json({ session });
});

sessionRoutes.put("/:id/messages", async (c) => {
  const body = saveMessagesSchema.parse(await c.req.json());
  await sessionRepository.saveUIMessages(c.req.param("id"), body.messages, body.title);
  return c.json({ ok: true });
});

sessionRoutes.delete("/:id", async (c) => {
  await sessionRepository.delete(c.req.param("id"));
  return c.json({ ok: true });
});
