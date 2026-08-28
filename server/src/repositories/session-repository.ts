import type { ChatUIMessage } from "../chat-types.js";
import { prisma } from "../db.js";
import { saveUIMessages } from "../store.js";

function messageTitle(messages: ChatUIMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;

    const title = message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (title) return title.slice(0, 80);
  }
  return undefined;
}

export const sessionRepository = {
  async ensure(id: string, title = "New chat", projectId?: string) {
    return prisma.conversation.upsert({
      where: { id },
      update: {},
      create: { id, title, projectId: projectId ?? null },
    });
  },

  async ensureFromMessages(id: string, messages: ChatUIMessage[]) {
    return this.ensure(id, messageTitle(messages) ?? "New chat");
  },

  async list() {
    return prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, projectId: true, createdAt: true, updatedAt: true },
    });
  },

  async findWithUIMessages(id: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          where: { kind: "ui" },
          orderBy: { sequence: "asc" },
        },
      },
    });
    if (!conversation) return undefined;

    return {
      session: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: conversation.messages.map((message) => JSON.parse(message.payload) as ChatUIMessage),
    };
  },

  async saveUIMessages(id: string, messages: ChatUIMessage[], title?: string) {
    await saveUIMessages(id, messages, title ?? messageTitle(messages));
  },

  async delete(id: string) {
    await prisma.conversation.deleteMany({ where: { id } });
  },
};
