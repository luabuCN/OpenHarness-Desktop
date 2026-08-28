import { prisma } from "../db.js";
import { BUILT_IN_AGENTS, DEFAULT_AGENT_ID } from "./agent-defaults.js";
import {
  TOOL_CATALOG,
  defaultToolPermissions,
  type ToolPermissionMap,
  type ToolPolicy,
} from "./tool-catalog.js";

export interface SubAgentConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolPermissions: ToolPermissionMap;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolPermissions: ToolPermissionMap;
  subAgents: SubAgentConfig[];
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  isActive: boolean;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfigInput {
  name?: string;
  description?: string;
  instructions?: string;
  toolPermissions?: ToolPermissionMap;
  subAgents?: SubAgentConfig[];
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  isActive?: boolean;
}

type AgentRecord = Awaited<ReturnType<typeof prisma.agentConfig.findFirstOrThrow>>;

const knownToolNames = new Set<string>(TOOL_CATALOG.map((tool) => tool.name));

function parseJsonArray(value: string | null): unknown[] {
  try {
    if (value === null) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseProviderModels(value: string | null): Array<{ id: string; enabled: boolean }> {
  return parseJsonArray(value)
    .filter(
      (entry): entry is Record<string, unknown> & { id: string } =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        typeof entry.id === "string",
    )
    .map((entry) => ({
      id: entry.id,
      enabled: entry.enabled !== false,
    }));
}

function parsePermissions(value: string, fallback: ToolPermissionMap): ToolPermissionMap {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) return fallback;
    return normalizePermissions(parsed as Record<string, unknown>, fallback, "agent");
  } catch {
    return fallback;
  }
}

function parseSubAgents(value: string): SubAgentConfig[] {
  return parseJsonArray(value)
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`子 Agent 配置第 ${index + 1} 项无效`);
      }
      const raw = entry as Record<string, unknown>;
      const id = typeof raw.id === "string" ? raw.id : "";
      const fallback = BUILT_IN_AGENTS[0].subAgents[0]?.toolPermissions ?? defaultToolPermissions({ readOnly: true });
      return {
        id,
        name: typeof raw.name === "string" ? raw.name : id,
        description: typeof raw.description === "string" ? raw.description : "",
        instructions: typeof raw.instructions === "string" ? raw.instructions : "",
        toolPermissions: normalizePermissions(
          typeof raw.toolPermissions === "object" && raw.toolPermissions !== null
            ? (raw.toolPermissions as Record<string, unknown>)
            : undefined,
          fallback,
          `sub agent ${id || index + 1}`,
        ),
      };
    })
    .filter((entry) => entry.id);
}

function serializeAgent(agent: AgentRecord): AgentConfig {
  return {
    ...agent,
    toolPermissions: parsePermissions(agent.toolPermissions, defaultToolPermissions()),
    subAgents: parseSubAgents(agent.subAgents),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function normalizePermissions(
  input: Record<string, unknown> | undefined,
  base: ToolPermissionMap,
  context: string,
): ToolPermissionMap {
  const result = { ...base };
  if (!input) return result;

  for (const [name, rawPolicy] of Object.entries(input)) {
    if (!knownToolNames.has(name)) {
      throw new Error(`${context} 包含未知工具：${name}`);
    }
    if (typeof rawPolicy !== "object" || rawPolicy === null) {
      throw new Error(`${context} 的 ${name} 权限无效`);
    }
    const raw = rawPolicy as Record<string, unknown>;
    const policy: Partial<ToolPolicy> = {};
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      throw new Error(`${context} 的 ${name}.enabled 必须是布尔值`);
    }
    if (raw.requireApproval !== undefined && typeof raw.requireApproval !== "boolean") {
      throw new Error(`${context} 的 ${name}.requireApproval 必须是布尔值`);
    }
    if (typeof raw.enabled === "boolean") policy.enabled = raw.enabled;
    if (typeof raw.requireApproval === "boolean") policy.requireApproval = raw.requireApproval;
    result[name] = {
      enabled: policy.enabled ?? base[name]?.enabled ?? false,
      requireApproval:
        policy.requireApproval ?? base[name]?.requireApproval ?? false,
    };
  }
  return result;
}

function normalizeSubAgents(input: SubAgentConfig[] | undefined): SubAgentConfig[] {
  if (!input) return [];
  if (input.length > 10) throw new Error("每个 Agent 最多配置 10 个子 Agent");

  const ids = new Set<string>();
  const fallback = defaultToolPermissions({ readOnly: true });
  return input.map((entry, index) => {
    const id = entry.id?.trim() ?? "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      throw new Error(`子 Agent ${index + 1} 的 ID 只能包含字母、数字、下划线和短横线`);
    }
    if (ids.has(id)) throw new Error(`子 Agent ID 重复：${id}`);
    ids.add(id);

    return {
      id,
      name: entry.name?.trim() || id,
      description: entry.description?.trim() || "Configured sub agent.",
      instructions: entry.instructions?.trim() || "Complete the requested specialist task.",
      toolPermissions: normalizePermissions(entry.toolPermissions, fallback, `子 Agent ${id}`),
    };
  });
}

