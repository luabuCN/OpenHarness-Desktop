import { messageText, type ChatUIMessage } from "@/lib/chat-utils";

/** 对话大纲（minimap）的一条标记：指向一条可跳转的消息及其预览文本。 */
export type ConversationMinimapMarker = {
  id: string;
  role: "user" | "assistant";
  preview: string;
};

export const CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS = 280;

/** 一屏放得下时轨道没有导航价值；至少要有一次问答才渲染。 */
export function shouldRenderConversationMinimap({
  markerCount,
  overflows,
}: {
  markerCount: number;
  overflows: boolean;
}): boolean {
  return markerCount >= 2 && overflows;
}

function appendPreview(current: string, next: string): string {
  if (!next || current.length >= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS) {
    return current;
  }
  return `${current}${current ? "\n\n" : ""}${next}`.slice(
    0,
    CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS,
  );
}

/** 每个回合生成一条用户标记和一条助手标记；纯工具调用（无文字）的
 * 助手回合不产生标记，同一回合内连续的助手文字合并为一条预览。 */
export function buildConversationMinimapMarkers(
  messages: ChatUIMessage[],
): ConversationMinimapMarker[] {
  const markers: ConversationMinimapMarker[] = [];
  let assistantMarkerIndex: number | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      markers.push({
        id: message.id,
        role: "user",
        preview: messageText(message)
          .trim()
          .slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      });
      assistantMarkerIndex = null;
      continue;
    }
    if (message.role !== "assistant") continue;

    const text = messageText(message).trim();
    if (!text) continue;
    if (assistantMarkerIndex === null) {
      markers.push({
        id: message.id,
        role: "assistant",
        preview: text.slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      });
      assistantMarkerIndex = markers.length - 1;
      continue;
    }

    const marker = markers[assistantMarkerIndex];
    marker.preview = appendPreview(marker.preview, text);
  }

  return markers;
}
