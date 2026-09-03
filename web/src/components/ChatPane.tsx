import type { UseChatHelpers } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { useCallback, useEffect, useState } from "react";
import type { ChatUIMessage } from "@/lib/chat-utils";
import { prepareAttachments } from "@/lib/attachments";
import {
  CircleAlertIcon,
  ImageIcon,
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
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { SidebarPeekTrigger } from "@/components/SidebarPeekTrigger";
import type {
  ApprovalAction,
  ApprovalInfo,
  AskUserInfo,
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
import { AskUserPrompt } from "./AskUserPrompt";
import { PermissionModeSelector } from "./PermissionModeSelector";

const SUGGESTIONS = [
  "列出工作区中的文件",
  "我正在使用什么操作系统和 Shell？",
  "总结一下这个工作区的内容",
];

/** 单个附件的大小上限；PDF/Word/表格以 data URL 形式随消息发送，过大
 * 的文件会显著拖慢请求与每轮重放，超限时在前端直接拦截。 */
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

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
  /** askUser 工具挂起的提问卡片（与审批一样由运行轮询驱动）。 */
  pendingAsks: Array<{ run: RunInfo; ask: AskUserInfo }>;
  onAskAnswer: (
    runId: string,
    askId: string,
    answers: Array<string[] | null>,
  ) => void;
  turnNote?: TurnOutcomeNote;
  /** 聊天内容里的链接点击后改在内置浏览器面板中打开。 */
  onOpenLink?: (url: string) => void;
  /** 停止按钮：运行与连接解耦后需要走服务端中止 API；缺省退回本地断流。 */
  onStop?: () => void;
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
  pendingAsks,
  onAskAnswer,
  turnNote,
  onOpenLink,
  onStop,
}: ChatPaneProps) {
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const waiting = busy && !hasVisibleAssistantWork(chat.messages);
  const streamingMessageId =
    busy && chat.messages.at(-1)?.role === "assistant"
      ? chat.messages.at(-1)?.id
      : undefined;
  // 附件被拒（超大小/类型不符）时的短暂提示，几秒后自动消失。
  const [attachmentError, setAttachmentError] = useState<string>();
  useEffect(() => {
    if (!attachmentError) return;
    const timer = window.setTimeout(() => setAttachmentError(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [attachmentError]);
  const error =
    chat.error instanceof Error
      ? chat.error.message
      : typeof chat.error === "string"
        ? chat.error
        : undefined;
  // 当前选中模型是否声明了图片输入：true/false 明确提示，undefined 表示目录
  // 未配置模态信息（不做提示，避免误导）。
  const selectedModel = displaySelection
    ? providers
        .find((provider) => provider.id === displaySelection.providerId)
        ?.models.find((model) => model.id === displaySelection.modelId)
    : undefined;
  const modelAcceptsImages = selectedModel?.modalities?.input?.includes("image");
  // 一次只确认一条：按创建时间取最早的一条，其余等这条处理完再依次出现。
  const sortedApprovals = [...pendingApprovals].sort((a, b) =>
    a.approval.createdAt.localeCompare(b.approval.createdAt),
  );
  const activeApproval = sortedApprovals[0];
  // 提问卡片同理：最早一条先答；与审批同时挂起时审批优先（权限先放行，回合才能继续）。
  const sortedAsks = [...pendingAsks].sort((a, b) =>
    a.ask.createdAt.localeCompare(b.ask.createdAt),
  );
  const activeAsk = sortedAsks[0];

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
          <ConversationContent className="mx-auto w-full max-w-5xl gap-6 py-6">
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
        <div className="mx-auto w-full max-w-5xl">
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
          {activeAsk ? (
            <div className="mb-12">
              <AskUserPrompt
                ask={activeAsk.ask}
                onSubmit={(answers) =>
                  onAskAnswer(activeAsk.run.id, activeAsk.ask.id, answers)
                }
              />
            </div>
          ) : null}
          <PromptInput
            className="w-full rounded-xl border bg-card shadow-sm"
            onSubmit={async ({ text, files }) => {
              if (busy || (!text.trim() && files.length === 0)) return;
              // 发送前处理附件：压缩大图。其余类型（PDF/Word/表格等）原样
              // 发送，服务端会落盘并把路径告诉模型。
              const prepared = await prepareAttachments(files);
              if (!text.trim() && prepared.length === 0) return;
              void chat.sendMessage(
                {
                  text,
                  ...(prepared.length > 0 ? { files: prepared } : {}),
                },
                {
                  body: {
                    thinkingMode: reasoningEffort === "off" ? "fast" : "deep",
                    reasoningEffort,
                    agentId,
                    projectId,
                  },
                },
              );
            }}
            maxFileSize={ATTACHMENT_MAX_BYTES}
            onError={(issue) => setAttachmentError(issue.message)}
          >
            <PromptInputBody>
              {attachmentError ? (
                <p className="flex w-full items-center gap-1.5 px-1 pb-1 text-xs text-destructive">
                  <CircleAlertIcon className="size-3.5 shrink-0" />
                  {attachmentError}
                </p>
              ) : null}
              <PromptInputAttachments />
              <AttachmentVisionHint acceptsImages={modelAcceptsImages} />
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
                <AgentSelector value={agentId} onChange={onAgentChange} />
                <ProjectSelector
                  projects={projects}
                  projectId={projectId}
                  onSelectProject={onProjectChange}
                  onChanged={onProjectCreated}
                />
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
                onStop={onStop ?? (() => void chat.stop())}
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

/** 暂存了图片但当前模型明确不支持图片输入时的一行提示。必须在
 * PromptInput 内渲染（读取附件上下文）；模态未知时不提示。 */
function AttachmentVisionHint({ acceptsImages }: { acceptsImages?: boolean }) {
  const attachments = usePromptInputAttachments();
  const hasImage = attachments.files.some((file) =>
    file.mediaType.startsWith("image/"),
  );
  if (!hasImage || acceptsImages !== false) return null;
  return (
    <p className="flex w-full items-center gap-1.5 px-1 pb-1 text-xs text-amber-600 dark:text-amber-400">
      <ImageIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 break-words">
        当前模型未声明图片输入，附件图片可能被忽略。可在「管理模型」中勾选模型的图像输入模态，或切换到支持视觉的模型。
      </span>
    </p>
  );
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
