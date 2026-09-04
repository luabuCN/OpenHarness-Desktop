import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../db.js";
import { skillsDir } from "../env.js";
import type { ChatUIMessage } from "../chat-types.js";

/**
 * 技能（Skills）：SKILL.md 指令文档目录，参考 PI-Desktop 的目录式设计。
 *
 * 四个扫描来源 —— 自定义（应用数据目录 skills/，可在设置里增删改）、
 * Claude Code（~/.claude/skills）、Codex（~/.codex/skills）、
 * cc-switch（~/.cc-switch/skills）。外部来源只读，仅可启停。
 *
 * 运行时两条通路（都只针对"已启用"的技能）：
 * 1. 目录注入：把每个启用技能的目录传给 Mastra Agent 的 skills 参数，
 *    由其注入 <available_skills> 目录并提供 skill / skill_read 工具；
 * 2. 显式调用：输入框里 "/<id> 参数" 发送时在模型副本里展开技能正文，
 *    UI 历史仍保留紧凑的斜杠命令文本。
 */

export type SkillSource = "custom" | "claude" | "codex" | "ccswitch";

export interface SkillSourceDir {
  source: SkillSource;
  label: string;
  dir: string;
}

export interface SkillInfo {
  /** 稳定主键 "<source>:<id>"。 */
  key: string;
  source: SkillSource;
  /** 斜杠命令用的短 id（来自 front-matter name 或目录名）。 */
  id: string;
  /** 展示名（默认同 id）。 */
  name: string;
  description?: string;
  /** 技能目录（包含 SKILL.md）。 */
  dir: string;
  /** SKILL.md 绝对路径。 */
  path: string;
  enabled: boolean;
  isCustom: boolean;
}

export interface SkillBody {
  name: string;
  description?: string;
  body: string;
}

/** 单个 SKILL.md 的大小上限，超限跳过（与 PI-Desktop 一致）。 */
const MAX_SKILL_BYTES = 128 * 1024;
/** 每个来源最多收录的技能数。 */
const MAX_SKILLS_PER_SOURCE = 128;
/** description 截断长度。 */
const MAX_DESCRIPTION_CHARS = 400;

const home = os.homedir();

export const SKILL_SOURCES: SkillSourceDir[] = [
  { source: "custom", label: "自定义", dir: skillsDir },
  { source: "claude", label: "Claude", dir: path.join(home, ".claude", "skills") },
  { source: "codex", label: "Codex", dir: path.join(home, ".codex", "skills") },
  { source: "ccswitch", label: "cc-switch", dir: path.join(home, ".cc-switch", "skills") },
];

/** 同名技能跨来源冲突时的优先级（自定义最高）。 */
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  custom: 0,
  claude: 1,
  codex: 2,
  ccswitch: 3,
};

interface ParsedSkillDoc {
  name?: string;
  description?: string;
  body: string;
}

/** 极简 front-matter 解析：--- 包裹的 "key: value" 行，只认 name/description。 */
export function parseSkillDoc(raw: string): ParsedSkillDoc {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!match) return { body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return {
    name: meta.name?.slice(0, 120) || undefined,
    description: meta.description?.slice(0, MAX_DESCRIPTION_CHARS) || undefined,
    body: raw.slice(match[0].length),
  };
}

/** id 规则：小写、字母数字（含中文）/短横线，兼容中文命名。 */
export function slugifySkillId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function fallbackDescription(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.slice(0, MAX_DESCRIPTION_CHARS);
  }
  return undefined;
}

async function scanSource(source: SkillSourceDir): Promise<SkillInfo[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(source.dir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在（未装对应 CLI）视为空来源
  }
  const found = new Map<string, SkillInfo>();
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (found.size >= MAX_SKILLS_PER_SOURCE) break;
    const dir = path.join(source.dir, entry.name);
    const skillPath = path.join(dir, "SKILL.md");
    let raw: string;
    try {
      // Claude Code 会把技能以符号链接放进 ~/.claude/skills，dirent 类型
      // 是 symlink；stat 顺链解析后再判断目录。
      if (entry.isSymbolicLink()) {
        if (!(await fsp.stat(dir).then((s) => s.isDirectory()).catch(() => false))) continue;
      } else if (!entry.isDirectory()) {
        continue;
      }
      const stat = await fsp.stat(skillPath);
      if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue;
      raw = await fsp.readFile(skillPath, "utf8");
    } catch {
      continue;
    }
    const doc = parseSkillDoc(raw);
    const id = slugifySkillId(doc.name ?? entry.name) || slugifySkillId(entry.name);
    if (!id || found.has(id)) continue;
    found.set(id, {
      key: `${source.source}:${id}`,
      source: source.source,
      id,
      name: doc.name ?? id,
      description: doc.description ?? fallbackDescription(doc.body),
      dir,
      path: skillPath,
      // 启用状态在 list() 里合并数据库偏好，这里先给默认值。
      enabled: true,
      isCustom: source.source === "custom",
    });
  }
  return [...found.values()];
}

