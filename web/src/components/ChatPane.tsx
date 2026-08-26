import type { UseChatHelpers } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/lib/chat-utils";
import { BrainIcon, CpuIcon, LoaderCircleIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputButton,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Reasoning,
  ReasoningPendingContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { ThinkingMode } from "@/api";
import { MessageView } from "./MessageView";

const SUGGESTIONS = [
  "List the files in my workspace",
  "What OS and shell am I running?",
  "Summarize what this workspace contains",
];

export interface ChatPaneProps {
  chat: UseChatHelpers<ChatUIMessage>;
  title: string;
  model?: string;
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
  selectedToolId?: string;
  onToolSelect: (id: string) => void;
}

export function ChatPane({
  chat,
  title,
  model,
  thinkingMode,
  onThinkingModeChange,
  selectedToolId,
  onToolSelect,
}: ChatPaneProps) {
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const waiting = busy && !hasVisibleAssistantWork(chat.messages);
  const streamingMessageId =
    busy && chat.messages.at(-1)?.role === "assistant"
      ? chat.messages.at(-1)?.id
      : undefined;
  const error =
    chat.error instanceof Error
      ? chat.error.message
      : typeof chat.error === "string"
        ? chat.error
        : undefined;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {model ? (
            <Badge variant="outline" className="gap-1 font-normal">
              <CpuIcon className="size-3" />
              {model}
            </Badge>
          ) : null}
          <Badge variant={busy ? "default" : "secondary"} className="gap-1">
            {busy ? <Spinner className="size-3 animate-spin" /> : null}
            {busy ? "Working" : "Ready"}
          </Badge>
        </div>
      </header>

      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 py-6">
          {chat.messages.length === 0 ? (
            <ConversationEmptyState
              title="Local workspace ready"
              description="Ask about files, paste an image, or start a new task."
            />
          ) : (
            chat.messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                isStreaming={message.id === streamingMessageId}
                selectedToolId={selectedToolId}
                onToolSelect={onToolSelect}
              />
            ))
          )}
          {waiting ? <AssistantLoadingView mode={thinkingMode} /> : null}
          {!busy && error ? <AssistantErrorView message={error} /> : null}
          {chat.messages.length === 0 ? (
            <Suggestions className="justify-center">
              {SUGGESTIONS.map((suggestion) => (
                <Suggestion
                  key={suggestion}
                  suggestion={suggestion}
                  onClick={(text) => void chat.sendMessage({ text })}
                />
              ))}
            </Suggestions>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 px-4 pb-4">
        <PromptInput
          className="mx-auto w-full max-w-3xl rounded-xl border bg-card shadow-sm"
          onSubmit={({ text, files }) => {
            if (busy || (!text.trim() && files.length === 0)) return;
            void chat.sendMessage({
              text,
              ...(files.length > 0 ? { files } : {}),
            }, {
              body: { thinkingMode },
            });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Add attachments" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputButton
                aria-pressed={thinkingMode === "deep"}
                disabled={busy}
                onClick={() =>
                  onThinkingModeChange(thinkingMode === "deep" ? "fast" : "deep")
                }
                tooltip={
                  thinkingMode === "deep"
                    ? "Deep thinking is on, click to turn off"
                    : "Think carefully before answering"
                }
                variant={thinkingMode === "deep" ? "secondary" : "ghost"}
              >
                <BrainIcon className="size-4" />
                <span>深度思考</span>
              </PromptInputButton>
              {model ? (
                <PromptInputSelect value={model}>
                  <PromptInputSelectTrigger
                    aria-label="Select model"
                    className="h-8 gap-1.5 px-2.5"
                    size="sm"
                  >
                    <CpuIcon className="size-4" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <PromptInputSelectItem value={model}>
                      {model}
                    </PromptInputSelectItem>
                  </PromptInputSelectContent>
                </PromptInputSelect>
              ) : null}
            </PromptInputTools>
            <PromptInputSubmit
              status={chat.status}
              onStop={() => void chat.stop()}
              className="size-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}

function hasVisibleAssistantWork(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;

  return last.parts.some((part) => {
    if (part.type === "text") return part.text.length > 0;
    // A reasoning part is visible as soon as it exists, even before the first
    // delta arrives, so the loading placeholder never doubles up with it.
    if (part.type === "reasoning") return true;
    return isToolUIPart(part);
  });
}

function AssistantLoadingView({ mode }: { mode: ThinkingMode }) {
  if (mode === "deep") {
    return (
      <Reasoning isStreaming className="w-full">
        <ReasoningTrigger />
        <ReasoningPendingContent />
      </Reasoning>
    );
  }

  return (
    <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      <div className="min-w-0 flex-1 space-y-1">
        <Shimmer duration={1.6}>Thinking...</Shimmer>
        <Shimmer className="block h-3 max-w-64 opacity-50" duration={2}>
          {"Preparing the answer"}
        </Shimmer>
      </div>
    </div>
  );
}

function AssistantErrorView({ message }: { message: string }) {
  return (
    <div className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}
