export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthInfo {
  status: string;
  model?: string;
  modelSource?: string;
  workspace: boolean;
  bash: boolean;
}

export type ThinkingMode = "fast" | "deep";

export interface FileEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export function fetchHealth(): Promise<HealthInfo> {
  return apiFetch<HealthInfo>("/health");
}

export async function listFiles(path: string): Promise<FileEntry[]> {
  const data = await apiFetch<{ path: string; entries: FileEntry[] }>(
    `/api/files?path=${encodeURIComponent(path)}`,
  );
  return data.entries;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

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

export interface ProviderInfo {
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

export interface ProviderTypeInfo {
  id: string;
  name: string;
  api?: string;
}

export interface ProviderInput {
  name: string;
  type: string;
  apiBase: string;
  apiKey?: string | null;
  isActive?: boolean;
  models?: ProviderModel[];
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export function listProviders(): Promise<ProviderInfo[]> {
  return apiFetch<{ providers: ProviderInfo[] }>("/api/providers").then((data) => data.providers);
}

export function listProviderTypes(): Promise<ProviderTypeInfo[]> {
  return apiFetch<{ types: ProviderTypeInfo[] }>("/api/providers/types").then((data) => data.types);
}

export function fetchRemoteModels(apiBase: string, apiKey?: string | null): Promise<ProviderModel[]> {
  return apiFetch<{ models: ProviderModel[] }>("/api/providers/fetch-models", {
    method: "POST",
    body: JSON.stringify({ apiBase, apiKey }),
  }).then((data) => data.models);
}

export function createProvider(input: ProviderInput): Promise<ProviderInfo> {
  return apiFetch<{ provider: ProviderInfo }>("/api/providers", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.provider);
}

export function updateProvider(id: string, input: Partial<ProviderInput>): Promise<ProviderInfo> {
  return apiFetch<{ provider: ProviderInfo }>(`/api/providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((data) => data.provider);
}

export function deleteProvider(id: string): Promise<void> {
  return apiFetch(`/api/providers/${id}`, { method: "DELETE" }).then(() => undefined);
}
