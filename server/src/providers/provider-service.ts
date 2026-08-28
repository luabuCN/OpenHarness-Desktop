import { prisma } from "../db.js";

export interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
  isCustom?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  release_date?: string;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
}

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  apiBase: string;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  isActive: boolean;
  models: ProviderModel[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInput {
  name: string;
  type: string;
  apiBase: string;
  apiKey?: string | null;
  isActive?: boolean;
  models?: ProviderModel[];
}

export interface ResolvedModelConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
  providerName: string;
  source: "provider";
}

/**
 * Bumped on every mutation so the agent runtime can cheaply detect that the
 * model wiring changed and rebuild its cached agents (same idea as
 * aime-chat's ProvidersManager, which re-resolves models per request).
 */
let revision = 0;

export function getProviderRevision(): number {
  return revision;
}

function parseModels(raw: string | null): ProviderModel[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string",
      )
      .map((entry) => {
        const model: ProviderModel = {
          id: String(entry.id),
          name: typeof entry.name === "string" ? entry.name : String(entry.id),
          enabled: entry.enabled !== false,
        };
        if (typeof entry.isCustom === "boolean") model.isCustom = entry.isCustom;
        if (typeof entry.reasoning === "boolean") model.reasoning = entry.reasoning;
        if (typeof entry.tool_call === "boolean") model.tool_call = entry.tool_call;
        if (typeof entry.release_date === "string") model.release_date = entry.release_date;
        if (typeof entry.limit === "object" && entry.limit !== null) {
          const rawLimit = entry.limit as { context?: unknown; output?: unknown };
          model.limit = {
            ...(typeof rawLimit.context === "number" ? { context: rawLimit.context } : {}),
            ...(typeof rawLimit.output === "number" ? { output: rawLimit.output } : {}),
          };
        }
        if (typeof entry.modalities === "object" && entry.modalities !== null) {
          const rawModalities = entry.modalities as { input?: unknown; output?: unknown };
          model.modalities = {
            ...(Array.isArray(rawModalities.input)
              ? { input: rawModalities.input.filter((value): value is string => typeof value === "string") }
              : {}),
            ...(Array.isArray(rawModalities.output)
              ? { output: rawModalities.output.filter((value): value is string => typeof value === "string") }
              : {}),
          };
        }
        return model;
      });
  } catch {
    return [];
  }
}

function toView(provider: {
  id: string;
  name: string;
  type: string;
  apiBase: string;
  apiKey: string | null;
  isActive: boolean;
  models: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProviderView {
  const apiKeyMasked = provider.apiKey
    ? provider.apiKey.length <= 8
      ? "*".repeat(provider.apiKey.length)
      : `${provider.apiKey.slice(0, 4)}${"*".repeat(Math.min(12, provider.apiKey.length - 8))}${provider.apiKey.slice(-4)}`
    : null;
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    apiBase: provider.apiBase,
    hasApiKey: Boolean(provider.apiKey),
    apiKeyMasked,
    isActive: provider.isActive,
    models: parseModels(provider.models),
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export async function listProviders(): Promise<ProviderView[]> {
  const providers = await prisma.provider.findMany({ orderBy: { createdAt: "asc" } });
  return providers.map(toView);
}

export async function createProvider(input: ProviderInput): Promise<ProviderView> {
  const provider = await prisma.provider.create({
    data: {
      name: input.name.trim(),
      type: input.type,
      apiBase: normalizeApiBase(input.apiBase),
      apiKey: input.apiKey?.trim() ? input.apiKey.trim() : null,
      isActive: input.isActive ?? true,
      models: input.models ? JSON.stringify(input.models) : null,
    },
  });
  revision += 1;
  return toView(provider);
}

export async function updateProvider(id: string, input: Partial<ProviderInput>): Promise<ProviderView> {
  const provider = await prisma.provider.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.apiBase !== undefined ? { apiBase: normalizeApiBase(input.apiBase) } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey?.trim() ? input.apiKey.trim() : null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.models !== undefined ? { models: JSON.stringify(input.models) } : {}),
    },
  });
  revision += 1;
  return toView(provider);
}

