import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  resolveModelConfig,
  resolveSelectionConfig,
  type ModelSelection,
} from "../providers/provider-service.js";
import { agentProfiles, type ThinkingMode } from "./types.js";

type ChatModel = ReturnType<
  ReturnType<typeof createOpenAICompatible>["languageModel"]
>;

/**
 * The gateway speaks the OpenAI chat-completions protocol but streams
 * thinking via `delta.reasoning_content`, which @ai-sdk/openai's chat
 * completions path never parses. `@ai-sdk/openai-compatible` (the same
 * provider aime-chat uses for custom endpoints) maps both `reasoning_content`
 * and `reasoning` deltas onto AI SDK reasoning parts, so streamed thinking
 * works out of the box for any OpenAI-compatible model we attach later.
 *
 * The gateway also rejects OpenAI's reasoning-model conventions such as the
 * `developer` system role, so the SDK's forceReasoning provider option cannot
 * be used. Qwen toggles thinking natively via `enable_thinking`, injected at
 * the transport layer so each runtime profile gets the right behavior without
 * forking the SDK.
 *
 * Base URL / API key / model id are resolved per request-epoch from the
 * saved provider configuration (same idea as aime-chat's ProvidersManager):
 * an explicit selection from the chat prompt input wins, otherwise the first
 * enabled model of the first active provider. .env is never consulted for
 * models.
 */
async function createModelForMode(
  mode: ThinkingMode,
  selection?: ModelSelection,
): Promise<ChatModel> {
  const { enableThinking } = agentProfiles[mode];
  const resolved = selection
    ? await resolveSelectionConfig(selection)
    : await resolveModelConfig();
  const provider = createOpenAICompatible({
    name: resolved.providerName,
    baseURL: resolved.baseURL,
    apiKey: resolved.apiKey,
    includeUsage: true,
    fetch: async (input, init) => {
      if (typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          init = {
            ...init,
            body: JSON.stringify({ ...body, enable_thinking: enableThinking }),
          };
        } catch {
          // Leave unparseable bodies untouched so the provider surfaces the error.
        }
      }
      return fetch(input, init);
    },
  });

  return provider.languageModel(resolved.model);
}

export function createModel(
  mode: ThinkingMode,
  selection?: ModelSelection,
): Promise<ChatModel> {
  return createModelForMode(mode, selection);
}
