import type { ChatUIMessage } from "./chat-types.js";
import { prisma } from "./db.js";

async function ensureConversation(id: string, title = "New chat") {
  return prisma.conversation.upsert({
    where: { id },
    update: {},
    create: { id, title },
  });
}

export async function saveUIMessages(
  sessionId: string,
  messages: ChatUIMessage[],
  title?: string,
) {
  await ensureConversation(sessionId, title);

  await prisma.$transaction([
    prisma.storedMessage.deleteMany({
      where: { conversationId: sessionId, kind: "ui" },
    }),
    prisma.storedMessage.createMany({
      data: messages.map((message, index) => ({
        conversationId: sessionId,
        kind: "ui",
        sequence: index,
        role: typeof message === "object" && message !== null && "role" in message
          ? String(message.role)
          : "unknown",
        payload: JSON.stringify(message),
      })),
    }),
    ...(title
      ? [prisma.conversation.update({ where: { id: sessionId }, data: { title } })]
      : []),
  ]);
}