export async function deleteProvider(id: string): Promise<void> {
  await prisma.provider.delete({ where: { id } });
  revision += 1;
}

function normalizeApiBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "");
}

/**
 * Pull the full model catalog from an OpenAI-compatible `/models` endpoint —
 * the same approach aime-chat's providers use via `openaiClient.models.list()`,
 * but done with plain fetch so no extra SDK dependency is needed server-side.
 */
export async function fetchRemoteModels(
  apiBase: string,
  apiKey?: string | null,
): Promise<ProviderModel[]> {
  const url = `${normalizeApiBase(apiBase)}/models`;
  const response = await fetch(url, {
    headers: apiKey?.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {},
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GET ${url} responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const payload = (await response.json()) as unknown;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : [];

  return entries
    .filter(
      (entry): entry is { id: string } =>
        typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string",
    )
    .map((entry) => ({ id: entry.id, name: entry.id, enabled: true }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

interface ConfiguredModelDefault {
  providerId?: string | null;
  modelId?: string | null;
}

export async function resolveConfiguredSelection(
  ...defaults: Array<ConfiguredModelDefault | undefined>
): Promise<ModelSelection | undefined> {
  const providers = await prisma.provider.findMany({ orderBy: { createdAt: "asc" } });
  const active = providers.filter((provider) => provider.isActive);
  const isEnabledModel = (providerId: string, modelId: string) => {
    const provider = active.find((entry) => entry.id === providerId);
    if (!provider) return false;
    const models = parseModels(provider.models);
    return models.length === 0 || models.some((model) => model.enabled && model.id === modelId);
  };
  for (const entry of defaults) {
    if (entry?.providerId && entry.modelId && isEnabledModel(entry.providerId, entry.modelId)) {
      return { providerId: entry.providerId, modelId: entry.modelId };
    }
  }

  const modelOnly = defaults.find((entry) => !entry?.providerId && entry?.modelId);
  if (modelOnly?.modelId) {
    const provider = active.find((entry) =>
      parseModels(entry.models).some((model) => model.enabled && model.id === modelOnly.modelId),
    );
    if (provider) return { providerId: provider.id, modelId: modelOnly.modelId };
  }
  return undefined;
}

/**
 * Resolve an explicit per-request model selection (provider + model chosen
 * in the chat prompt input). The provider must exist and be active.
 */
export async function resolveSelectionConfig(selection: ModelSelection): Promise<ResolvedModelConfig> {
  const provider = await prisma.provider.findUnique({ where: { id: selection.providerId } });
  if (!provider?.isActive) {
    throw new Error("所选供应商不可用，请在设置中检查供应商配置");
  }
  const enabledModels = parseModels(provider.models);
  if (enabledModels.length > 0 && !enabledModels.some((model) => model.enabled && model.id === selection.modelId)) {
    throw new Error("所选模型未启用，请在设置中重新选择模型");
  }
  return {
    baseURL: provider.apiBase,
    apiKey: provider.apiKey ?? undefined,
    model: selection.modelId,
    providerName: provider.name,
    source: "provider",
  };
}

/**
 * Resolve the model the agent runtime should use when a request carries no
 * explicit selection. Models always come from the saved provider
 * configuration (never from .env): the first enabled model of the first
 * active provider wins. Throws when nothing is configured so callers can
 * surface a clear "configure a provider" error.
 */
export async function resolveModelConfig(): Promise<ResolvedModelConfig> {
  const providers = await prisma.provider.findMany({ orderBy: { createdAt: "asc" } });
  for (const provider of providers) {
    if (!provider.isActive) continue;
    const firstEnabled = parseModels(provider.models).find((model) => model.enabled);
    if (firstEnabled) {
      return {
        baseURL: provider.apiBase,
        apiKey: provider.apiKey ?? undefined,
        model: firstEnabled.id,
        providerName: provider.name,
        source: "provider",
      };
    }
  }

  throw new Error("未配置模型：请在设置中添加模型供应商并选择默认模型");
}
