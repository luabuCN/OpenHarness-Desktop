import { Hono } from "hono";
import { z } from "zod";
import type { ChatUIMessage } from "../chat-types.js";
import { streamConversation } from "../conversations/conversation-service.js";
import { sessionRepository } from "../repositories/session-repository.js";
import { isThinkingMode } from "../runtime/types.js";

const chatRequestSchema = z.object({
  id: z.string().min(1).optional(),
  messages: z.array(z.custom<ChatUIMessage>()).min(1),
  thinkingMode: z.string().refine(isThinkingMode).default("fast"),
});

export const chatRoutes = new Hono();

chatRoutes.post("/", async (c) => {
  const body = chatRequestSchema.parse(await c.req.json());
  const sessionId = body.id ?? crypto.randomUUID();
  const thinkingMode = isThinkingMode(body.thinkingMode) ? body.thinkingMode : "fast";
  await sessionRepository.ensureFromMessages(sessionId, body.messages);
  return streamConversation(thinkingMode, body.messages, c.req.raw.signal);
});