class SkillService {
  /** 扫描全部来源并合并数据库里的启用偏好；顺带清理磁盘上已消失的偏好行。 */
  async list(): Promise<{ skills: SkillInfo[]; sources: SkillSourceDir[] }> {
    const [scanned, records] = await Promise.all([
      this.scanAll(),
      prisma.skillRecord.findMany(),
    ]);
    const state = new Map(records.map((row) => [row.key, row]));
    const liveKeys = new Set(scanned.map((skill) => skill.key));
    const stale = records.filter((row) => !liveKeys.has(row.key));
    if (stale.length > 0) {
      await prisma.skillRecord
        .deleteMany({ where: { key: { in: stale.map((row) => row.key) } } })
        .catch(() => undefined);
    }
    const sources = await Promise.all(
      SKILL_SOURCES.map(async (item) => ({
        ...item,
        exists: await fsp
          .access(item.dir)
          .then(() => true)
          .catch(() => false),
      })),
    );
    return {
      skills: scanned.map((skill) => ({
        ...skill,
        enabled: state.get(skill.key)?.enabled ?? true,
      })),
      sources,
    };
  }

  private async scanAll(): Promise<SkillInfo[]> {
    const groups = await Promise.all(SKILL_SOURCES.map((item) => scanSource(item)));
    return groups.flat();
  }

