import { isToolUIPart, type FileUIPart, type ReasoningUIPart, type TextUIPart } from "ai";
import {
  BotIcon,
  ChevronRightIcon,
  CopyIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SquareStackIcon,
} from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DiffCard } from "@/components/ai-elements/diff-block";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningPendingContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { messageText, toolNameOf, type ChatUIMessage, type ToolPart } from "@/lib/chat-utils";

interface MessageViewProps {
  message: ChatUIMessage;
  isStreaming?: boolean;
  /** False for every message except the newest; older assistant messages
   * collapse their reasoning/tool-call history to keep the DOM small. */
  isLast?: boolean;
  selectedToolId?: string;
  onToolSelect?: (id: string) => void;
}

function MessageViewBase({
  message,
  isStreaming = false,
  isLast = false,
  selectedToolId,
  onToolSelect,
}: MessageViewProps) {
  const isUser = message.role === "user";

  // aime-chat-style history slimming: an older assistant message renders only
  // its final text; the reasoning, tool calls and intermediate text before it
  // move into a collapsed section whose content stays unmounted until opened.
  const { visibleParts, hiddenParts } = useMemo(() => {
    if (isUser || isLast) {
      return { visibleParts: message.parts, hiddenParts: [] as ChatUIMessage["parts"] };
    }
    let cut = -1;
    for (let index = message.parts.length - 1; index >= 0; index -= 1) {
      if (message.parts[index].type === "text") {
        cut = index;
        break;
      }
    }
    if (cut <= 0) {
      return { visibleParts: message.parts, hiddenParts: [] as ChatUIMessage["parts"] };
    }
    return {
      hiddenParts: message.parts.slice(0, cut),
      visibleParts: message.parts.slice(cut),
    };
  }, [message, isUser, isLast]);

  const renderAssistantPart = (part: ChatUIMessage["parts"][number], index: number): ReactNode => {
    if (part.type === "text") {
      return (
        <MessageContent key={index}>
          <MessageResponse>{part.text}</MessageResponse>
        </MessageContent>
      );
    }
    if (part.type === "reasoning") {
      return <ReasoningPartView key={index} part={part} />;
    }
    if (part.type === "file") {
      return (
        <MessageContent key={index}>
          <FilePartView part={part} />
        </MessageContent>
      );
    }
    if (isToolUIPart(part)) {
      return (
        <ToolPartView
          key={part.toolCallId}
          part={part}
          active={selectedToolId === part.toolCallId}
          onToolSelect={onToolSelect}
        />
      );
    }
    return <DataPartView key={index} part={part} />;
  };

  return (
    // content-visibility lets the browser skip layout/paint of messages that
    // are outside the viewport; long conversations scroll and stream smoothly.
    <Message
      from={message.role}
      className="[content-visibility:auto] [contain-intrinsic-size:auto_720px]"
    >
      {isUser ? (
        <MessageContent>
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <p key={index} className="whitespace-pre-wrap">
                  {part.text}
                </p>
              );
            }
            if (part.type === "file") {
              return <FilePartView key={index} part={part} />;
            }
            return null;
          })}
        </MessageContent>
      ) : (
        <>
          {hiddenParts.length > 0 ? (
            <Collapsible className="w-full">
              <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                展开过程（{hiddenParts.length} 项）
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-2 outline-none data-[state=closed]:hidden">
                {hiddenParts.map((part, index) => renderAssistantPart(part, index))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {visibleParts.map((part, index) => renderAssistantPart(part, index))}
        </>
      )}
      {isUser || !isStreaming ? (
        <MessageActions className={isUser ? "justify-end" : undefined}>
          <MessageAction
            tooltip="复制消息"
            onClick={() => void navigator.clipboard.writeText(messageText(message))}
          >
            <CopyIcon size={14} />
          </MessageAction>
        </MessageActions>
      ) : null}
    </Message>
  );
}

/** Historical messages keep their object identity across streaming updates and
 * polls, so this comparator makes per-chunk re-renders skip every message
 * except the one actively streaming. Long conversations stay interactive. */
export const MessageView = memo(
  MessageViewBase,
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.isLast === next.isLast &&
    prev.selectedToolId === next.selectedToolId &&
    prev.onToolSelect === next.onToolSelect,
);
MessageView.displayName = "MessageView";

