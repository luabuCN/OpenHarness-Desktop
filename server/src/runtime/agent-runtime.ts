import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { config, skillsDir } from "../env.js";
import { prisma } from "../db.js";
import type { ModelSelection } from "../providers/provider-service.js";
import type { ChatUIMessage } from "../chat-types.js";
import { resolveAgentDefinition } from "./agents.js";
import { createModel } from "./model.js";
import { runService } from "./run-service.js";
import { createToolRegistry } from "./tools.js";
import { THINKING_MODES, type ThinkingMode } from "./types.js";

export interface ConversationRunContext {
  conversationId: string;
  projectId?: string;
}

type ChatModel = Awaited<ReturnType<typeof createModel>>;

function truncateError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

async function projectRoot(projectId?: string): Promise<string | undefined> {
  if (!projectId) return undefined;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { isActive: true, rootPath: true },
  });
  if (!project?.isActive) throw new Error("项目不存在或已被停用");
  return project.rootPath;
}

class AgentRuntimeService {
  async stream(
    mode: ThinkingMode,
    messages: ChatUIMessage[],
    requestSignal: AbortSignal,
    context: ConversationRunContext,
    selection?: ModelSelection,
    requestedAgentId?: string,
) {
    let effectiveAgentId = requestedAgentId;
    if (!effectiveAgentId && context.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: context.projectId },
        select: { defaultAgentId: true },
      });
      effectiveAgentId = project?.defaultAgentId ?? undefined;
    }
    const definition = resolveAgentDefinition(effectiveAgentId);
    const rootPath = await projectRoot(context.projectId);
    const run = await runService.start({
      conversationId: context.conversationId,
      messages,
      projectId: context.projectId,
      thinkingMode: mode,
      selection,
      agentId: definition.id,
    });
    const activeRun = runService.registerAbortSource(run.id, requestSignal);

    try {
      const model = await createModel(mode, selection);
      const tools = createToolRegistry({
        rootPath,
        readOnly: definition.toolset === "readonly",
        bashApprovals: definition.toolset === "all" ? activeRun.approvals : undefined,
      }).toToolSet();
      const maxSteps = mode === "deep" ? 120 : 80;

      const explore = definition.withExploreSubagent
        ? new Agent({
            id: "explore",
            name: "explore",
            description: "Read-only workspace exploration.",
            instructions:
              "You explore the local workspace, read files, and report concise findings. You cannot modify files.",
            model,
            tools: createToolRegistry({ rootPath, readOnly: true }).toToolSet(),
            defaultOptions: { maxSteps: 15 },
          })
        : undefined;

      const agent = new Agent({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        instructions:
          mode === "deep"
            ? `${definition.instructions} Think carefully before acting; reason through edge cases and verify assumptions when useful.`
            : definition.instructions,
        model,
        tools,
        ...(explore ? { agents: { explore } } : {}),
        skills: [skillsDir],
        maxRetries: 3,
        inputProcessors: [new TokenLimiterProcessor({ limit: config.contextWindow })],
        defaultOptions: { maxSteps },
      });

      const modelMessages = await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      });
      const mastraStream = await agent.stream(modelMessages, {
        abortSignal: activeRun.signal,
        maxSteps,
      });
      const sourceChunks = toAISdkStream(mastraStream, {
        from: "agent",
        version: "v6",
        sendReasoning: true,
        sendStart: true,
        sendFinish: true,
      });

      let released = false;
      let releaseOwnership!: () => void;
      const ownershipComplete = new Promise<void>((resolve) => {
        releaseOwnership = () => {
          if (released) return;
          released = true;
          resolve();
        };
      });

      const persistedTitle = messages
        .filter((message) => message.role === "user")
        .at(-1)?.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim()
        .slice(0, 80);

      const uiStream = createUIMessageStream<ChatUIMessage>({
        originalMessages: messages,
        execute: async ({ writer }) => {
          const reader = sourceChunks.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            writer.write(value);
            await runService
              .appendTransition(run.id, value.type, value)
              .catch(console.error);
          }
        },
        onStepFinish: ({ messages: stepMessages }) =>
          runService.saveStep(
            context.conversationId,
            stepMessages as ChatUIMessage[],
            persistedTitle,
          ),
        onFinish: ({ messages: finalMessages, isAborted }) =>
          Promise.all([
            runService.saveStep(
              context.conversationId,
              finalMessages as ChatUIMessage[],
              persistedTitle,
            ),
            runService.finish(run.id, isAborted ? "aborted" : "completed"),
          ]).then(() => releaseOwnership()),
        onError: (error) => {
          console.error(error);
          return "The local agent run failed.";
        },
      });

      // Some transport failures end before an AI SDK finish callback; release
      // the run's controller ownership when ownership work has stopped.
      void ownershipComplete.finally(() => activeRun.cleanup());
      activeRun.signal.addEventListener("abort", () => {
        setTimeout(releaseOwnership, 1_000);
      }, { once: true });

      return createUIMessageStreamResponse({
        stream: uiStream,
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    } catch (error) {
      activeRun.cleanup();
      await runService.finish(run.id, "failed", truncateError(error));
      throw error;
    }
  }

  describe() {
    const registry = createToolRegistry({ readOnly: true });
    return THINKING_MODES.map((mode) => ({
      mode,
      tools: registry.list().map(({ name }) => name),
    }));
  }
}

export const agentRuntime = new AgentRuntimeService();