  /** 启用的技能；同名时按来源优先级去重（自定义 > Claude > Codex > cc-switch）。 */
  async activeSkills(): Promise<SkillInfo[]> {
    const { skills } = await this.list();
    const enabled = skills.filter((skill) => skill.enabled);
    const byName = new Map<string, SkillInfo>();
    for (const skill of enabled) {
      const name = skill.name.toLowerCase();
      const existing = byName.get(name);
      if (!existing || SOURCE_PRIORITY[skill.source] < SOURCE_PRIORITY[existing.source]) {
        byName.set(name, skill);
      }
    }
    return [...byName.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 读取技能正文（去 front-matter）。 */
  async readBody(key: string): Promise<SkillBody> {
    const skill = await this.findSkill(key);
    if (!skill) throw new Error("技能不存在");
    const raw = await fsp.readFile(skill.path, "utf8");
    const doc = parseSkillDoc(raw);
    return { name: doc.name ?? skill.name, description: doc.description, body: doc.body.trim() };
  }

  private async findSkill(key: string): Promise<SkillInfo | undefined> {
    const [source, ...rest] = key.split(":");
    const id = rest.join(":");
    const dir = SKILL_SOURCES.find((item) => item.source === source);
    if (!dir || !id) return undefined;
    return (await scanSource(dir)).find((skill) => skill.id === id);
  }

  /** 创建自定义技能：写入 <skillsDir>/<id>/SKILL.md。 */
  async create(input: { name: string; description?: string; body: string }): Promise<SkillInfo> {
    const name = input.name.trim();
    if (!name) throw new Error("名称不能为空");
    const body = input.body.trim();
    if (!body) throw new Error("技能内容不能为空");
    const id = slugifySkillId(name);
    if (!id) throw new Error("名称需包含字母、数字或中文");
    const existing = await this.findSkill(`custom:${id}`);
    if (existing) throw new Error(`已存在同名技能「${id}」`);
    const dir = path.join(skillsDir, id);
    await fsp.mkdir(dir, { recursive: true });
    const description = input.description?.trim();
    const frontMatter = [
      "---",
      `name: ${name.replace(/\r?\n/g, " ")}`,
      ...(description ? [`description: ${description.replace(/\r?\n/g, " ")}`] : []),
      "---",
      "",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(dir, "SKILL.md"), frontMatter + body + "\n", "utf8");
    const skill = (await this.findSkill(`custom:${id}`))!;
    await prisma.skillRecord.upsert({
      where: { key: skill.key },
      create: { key: skill.key, source: skill.source, enabled: true },
      update: { enabled: true },
    });
    return { ...skill, enabled: true };
  }

  /** 更新自定义技能（名称/描述/正文）或任意技能的启用状态。 */
  async update(
    key: string,
    input: { name?: string; description?: string; body?: string; enabled?: boolean },
  ): Promise<SkillInfo> {
    if (input.enabled !== undefined) {
      await prisma.skillRecord.upsert({
        where: { key },
        create: { key, source: key.split(":")[0], enabled: input.enabled },
        update: { enabled: input.enabled },
      });
    }
    const wantsContentChange =
      input.name !== undefined || input.description !== undefined || input.body !== undefined;
    if (!wantsContentChange) {
      const { skills } = await this.list();
      const updated = skills.find((skill) => skill.key === key);
      if (!updated) throw new Error("技能不存在");
      return updated;
    }

    const skill = await this.findSkill(key);
    if (!skill) throw new Error("技能不存在");
    if (!skill.isCustom) throw new Error("仅自定义技能支持编辑内容，外部技能请直接修改源文件");
    const current = await this.readBody(key);
    const nextName = input.name?.trim() || current.name;
    const nextBody = input.body !== undefined ? input.body.trim() : current.body;
    if (!nextBody) throw new Error("技能内容不能为空");
    const description =
      input.description !== undefined ? input.description.trim() : current.description;
    const frontMatter = [
      "---",
      `name: ${nextName.replace(/\r?\n/g, " ")}`,
      ...(description ? [`description: ${description.replace(/\r?\n/g, " ")}`] : []),
      "---",
      "",
      "",
    ].join("\n");
    await fsp.writeFile(skill.path, frontMatter + nextBody + "\n", "utf8");
    const { skills } = await this.list();
    const updated = skills.find((item) => item.key === key);
    if (!updated) throw new Error("技能文件写入后未能重新识别");
    return updated;
  }

  /** 删除自定义技能（整目录）。外部来源技能不可删除。 */
  async remove(key: string): Promise<void> {
    const skill = await this.findSkill(key);
    if (!skill) throw new Error("技能不存在");
    if (!skill.isCustom) throw new Error("外部来源技能不支持在应用内删除");
    const relative = path.relative(skillsDir, skill.dir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("拒绝删除技能目录之外的路径");
    }
    await fsp.rm(skill.dir, { recursive: true, force: true });
    await prisma.skillRecord.deleteMany({ where: { key } }).catch(() => undefined);
  }

  /**
   * 显式调用展开：最后一条用户消息以 "/<id> 参数" 开头且命中启用技能时，
   * 在发给模型的副本里把命令替换为技能正文（UI/持久化消息保持原样）。
   */
  async applyInvocation(messages: ChatUIMessage[]): Promise<ChatUIMessage[]> {
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return messages;
    const last = messages[lastUserIndex];
    const firstTextPart = last.parts.find(
      (part): part is { type: "text"; text: string } => part.type === "text",
    );
    if (!firstTextPart) return messages;
    const match = /^\/([^\s/]+)\s*([\s\S]*)$/.exec(firstTextPart.text.trimStart());
    if (!match) return messages;
    const { skills } = await this.list();
    const active = skills.filter((skill) => skill.enabled);
    const token = match[1].toLowerCase();
    const skill = active.find(
      (item) => item.id.toLowerCase() === token || item.name.toLowerCase() === token,
    );
    if (!skill) return messages;

    let doc: SkillBody;
    try {
      doc = await this.readBody(skill.key);
    } catch {
      return messages;
    }
    const rest = match[2].trim();
    const expanded = [
      `用户通过 /${skill.id} 显式调用了技能「${skill.name}」。请严格遵循以下技能指令处理本轮请求。`,
      "",
      `<skill name="${skill.name}" id="${skill.id}">`,
      doc.body,
      `</skill>`,
      "",
      rest ? `用户补充说明：${rest}` : "（用户未提供补充说明，按技能指令开始执行。）",
    ].join("\n");

    const parts = last.parts.map((part) =>
      part === firstTextPart ? { ...part, text: expanded } : part,
    );
    return messages.map((message, index) =>
      index === lastUserIndex ? { ...message, parts } : message,
    );
  }
}

export const skillService = new SkillService();
