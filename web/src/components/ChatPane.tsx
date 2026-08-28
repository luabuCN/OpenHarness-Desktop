import type { UseChatHelpers } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/lib/chat-utils";
import {
  BrainIcon,
  LoaderCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import type {
  ApprovalInfo,
  ModelSelection,
  ProjectInfo,
  ProviderInfo,
  RunInfo,
  ThinkingMode,
} from "@/api";
import { MessageView } from "./MessageView";
import { ModelSelector } from "./ModelSelector";
import { AgentSelector } from "./AgentSelector";
import { ProjectSelector } from "./ProjectSelector";

const SUGGESTIONS = [
  "列出工作区中的文件",
  "我正在使用什么操作系统和 Shell？",
  "总结一下这个工作区的内容",
];

export interface ChatPaneProps {
  chat: UseChatHelpers<ChatUIMessage>;
  title: string;
  providers: ProviderInfo[];
  displaySelection: ModelSelection | null;
  onSelectionChange: (selection: ModelSelection) => void;
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
  agentId?: string;
  onAgentChange: (agentId: string) => void;
  selectedToolId?: string;
  onToolSelect: (id: string) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  projects: ProjectInfo[];
  projectId?: string;
  onProjectChange: (projectId?: string) => void;
  onProjectCreated: () => void;
  pendingApprovals: Array<{ run: RunInfo; approval: ApprovalInfo }>;
  onApprovalDecision: (
    runId: string,
    approvalId: string,
    action: "approve" | "reject",
  ) => void;
}

export function ChatPane({
  chat,
  title,
  providers,
  displaySelection,
  onSelectionChange,
  thinkingMode,
  onThinkingModeChange,
  agentId,
  onAgentChange,
  selectedToolId,
  onToolSelect,
  panelOpen,
  onTogglePanel,
  projects,
  projectId,
  onProjectChange,
  onProjectCreated,
  pendingApprovals,
  onApprovalDecision,
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onTogglePanel}
          title={panelOpen ? "折叠面板" : "展开面板"}
          aria-label={panelOpen ? "折叠面板" : "展开面板"}
        >
          {panelOpen ? (
            <PanelRightCloseIcon className="size-4" />
          ) : (
            <PanelRightOpenIcon className="size-4" />
          )}
        </Button>
      </header>

      {pendingApprovals.length > 0 ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4">
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm shadow-sm">
            <div className="flex min-w-0 items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
              <ShieldAlertIcon className="size-4 shrink-0" />
              <span>操作等待审批</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                待处理 {pendingApprovals.length} 项
              </span>
            </div>
            {pendingApprovals.map(({ run, approval }) => (
              <div
                key={approval.id}
                className="rounded-md border bg-background/80 p-2"
              >
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                  {approval.input}
                </pre>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onApprovalDecision(run.id, approval.id, "reject")
                    }
                  >
                    <XIcon className="size-3.5" />
                    拒绝
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      onApprovalDecision(run.id, approval.id, "approve")
                    }
                  >
                    同意执行
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 py-6">
          {chat.messages.length === 0 ? (
            <ConversationEmptyState
              title="本地工作区已就绪"
              description="可以询问文件相关内容、粘贴图片，或直接开始新任务。"
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
        <div className="relative mx-auto w-full max-w-3xl">
          <div className="absolute -top-10 left-0 z-10 flex h-8 items-center">
            <AgentSelector value={agentId} onChange={onAgentChange} />
            <ProjectSelector
              projects={projects}
              projectId={projectId}
              onSelectProject={onProjectChange}
              onChanged={onProjectCreated}
            />
          </div>
          <PromptInput
            className="w-full rounded-xl border bg-card shadow-sm"
            onSubmit={({ text, files }) => {
              if (busy || (!text.trim() && files.length === 0)) return;
              void chat.sendMessage({
                text,
                ...(files.length > 0 ? { files } : {}),
              }, {
                body: { thinkingMode, agentId, projectId },
              });
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="添加附件" />
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
                      ? "深度思考已开启，点击关闭"
                      : "回答前先进行深度思考"
                  }
                  variant={thinkingMode === "deep" ? "secondary" : "ghost"}
                >
                  <BrainIcon className="size-4" />
                  <span>深度思考</span>
                </PromptInputButton>
                <ModelSelector
                  providers={providers}
                  value={displaySelection}
                  onChange={onSelectionChange}
                />
              </PromptInputTools>
              <PromptInputSubmit
                status={chat.status}
                onStop={() => void chat.stop()}
                className="size-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
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
        <Shimmer duration={1.6}>思考中...</Shimmer>
        <Shimmer className="block h-3 max-w-64 opacity-50" duration={2}>
          {"正在准备回答"}
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
