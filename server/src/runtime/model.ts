import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { resolveModelConfig } from "../providers/provider-service.js";
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
 * provider settings (same fallback idea as aime-chat's ProvidersManager):
 * a default model chosen in settings wins, otherwise the .env gateway.
 */
async function createModelForMode(mode: ThinkingMode): Promise<ChatModel> {
  const { enableThinking } = agentProfiles[mode];
  const resolved = await resolveModelConfig();
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

export function createModel(mode: ThinkingMode): Promise<ChatModel> {
  return createModelForMode(mode);
}
