import { prisma } from "../db.js";
import { config } from "../env.js";

export interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  apiBase: string;
  apiKey: string | null;
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
  source: "provider" | "env";
}

export const DEFAULT_MODEL_SETTING_KEY = "defaultModel";

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
      .map((entry) => ({
        id: String(entry.id),
        name: typeof entry.name === "string" ? entry.name : String(entry.id),
        enabled: entry.enabled !== false,
      }));
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
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    apiBase: provider.apiBase,
    apiKey: provider.apiKey,
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
  // Drop a dangling default-model reference pointing at this provider.
  const raw = await prisma.appSetting.findUnique({ where: { key: DEFAULT_MODEL_SETTING_KEY } });
  if (raw) {
    try {
      const setting = JSON.parse(raw.value) as { providerId?: string };
      if (setting.providerId === id) {
        await prisma.appSetting.delete({ where: { key: DEFAULT_MODEL_SETTING_KEY } });
      }
    } catch {
      // Ignore malformed settings; they get overwritten on the next save.
    }
  }
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

export interface DefaultModelSetting {
  providerId: string;
  modelId: string;
}

export async function getDefaultModelSetting(): Promise<DefaultModelSetting | null> {
  const raw = await prisma.appSetting.findUnique({ where: { key: DEFAULT_MODEL_SETTING_KEY } });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.value) as DefaultModelSetting;
    if (typeof parsed.providerId === "string" && typeof parsed.modelId === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function setDefaultModelSetting(setting: DefaultModelSetting | null): Promise<void> {
  if (setting === null) {
    await prisma.appSetting.delete({ where: { key: DEFAULT_MODEL_SETTING_KEY } }).catch(() => undefined);
  } else {
    await prisma.appSetting.upsert({
      where: { key: DEFAULT_MODEL_SETTING_KEY },
      update: { value: JSON.stringify(setting) },
      create: { key: DEFAULT_MODEL_SETTING_KEY, value: JSON.stringify(setting) },
    });
  }
  revision += 1;
}

/**
 * Resolve the model the agent runtime should use. A saved default model
 * (provider + model chosen in settings) wins; otherwise fall back to the
 * environment configuration, mirroring aime-chat's getLanguageModel fallback
 * to createOpenAICompatible with the provider's apiBase/apiKey.
 */
export async function resolveModelConfig(): Promise<ResolvedModelConfig> {
  const setting = await getDefaultModelSetting();
  if (setting) {
    const provider = await prisma.provider.findUnique({ where: { id: setting.providerId } });
    if (provider?.isActive) {
      return {
        baseURL: provider.apiBase,
        apiKey: provider.apiKey ?? undefined,
        model: setting.modelId,
        providerName: provider.name,
        source: "provider",
      };
    }
  }

  return {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    providerName: "openharness",
    source: "env",
  };
}
