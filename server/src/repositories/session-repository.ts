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
    // 附带每个会话当前进行中的运行状态，侧栏据此渲染"后台运行中"状态点。
    // 归档会话与归档项目下的会话都不在侧栏展示（设置页的归档分区单独列出）。
    const conversations = await prisma.conversation.findMany({
      where: {
        archivedAt: null,
        OR: [{ projectId: null }, { project: { archivedAt: null } }],
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        projectId: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        runs: {
          where: { status: { in: ["queued", "running", "waiting_approval"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    return conversations.map(({ runs, ...session }) => ({
      ...session,
      activeRunStatus: runs[0]?.status ?? null,
    }));
  },

  /** 归档会话列表（设置页归档分区用），按归档时间倒序。 */
  async listArchived() {
    return prisma.conversation.findMany({
      where: { archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      select: {
        id: true,
        title: true,
        projectId: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
      },
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
    // 手动重命名过的会话不再被自动标题覆盖。
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { titleLocked: true },
    });
    const nextTitle = conversation?.titleLocked
      ? undefined
      : title ?? messageTitle(messages);
    await saveUIMessages(id, messages, nextTitle);
  },

  /**
   * 更新会话元数据：手动重命名（锁定标题）、置顶/取消置顶、归档/恢复。
   * 重命名同时写 titleLocked，之后保存消息不会再覆盖标题。
   */
  async update(
    id: string,
    input: { title?: string; pinned?: boolean; archived?: boolean },
  ) {
    const data: { title?: string; titleLocked?: boolean; pinned?: boolean; archivedAt?: Date | null } = {};
    if (input.title !== undefined) {
      data.title = input.title;
      data.titleLocked = true;
    }
    if (input.pinned !== undefined) data.pinned = input.pinned;
    if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;

    // 会话可能尚未落库（前端本地生成的 id 在首条消息前不存在），
    // 先按默认行建立再更新，保证侧栏操作不因 404 报错。
    await prisma.conversation.upsert({
      where: { id },
      update: {},
      create: { id },
    });
    return prisma.conversation.update({ where: { id }, data });
  },

  async delete(id: string) {
    await prisma.conversation.deleteMany({ where: { id } });
  },
};
