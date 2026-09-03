import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChatUIMessage } from "../chat-types.js";

/**
 * 附件落盘（参考 PI-Desktop / aime-chat 的做法）：
 *
 * 图片附件保持 data URL 内联（视觉模型直接可读）；其余附件（PDF、Word、
 * 表格等）在进入模型前写入工作区 `attachments/`，模型消息里只保留一条
 * 路径提示，由 agent 按需用 readFile 等文件工具读取。落盘文件名带内容
 * 哈希前缀，多轮重放同一附件时写入幂等、路径稳定。
 *
 * UI 消息（持久化与回显）不受影响：转换只作用于发给模型的副本。
 */

/** 单个附件落盘的大小上限；超出时跳过落盘，仅保留提示。 */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const SAFE_NAME_PATTERN = /[^\p{L}\p{N}._-]+/gu;

export interface MaterializedAttachments {
  /** 发给模型的消息副本（非图片附件已替换为路径提示）。 */
  messages: ChatUIMessage[];
  /** 落盘附件的相对路径列表（用于日志/调试）。 */
  saved: string[];
}

function safeFilename(name: string | undefined, mediaType: string | undefined): string {
  const base = (name ?? "attachment").split(/[\\/]/).at(-1) ?? "attachment";
  const cleaned = base.replace(SAFE_NAME_PATTERN, "_").replace(/^_+|_+$/g, "");
  const safe = cleaned || "attachment";
  // 没有扩展名时从 mediaType 补一个，方便 readFile 按扩展识别文档类型。
  if (!path.extname(safe) && mediaType?.includes("/")) {
    const hint = mediaType.split("/")[1]?.split(";")[0];
    if (hint && /^[\w.+-]{1,10}$/.test(hint)) return `${safe}.${hint}`;
  }
  return safe;
}

async function saveAttachment(
  workspaceRoot: string,
  filename: string,
  base64: string,
): Promise<string | undefined> {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) return undefined;
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const relative = `attachments/${hash}-${filename}`;
  const target = path.join(workspaceRoot, "attachments", `${hash}-${filename}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // 内容寻址：已存在说明此前落盘过，幂等跳过。
  await fs.writeFile(target, bytes, { flag: "wx" }).catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  });
  return relative;
}

/**
 * 把消息中非图片的 file part（data URL）落盘，并在模型副本里替换为
 * 路径提示文本。返回新的消息数组；没有可落盘附件时原样返回（引用不变）。
 */
export async function materializeAttachments(
  messages: ChatUIMessage[],
  workspaceRoot: string,
): Promise<MaterializedAttachments> {
  const targets: Array<{ messageIndex: number; partIndex: number }> = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const parts = messages[messageIndex]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      if (part?.type !== "file") continue;
      if (part.mediaType.startsWith("image/")) continue;
      if (typeof part.url !== "string" || !part.url.startsWith("data:")) continue;
      targets.push({ messageIndex, partIndex });
    }
  }
  if (targets.length === 0) return { messages, saved: [] };

  const cloned = messages.map((message) => ({ ...message, parts: [...message.parts] }));
  const saved: string[] = [];
  for (const { messageIndex, partIndex } of targets) {
    const part = cloned[messageIndex].parts[partIndex];
    if (part?.type !== "file") continue;
    const commaIndex = part.url.indexOf(",");
    if (commaIndex < 0) continue;
    const filename = safeFilename(part.filename, part.mediaType);
    const relative = await saveAttachment(
      workspaceRoot,
      filename,
      part.url.slice(commaIndex + 1),
    ).catch(() => undefined);
    cloned[messageIndex].parts[partIndex] = {
      type: "text",
      text: relative
        ? `[用户上传了附件 ${part.filename ?? filename}，已保存到工作区 ${relative}；需要其内容时可用 readFile 读取该路径]`
        : `[用户上传了附件 ${part.filename ?? filename}，但保存失败；请告知用户重新上传]`,
    } satisfies { type: "text"; text: string };
    if (relative) saved.push(relative);
  }
  return { messages: cloned, saved };
}
