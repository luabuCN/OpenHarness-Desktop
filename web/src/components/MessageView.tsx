import { isToolUIPart, type FileUIPart, type ReasoningUIPart, type TextUIPart } from "ai";
import {
  BotIcon,
  CopyIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SquareStackIcon,
} from "lucide-react";
import type { ReactNode } from "react";
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
  selectedToolId?: string;
  onToolSelect?: (id: string) => void;
}

export function MessageView({
  message,
  isStreaming = false,
  selectedToolId,
  onToolSelect,
}: MessageViewProps) {
  const isUser = message.role === "user";

  return (
    <Message from={message.role}>
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
        message.parts.map((part, index) => {
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
        })
      )}
      {isUser || !isStreaming ? (
        <MessageActions className={isUser ? "justify-end" : undefined}>
          <MessageAction
            tooltip="Copy message"
            onClick={() => void navigator.clipboard.writeText(messageText(message))}
          >
            <CopyIcon size={14} />
          </MessageAction>
        </MessageActions>
      ) : null}
    </Message>
  );
}

function FilePartView({ part }: { part: FileUIPart }) {
  if (part.mediaType.startsWith("image/")) {
    return (
      <img
        src={part.url}
        alt={part.filename ?? "attachment"}
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

function ReasoningPartView({ part }: { part: ReasoningUIPart }) {
  return (
    <Reasoning defaultOpen isStreaming={part.state === "streaming"} className="w-full">
      <ReasoningTrigger />
      {part.text ? (
        <ReasoningContent>{part.text}</ReasoningContent>
      ) : (
        <ReasoningPendingContent />
      )}
    </Reasoning>
  );
}

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

  return (
    <Tool className={active ? "w-full ring-1 ring-ring" : "w-full"}>
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
        {"input" in part && part.input !== undefined ? <ToolInput input={part.input} /> : null}
        <ToolOutput
          output={"output" in part ? part.output : undefined}
          errorText={"errorText" in part ? part.errorText : undefined}
        />
      </ToolContent>
    </Tool>
  );
}

type DataPart = ChatUIMessage["parts"][number];

function DataPartView({ part }: { part: DataPart }): ReactNode {
  switch (part.type) {
    case "data-oh:subagent.start":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          Subagent <strong>{part.data.agentName}</strong> started: {part.data.task}
        </SystemNote>
      );
    case "data-oh:subagent.done":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          Subagent <strong>{part.data.agentName}</strong> finished in{" "}
          {(part.data.durationMs / 1000).toFixed(1)}s
        </SystemNote>
      );
    case "data-oh:subagent.error":
      return (
        <SystemNote icon={<BotIcon className="size-3.5" />}>
          Subagent <strong>{part.data.agentName}</strong> failed: {part.data.error}
        </SystemNote>
      );
    case "data-oh:compaction.done":
      return (
        <SystemNote icon={<SquareStackIcon className="size-3.5" />}>
          Context compacted ({part.data.messagesRemoved} messages removed)
        </SystemNote>
      );
    case "data-oh:retry":
      return (
        <SystemNote icon={<RefreshCwIcon className="size-3.5" />}>
          Retrying (attempt {part.data.attempt}): {part.data.reason}
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
