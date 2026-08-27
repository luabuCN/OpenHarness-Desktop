import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { convertToModelMessages, createUIMessageStreamResponse } from "ai";
import { config, skillsDir } from "../env.js";
import { getProviderRevision, type ModelSelection } from "../providers/provider-service.js";
import type { ChatUIMessage } from "../chat-types.js";
import { createModel } from "./model.js";
import { createToolRegistry } from "./tools.js";
import { THINKING_MODES, type ThinkingMode } from "./types.js";

const systemPrompt =
  "You are a local coding assistant working inside the user's workspace. " +
  "Be concise and direct. Use announce before multi-step work or when you find " +
  "something notable. Do not claim to have changed files unless a tool call succeeded.";

export interface AgentRuntime {
  readonly maxSteps: number;
  readonly agent: Agent;
}

interface CachedRuntime extends AgentRuntime {
  revision: number;
}

export class AgentRuntimeService {
  private readonly runtimes = new Map<string, CachedRuntime>();

  async get(mode: ThinkingMode, selection?: ModelSelection): Promise<AgentRuntime> {
    const revision = getProviderRevision();
    const cacheKey = `${mode}|${selection ? `${selection.providerId}:${selection.modelId}` : "default"}`;
    const cached = this.runtimes.get(cacheKey);
    if (cached && cached.revision === revision) return cached;

    const model = await createModel(mode, selection);
    const registry = createToolRegistry();
    const tools = registry.toToolSet();
    const maxSteps = mode === "deep" ? 120 : 80;

    const explore = new Agent({
      id: "explore",
      name: "explore",
      description: "Read-only workspace exploration.",
      instructions:
        "You explore the local workspace, read files, and report concise findings. " +
        "You cannot modify files.",
      model,
      tools,
      defaultOptions: { maxSteps: 15 },
    });

    const agent = new Agent({
      id: "assistant",
      name: "assistant",
      description: "Local workspace coding assistant.",
      instructions:
        mode === "deep"
          ? `${systemPrompt} Think carefully before acting; reason through edge cases and verify assumptions when useful.`
          : systemPrompt,
      model,
      tools,
      agents: { explore },
      skills: [skillsDir],
      maxRetries: 3,
      inputProcessors: [new TokenLimiterProcessor({ limit: config.contextWindow })],
      defaultOptions: { maxSteps },
    });

    const runtime: CachedRuntime = { agent, maxSteps, revision };
    this.runtimes.set(cacheKey, runtime);
    return runtime;
  }

  async stream(mode: ThinkingMode, messages: ChatUIMessage[], signal?: AbortSignal, selection?: ModelSelection) {
    const { agent, maxSteps } = await this.get(mode, selection);
    const modelMessages = await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
    });
    const stream = await agent.stream(modelMessages, {
      abortSignal: signal,
      maxSteps,
    });
    const uiStream = toAISdkStream(stream, {
      from: "agent",
      version: "v6",
      sendReasoning: true,
      sendStart: true,
      sendFinish: true,
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  describe() {
    const registry = createToolRegistry();
    const tools = registry.list().map(({ name }) => name);
    return THINKING_MODES.map((mode) => ({ mode, tools }));
  }
}
