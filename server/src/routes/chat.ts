import { Hono } from "hono";
import { z } from "zod";
import type { ChatUIMessage } from "../chat-types.js";
import { agentRuntime } from "../runtime/agent-runtime.js";
import { runService } from "../runtime/run-service.js";
import { runHub } from "../runtime/run-hub.js";
import { isPermissionMode, isReasoningEffort, isThinkingMode } from "../runtime/types.js";

const chatRequestSchema = z.object({
  id: z.string().min(1).optional(),
  messages: z.array(z.custom<ChatUIMessage>()).min(1),
  thinkingMode: z.string().refine(isThinkingMode).default("fast"),
  permissionMode: z.string().refine(isPermissionMode).default("confirm"),
  reasoningEffort: z.string().refine(isReasoningEffort).optional(),
  model: z
    .object({ providerId: z.string().min(1), modelId: z.string().min(1) })
    .optional(),
  projectId: z.string().uuid().optional(),
  agentId: z.string().min(1).optional(),
});

const UI_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
  "x-vercel-ai-ui-message-stream": "v1",
};

export const chatRoutes = new Hono();

chatRoutes.post("/", async (c) => {
  const body = chatRequestSchema.parse(await c.req.json());
  const sessionId = body.id ?? crypto.randomUUID();
  const thinkingMode = isThinkingMode(body.thinkingMode) ? body.thinkingMode : "fast";
  const permissionMode = isPermissionMode(body.permissionMode) ? body.permissionMode : "confirm";
  const reasoningEffort = isReasoningEffort(body.reasoningEffort) ? body.reasoningEffort : undefined;
  // 运行与请求连接解耦：不再把 c.req.raw.signal 传入，客户端断开（切换
  // 会话、刷新页面）后运行继续在后台执行，通过 GET /:id/stream 重连。
  return agentRuntime.stream(
    thinkingMode,
    body.messages,
    { conversationId: sessionId, projectId: body.projectId },
    body.model,
    body.agentId,
    permissionMode,
    reasoningEffort,
  );
});

/**
 * 重连进行中的运行（AI SDK resume 协议）。
 *
 * 会话有活跃运行时返回一个 SSE 流：先整体回放 runHub 中缓冲的 chunk
 * （完整重建消息并与已持久化快照按 messageId 去重），再接入实时广播，
 * 运行结束时发送 [DONE] 并关闭。无活跃运行返回 204，客户端回到就绪态。
 */
chatRoutes.get("/:id/stream", async (c) => {
  const conversationId = c.req.param("id");
  const run = await runService.activeRun(conversationId);
  if (!run || !runHub.has(run.id)) {
    return c.body(null, 204, { "cache-control": "no-cache, no-transform" });
  }

  const runId = run.id;
  const encoder = new TextEncoder();
  let subscriber:
    | { onChunk: (chunk: unknown) => void; onEnd: () => void }
    | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // 客户端已断开
        }
      };

      const currentSubscriber = {
        onChunk: (chunk: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          } catch {
            close();
          }
        },
        onEnd: () => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch {
            // 忽略写入失败，直接关闭
          }
          close();
        },
      };
      subscriber = currentSubscriber;

      const attached = runHub.attach(runId, currentSubscriber);
      if (!attached) close();
    },
    cancel() {
      if (subscriber) runHub.detach(runId, subscriber);
    },
  });

  return new Response(stream, { headers: UI_STREAM_HEADERS });
});
