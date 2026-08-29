import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { config, skillsDir, workspaceDir } from "../env.js";
import { prisma } from "../db.js";
import {
  resolveConfiguredSelection,
  type ModelSelection,
} from "../providers/provider-service.js";
import type { ChatUIMessage } from "../chat-types.js";
import { agentConfigService, type SubAgentConfig } from "./agents.js";
import { createModel } from "./model.js";
import { runService } from "./run-service.js";
import {
  parseToolPermissionMap,
  toolProviderRegistry,
  toolRecordService,
  type RunContext,
} from "./tools/index.js";
import { THINKING_MODES, type PermissionMode, type ThinkingMode } from "./types.js";

export interface ConversationRunContext {
  conversationId: string;
  projectId?: string;
}

type ChatModel = Awaited<ReturnType<typeof createModel>>;

function truncateError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

async function projectDefaults(projectId?: string) {
  if (!projectId) return undefined;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      isActive: true,
      rootPath: true,
      defaultAgentId: true,
      defaultProviderId: true,
      defaultModelId: true,
      toolPermissions: true,
    },
  });
  if (!project?.isActive) throw new Error("项目不存在或已被停用");
  return project;
}

class AgentRuntimeService {
  async stream(
    mode: ThinkingMode,
    messages: ChatUIMessage[],
    requestSignal: AbortSignal,
    context: ConversationRunContext,
    selection?: ModelSelection,
    requestedAgentId?: string,
    permissionMode: PermissionMode = "confirm",
  ) {
    const project = await projectDefaults(context.projectId);
    const definition = await agentConfigService.resolve(
      requestedAgentId ?? project?.defaultAgentId ?? undefined,
    );
    const rootPath = project?.rootPath;
    const effectiveSelection =
      selection ??
      await resolveConfiguredSelection(
        project
          ? {
              providerId: project.defaultProviderId,
              modelId: project.defaultModelId,
            }
          : undefined,
        {
          providerId: definition.defaultProviderId,
          modelId: definition.defaultModelId,
        },
      );
    const model = await createModel(mode, effectiveSelection);
    const run = await runService.start({
      conversationId: context.conversationId,
      messages,
      projectId: context.projectId,
      thinkingMode: mode,
      permissionMode,
      selection: effectiveSelection,
      agentId: definition.id,
    });
    const activeRun = runService.registerAbortSource(run.id, requestSignal);

    try {
      // Global permission mode sets the baseline; read-only agents cannot mutate;
      // project grants from "always allow" win over both; the tools-page kill
      // switch wins over everything. Unknown tools (future MCP/skill entries)
      // default to enabled-but-approval-required.
      const projectOverrides = parseToolPermissionMap(project?.toolPermissions);
      const disabledTools = await toolRecordService.disabledToolNames();
      const runContext = toolProviderRegistry.createRunContext({
        conversationId: context.conversationId,
        runId: run.id,
        projectId: context.projectId,
        workspacePath: rootPath ?? workspaceDir,
        agentId: definition.id,
        mode: permissionMode,
        readOnly: definition.readOnly,
        overrides: projectOverrides,
        disabledTools,
        approvals: activeRun.approvals,
        signal: activeRun.signal,
      });
      const tools = toolProviderRegistry.createToolSet(runContext);
      const maxSteps = mode === "deep" ? 120 : 80;

      const subAgents = definition.subAgents.map((entry) =>
        createSubAgent(entry, model, toolProviderRegistry.deriveContext(runContext, entry)),
      );

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
        ...(subAgents.length > 0
          ? { agents: Object.fromEntries(subAgents.map((agent) => [agent.id, agent])) }
          : {}),
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
    // Tool availability does not vary by thinking mode; policies are listed
    // for the default permission posture (read-only capability overview).
    const tools = Object.entries(
      toolProviderRegistry.policiesFor({ mode: "confirm", readOnly: true }),
    )
      .filter(([, policy]) => policy.enabled)
      .map(([name]) => name);
    return THINKING_MODES.map((mode) => ({ mode, tools }));
  }
}

function createSubAgent(
  config: SubAgentConfig,
  model: ChatModel,
  context: RunContext,
) {
  return new Agent({
    id: config.id,
    name: config.name,
    description: config.description,
    instructions: config.instructions,
    model,
    tools: toolProviderRegistry.createToolSet(context),
    defaultOptions: { maxSteps: 15 },
  });
}

export const agentRuntime = new AgentRuntimeService();
