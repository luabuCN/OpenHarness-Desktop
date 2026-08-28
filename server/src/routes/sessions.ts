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

export const sessionRoutes = new Hono();

sessionRoutes.get("/", async (c) => {
  return c.json({ sessions: await sessionRepository.list() });
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

sessionRoutes.put("/:id/messages", async (c) => {
  const body = saveMessagesSchema.parse(await c.req.json());
  await sessionRepository.saveUIMessages(c.req.param("id"), body.messages, body.title);
  return c.json({ ok: true });
});

sessionRoutes.delete("/:id", async (c) => {
  await sessionRepository.delete(c.req.param("id"));
  return c.json({ ok: true });
});
