import type { ChatUIMessage } from "../chat-types.js";
import { AgentRuntimeService } from "../runtime/agent-runtime.js";
import type { ThinkingMode } from "../runtime/types.js";

const runtimeService = new AgentRuntimeService();

export const agentCapabilities = runtimeService.describe();

export function streamConversation(
  mode: ThinkingMode,
  messages: ChatUIMessage[],
  signal?: AbortSignal,
) {
  return runtimeService.stream(mode, messages, signal);
}