async function validateModelSelection(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  context: string,
) {
  if (!providerId && !modelId) return;
  if (!providerId || !modelId) {
    throw new Error(`${context} 的默认 Provider 和默认模型必须同时设置`);
  }

  const provider = await prisma.provider.findFirstOrThrow({
    where: { id: providerId },
  }).catch(() => {
    throw new Error(`${context} 的默认 Provider 不存在`);
  });
  if (!provider.isActive) {
    throw new Error(`${context} 的默认 Provider 未启用`);
  }
  const models = parseProviderModels(provider.models);
  if (models.length > 0 && !models.some((model) => model.enabled && model.id === modelId)) {
    throw new Error(`${context} 的默认模型未启用`);
  }
}

async function upsertData(input: AgentConfigInput, current?: AgentRecord) {
  const base = current
    ? parsePermissions(current.toolPermissions, defaultToolPermissions())
    : defaultToolPermissions();
  const selected = input.toolPermissions
    ? normalizePermissions(input.toolPermissions, base, "Agent")
    : base;
  const oldSubAgents = current ? parseSubAgents(current.subAgents) : [];
  const nextSubAgents =
    input.subAgents === undefined
      ? oldSubAgents
      : normalizeSubAgents(input.subAgents);

  const providerId =
    input.defaultProviderId === undefined
      ? current?.defaultProviderId ?? null
      : input.defaultProviderId || null;
  const modelId =
    input.defaultModelId === undefined
      ? current?.defaultModelId ?? null
      : input.defaultModelId || null;
  await validateModelSelection(providerId, modelId, "Agent");

  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description.trim() } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions.trim() } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : current ? {} : { isActive: true }),
    toolPermissions: JSON.stringify(selected),
    subAgents: JSON.stringify(nextSubAgents),
    defaultProviderId: providerId,
    defaultModelId: modelId,
  };
}

class AgentConfigService {
  async list(): Promise<AgentConfig[]> {
    const agents = await prisma.agentConfig.findMany({
      orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
    });
    return agents.map(serializeAgent);
  }

  async get(id: string): Promise<AgentConfig> {
    const agent = await prisma.agentConfig.findUnique({ where: { id } });
    if (!agent) throw new Error("Agent 不存在");
    return serializeAgent(agent);
  }

  async resolve(id?: string): Promise<AgentConfig> {
    if (!id) return this.getDefault();
    const agent = await prisma.agentConfig.findUnique({ where: { id } });
    if (!agent) return this.getDefault();
    if (!agent.isActive) throw new Error("Agent 已停用");
    return serializeAgent(agent);
  }

  async getDefault(): Promise<AgentConfig> {
    const agent =
      (await prisma.agentConfig.findUnique({ where: { id: DEFAULT_AGENT_ID } })) ??
      (await prisma.agentConfig.findFirst({
        where: { isActive: true },
        orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
      }));
    if (!agent) throw new Error("没有可用的 Agent 配置");
    return serializeAgent(agent);
  }

  async create(input: AgentConfigInput): Promise<AgentConfig> {
    if (!input.name?.trim()) throw new Error("Agent 名称不能为空");
    if (!input.description?.trim()) throw new Error("Agent 描述不能为空");
    if (!input.instructions?.trim()) throw new Error("Agent 指令不能为空");
    const agent = await prisma.agentConfig.create({
      data: {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        isActive: input.isActive ?? true,
        ...(await upsertData(input)),
      },
    });
    return serializeAgent(agent);
  }

  async update(id: string, input: AgentConfigInput): Promise<AgentConfig> {
    const current = await prisma.agentConfig.findUnique({ where: { id } });
    if (!current) throw new Error("Agent 不存在");
    const agent = await prisma.agentConfig.update({
      where: { id },
      data: await upsertData(input, current),
    });
    return serializeAgent(agent);
  }

  async remove(id: string): Promise<void> {
    const agent = await prisma.agentConfig.findUnique({ where: { id } });
    if (!agent) throw new Error("Agent 不存在");
    if (agent.isBuiltIn) throw new Error("内置 Agent 不能删除，只能编辑或停用");
    await prisma.project.updateMany({ where: { defaultAgentId: id }, data: { defaultAgentId: null } });
    await prisma.agentConfig.delete({ where: { id } });
  }
}

export const agentConfigService = new AgentConfigService();
