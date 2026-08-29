import { Hono } from "hono";
import { z } from "zod";
import type { ChatUIMessage } from "../chat-types.js";
import { agentRuntime } from "../runtime/agent-runtime.js";
import { isPermissionMode, isThinkingMode } from "../runtime/types.js";

const chatRequestSchema = z.object({
  id: z.string().min(1).optional(),
  messages: z.array(z.custom<ChatUIMessage>()).min(1),
  thinkingMode: z.string().refine(isThinkingMode).default("fast"),
  permissionMode: z.string().refine(isPermissionMode).default("confirm"),
  model: z
    .object({ providerId: z.string().min(1), modelId: z.string().min(1) })
    .optional(),
  projectId: z.string().uuid().optional(),
  agentId: z.string().min(1).optional(),
});

export const chatRoutes = new Hono();

chatRoutes.post("/", async (c) => {
  const body = chatRequestSchema.parse(await c.req.json());
  const sessionId = body.id ?? crypto.randomUUID();
  const thinkingMode = isThinkingMode(body.thinkingMode) ? body.thinkingMode : "fast";
  const permissionMode = isPermissionMode(body.permissionMode) ? body.permissionMode : "confirm";
  return agentRuntime.stream(
    thinkingMode,
    body.messages,
    c.req.raw.signal,
    { conversationId: sessionId, projectId: body.projectId },
    body.model,
    body.agentId,
    permissionMode,
  );
});