function FilePartView({ part }: { part: FileUIPart }) {
  if (part.mediaType.startsWith("image/")) {
    return (
      <img
        src={part.url}
        alt={part.filename ?? "附件"}
        className="max-h-40 rounded-md border"
      />
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <PaperclipIcon className="size-3" />
      {part.filename ?? part.mediaType}
    </Badge>
  );
}

/** A run accumulates every part of the whole agent loop into the streaming
 * message, which re-renders per chunk. Unchanged parts keep their object
 * identity across chunks, so memoized part views skip everything except the
 * actively streaming part. */
const ReasoningPartView = memo(function ReasoningPartView({
  part,
}: {
  part: ReasoningUIPart;
}) {
  return (
    <Reasoning isStreaming={part.state === "streaming"} className="w-full">
      <ReasoningTrigger />
      {part.text ? (
        <ReasoningContent>{part.text}</ReasoningContent>
      ) : (
        <ReasoningPendingContent />
      )}
    </Reasoning>
  );
});

/** Successful edit-tool outputs carry the before/after diff; render it as a
 * diff card instead of the raw JSON dump ToolOutput would print. */
const EDIT_TOOLS = new Set(["editFile", "writeFile"]);

interface EditDiffInfo {
  path: string;
  unifiedDiff: string | null;
  additions?: number;
  deletions?: number;
  changeKind?: string;
}

function extractEditDiff(toolName: string, part: ToolPart): EditDiffInfo | null {
  if (!EDIT_TOOLS.has(toolName) || part.state !== "output-available") return null;
  const output = "output" in part ? part.output : undefined;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  if (typeof record.error === "string") return null;
  if (typeof record.path !== "string") return null;
  return {
    path: record.path,
    unifiedDiff: typeof record.unifiedDiff === "string" ? record.unifiedDiff : null,
    additions: typeof record.additions === "number" ? record.additions : undefined,
    deletions: typeof record.deletions === "number" ? record.deletions : undefined,
    changeKind: typeof record.changeKind === "string" ? record.changeKind : undefined,
  };
}

function extractGitDiff(toolName: string, part: ToolPart): string | null {
  if (toolName !== "gitDiff" || part.state !== "output-available") return null;
  const output = "output" in part ? part.output : undefined;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  return typeof record.diff === "string" && record.diff !== "(no changes)" ? record.diff : null;
}

const ToolPartView = memo(
  function ToolPartView({
    part,
    active,
    onToolSelect,
  }: {
    part: ToolPart;
    active: boolean;
    onToolSelect?: (id: string) => void;
  }) {
    const title = toolNameOf(part);
    const select = () => onToolSelect?.(part.toolCallId);
    const editDiff = extractEditDiff(title, part);
    const gitDiffText = extractGitDiff(title, part);

    return (
      // The active highlight is an inset ring: a regular outer ring paints
      // 1px outside the card, and content-visibility paint containment on
      // Message clips it wherever the full-width card touches the edges
      // (left/right), which read as a broken border.
      <Tool
        className={active ? "w-full inset-ring-1 inset-ring-ring" : "w-full"}
      >
        <div onClick={select}>
          {part.type === "dynamic-tool" ? (
            <ToolHeader
              title={title}
              type={part.type}
              state={part.state}
              toolName={part.toolName}
            />
          ) : (
            <ToolHeader title={title} type={part.type} state={part.state} />
          )}
        </div>
        <ToolContent>
          {"input" in part && part.input !== undefined ? (
            <ToolInput input={part.input} />
          ) : null}
          {editDiff ? (
            <div className="space-y-2">
              <DiffCard
                title={
                  editDiff.changeKind === "create"
                    ? `新建 ${editDiff.path}`
                    : editDiff.path
                }
                diff={editDiff.unifiedDiff}
                additions={editDiff.additions}
                deletions={editDiff.deletions}
              />
            </div>
          ) : null}
          {gitDiffText ? (
            <DiffCard title="git diff" diff={gitDiffText} defaultOpen={false} />
          ) : null}
          {editDiff ? null : (
            <ToolOutput
              output={"output" in part ? part.output : undefined}
              errorText={"errorText" in part ? part.errorText : undefined}
            />
          )}
        </ToolContent>
      </Tool>
    );
  },
  (prev, next) =>
    prev.part === next.part &&
    prev.active === next.active &&
    prev.onToolSelect === next.onToolSelect,
);

type DataPart = ChatUIMessage["parts"][number];

function DataPartView({ part }: { part: DataPart }): ReactNode {
  switch (part.type) {
    case "data-oh:subagent.start":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          子 Agent <strong>{part.data.agentName}</strong> 已启动：{part.data.task}
        </SystemNote>
      );
    case "data-oh:subagent.done":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          子 Agent <strong>{part.data.agentName}</strong> 已完成，耗时{" "}
          {(part.data.durationMs / 1000).toFixed(1)} 秒
        </SystemNote>
      );
    case "data-oh:subagent.error":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          子 Agent <strong>{part.data.agentName}</strong> 失败：{part.data.error}
        </SystemNote>
      );
    case "data-oh:compaction.done":
      return (
        <SystemNote icon={<SquareStackIcon className="size-3.5" />}>
          上下文已压缩（移除 {part.data.messagesRemoved} 条消息）
        </SystemNote>
      );
    case "data-oh:retry":
      return (
        <SystemNote icon={<RefreshCwIcon className="size-3.5" />}>
          正在重试（第 {part.data.attempt} 次）：{part.data.reason}
        </SystemNote>
      );
    default:
      return null;
  }
}

function SystemNote({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
