import type { UseChatHelpers } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { useCallback } from "react";
import type { ChatUIMessage } from "@/lib/chat-utils";
import {
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SparklesIcon,
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
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { SidebarPeekTrigger } from "@/components/SidebarPeekTrigger";
import type {
  ApprovalAction,
  ApprovalInfo,
  ModelSelection,
  PermissionMode,
  ProjectInfo,
  ProviderInfo,
  ReasoningEffort,
  RunInfo,
} from "@/api";
import { MessageView } from "./MessageView";
import { MessageLinkContext } from "./ai-elements/message";
import { ConversationMinimap } from "./ConversationMinimap";
import { ModelSelector } from "./ModelSelector";
import { AgentSelector } from "./AgentSelector";
import { ProjectSelector } from "./ProjectSelector";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { PermissionModeSelector } from "./PermissionModeSelector";

const SUGGESTIONS = [
  "列出工作区中的文件",
  "我正在使用什么操作系统和 Shell？",
  "总结一下这个工作区的内容",
];

/** 最近一次回合异常结束（且没有文字总结）时的提示。 */
export interface TurnOutcomeNote {
  kind: "failed" | "aborted";
  message: string;
}

export interface ChatPaneProps {
  chat: UseChatHelpers<ChatUIMessage>;
  title: string;
  providers: ProviderInfo[];
  displaySelection: ModelSelection | null;
  onSelectionChange: (selection: ModelSelection) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
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
    action: ApprovalAction,
  ) => void;
  turnNote?: TurnOutcomeNote;
  /** 聊天内容里的链接点击后改在内置浏览器面板中打开。 */
  onOpenLink?: (url: string) => void;
}

export function ChatPane({
  chat,
  title,
  providers,
  displaySelection,
  onSelectionChange,
  reasoningEffort,
  onReasoningEffortChange,
  permissionMode,
  onPermissionModeChange,
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
  turnNote,
  onOpenLink,
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
  // 一次只确认一条：按创建时间取最早的一条，其余等这条处理完再依次出现。
  const sortedApprovals = [...pendingApprovals].sort((a, b) =>
    a.approval.createdAt.localeCompare(b.approval.createdAt),
  );
  const activeApproval = sortedApprovals[0];

  // 聊天里的链接（markdown/自动识别的 URL）默认会走系统浏览器打开；
  // 拦截后送进内置浏览器面板，和预览行为保持一致。
  const handleLinkClickCapture = useCallback(
    (event: React.MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenLink?.(href);
    },
    [onOpenLink],
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* 与右侧面板的标签栏（h-9）保持同一高度，顶部分隔线才对齐。 */}
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <SidebarPeekTrigger />
          <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        </div>
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

      <MessageLinkContext.Provider value={onOpenLink}>
        <Conversation onClickCapture={handleLinkClickCapture}>
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
            {waiting ? <AssistantLoadingView effort={reasoningEffort} /> : null}
            {!busy && turnNote ? <TurnNoteView note={turnNote} /> : null}
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
          <ConversationMinimap messages={chat.messages} />
          <ConversationScrollButton />
        </Conversation>
      </MessageLinkContext.Provider>

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          {activeApproval ? (
            <div className="mb-12">
              <ApprovalPrompt
                run={activeApproval.run}
                approval={activeApproval.approval}
                remainingCount={sortedApprovals.length - 1}
                onDecision={(action) =>
                  onApprovalDecision(
                    activeApproval.run.id,
                    activeApproval.approval.id,
                    action,
                  )
                }
              />
            </div>
          ) : null}
          <div className="relative">
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
                body: {
                  thinkingMode: reasoningEffort === "off" ? "fast" : "deep",
                  reasoningEffort,
                  agentId,
                  projectId,
                },
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
                <PermissionModeSelector
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                />
                <ModelSelector
                  providers={providers}
                  value={displaySelection}
                  onChange={onSelectionChange}
                  effort={reasoningEffort}
                  onEffortChange={onReasoningEffortChange}
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

function AssistantLoadingView({ effort }: { effort: ReasoningEffort }) {
  if (effort !== "off") {
    // 与消息流里的 ThinkingLine 保持一致的一行式占位。
    return (
      <div className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5 shrink-0" />
        <Shimmer as="span" duration={1.6}>思考中…</Shimmer>
      </div>
    );
  }

  // Pure CSS animations only: JS-driven ones (motion) freeze whenever the
  // main thread is busy rendering the stream, which reads as "stuck".
  return (
    <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3 w-40 animate-pulse rounded bg-muted-foreground/25" />
        <span className="block h-3 max-w-64 animate-pulse rounded bg-muted-foreground/15 [animation-delay:150ms]" />
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

/** 历史/结束后补充的回合结果提示：失败用错误色，中止用中性色。 */
function TurnNoteView({ note }: { note: TurnOutcomeNote }) {
  const failed = note.kind === "failed";
  return (
    <div
      className={
        failed
          ? "flex w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          : "flex w-full items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      }
    >
      {failed ? (
        <CircleAlertIcon className="size-3.5 shrink-0" />
      ) : (
        <InfoIcon className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">{note.message}</span>
    </div>
  );
}
