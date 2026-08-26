import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

export interface TodoItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
}

export type ChatUIMessage = UIMessage<
  unknown,
  {
    "oh:todo.updated": { todos: TodoItem[] };
    "oh:turn.done": { durationMs: number };
    "oh:subagent.start": { agentName: string; task: string };
    "oh:subagent.done": { agentName: string; durationMs: number };
    "oh:subagent.error": { agentName: string; error: string };
    "oh:compaction.done": { messagesRemoved: number };
    "oh:retry": { attempt: number; reason: string };
  }
>;

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export interface ToolCallRef {
  id: string;
  name: string;
  part: ToolPart;
}

export function toolNameOf(part: ToolPart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
}

export function collectToolCalls(messages: ChatUIMessage[]): ToolCallRef[] {
  const calls: ToolCallRef[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (isToolUIPart(part)) {
        calls.push({ id: part.toolCallId, name: toolNameOf(part), part });
      }
    }
  }
  return calls;
}

export function latestTodos(messages: ChatUIMessage[]): TodoItem[] {
  let todos: TodoItem[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-oh:todo.updated") {
        todos = part.data.todos;
      }
    }
  }
  return todos;
}

export interface UsageStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  turns: number;
  totalTurnMs: number;
  subagents: number;
  compactions: number;
  messagesRemoved: number;
}

export function collectUsage(messages: ChatUIMessage[]): UsageStats {
  const stats: UsageStats = {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    turns: 0,
    totalTurnMs: 0,
    subagents: 0,
    compactions: 0,
    messagesRemoved: 0,
  };

  for (const message of messages) {
    if (message.role === "user") stats.userMessages += 1;
    if (message.role === "assistant") stats.assistantMessages += 1;

    for (const part of message.parts) {
      if (isToolUIPart(part)) stats.toolCalls += 1;
      if (part.type === "data-oh:turn.done") {
        stats.turns += 1;
        stats.totalTurnMs += part.data.durationMs;
      }
      if (part.type === "data-oh:subagent.done") stats.subagents += 1;
      if (part.type === "data-oh:compaction.done") {
        stats.compactions += 1;
        stats.messagesRemoved += part.data.messagesRemoved;
      }
    }
  }

  return stats;
}

export function messageText(message: ChatUIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
