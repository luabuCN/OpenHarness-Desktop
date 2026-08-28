export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

export interface SessionSummary {
  id: string;
  title: string;
  projectId?: string | null;
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
    throw new Error(message || `请求失败：${response.status}`);
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
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  isActive: boolean;
  models: ProviderModel[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  description?: string | null;
  defaultAgentId?: string | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalInfo {
  id: string;
  runId: string;
  toolName: string;
  input: string;
  reason?: string | null;
  status: "pending" | "approved" | "rejected" | "timeout" | "cancelled";
  createdAt: string;
}

export interface RunInfo {
  id: string;
  conversationId: string;
  projectId?: string | null;
  agentId?: string | null;
  thinkingMode: string;
  providerId?: string | null;
  modelId?: string | null;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "aborted";
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  approvals: ApprovalInfo[];
}

export interface AgentTaskInfo {
  id: string;
  conversationId: string;
  runId?: string | null;
  taskId: string;
  subject: string;
  description?: string | null;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string | null;
  owner?: string | null;
  metadata: Record<string, unknown>;
  blockedBy: string[];
  blocks: string[];
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

export interface ToolPolicy {
  enabled: boolean;
  requireApproval: boolean;
}

export type ToolPermissionMap = Record<string, ToolPolicy>;

export interface ToolCatalogInfo {
  name: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  mutating: boolean;
  defaultPolicy: ToolPolicy;
}

export interface SubAgentInfo {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolPermissions: ToolPermissionMap;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolPermissions: ToolPermissionMap;
  subAgents: SubAgentInfo[];
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  isActive: boolean;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name?: string;
  description?: string;
  instructions?: string;
  toolPermissions?: ToolPermissionMap;
  subAgents?: SubAgentInfo[];
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  isActive?: boolean;
}

export function listAgents(): Promise<AgentInfo[]> {
  return apiFetch<{ agents: AgentInfo[] }>("/api/agents").then((data) => data.agents);
}

export function listTools(): Promise<ToolCatalogInfo[]> {
  return apiFetch<{ tools: ToolCatalogInfo[] }>("/api/agents/tools").then((data) => data.tools);
}

export function createAgent(input: AgentInput): Promise<AgentInfo> {
  return apiFetch<{ agent: AgentInfo }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.agent);
}

export function updateAgent(id: string, input: AgentInput): Promise<AgentInfo> {
  return apiFetch<{ agent: AgentInfo }>(`/api/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((data) => data.agent);
}

export function deleteAgent(id: string): Promise<void> {
  return apiFetch(`/api/agents/${id}`, { method: "DELETE" }).then(() => undefined);
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

export function fetchSavedProviderModels(providerId: string): Promise<ProviderModel[]> {
  return apiFetch<{ models: ProviderModel[] }>(`/api/providers/${providerId}/fetch-models`, {
    method: "POST",
  }).then((data) => data.models);
}

export function listProjects(): Promise<ProjectInfo[]> {
  return apiFetch<{ projects: ProjectInfo[] }>("/api/projects").then((data) => data.projects);
}

export function createProject(input: Pick<ProjectInfo, "name" | "rootPath"> & Partial<ProjectInfo>): Promise<ProjectInfo> {
  return apiFetch<{ project: ProjectInfo }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.project);
}

export function updateProject(
  id: string,
  input: Partial<Pick<ProjectInfo, "name" | "rootPath"> & ProjectInfo>,
): Promise<ProjectInfo> {
  return apiFetch<{ project: ProjectInfo }>(`/api/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((data) => data.project);
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch(`/api/projects/${id}`, { method: "DELETE" }).then(() => undefined);
}

export function listConversationRuns(conversationId: string): Promise<RunInfo[]> {
  return apiFetch<{ runs: RunInfo[] }>(`/api/runs/conversations/${conversationId}`)
    .then((data) => data.runs);
}

export function listConversationTasks(conversationId: string): Promise<AgentTaskInfo[]> {
  return apiFetch<{ tasks: AgentTaskInfo[] }>(`/api/conversations/${conversationId}/tasks`)
    .then((data) => data.tasks);
}

export function decideApproval(
  runId: string,
  approvalId: string,
  action: "approve" | "reject",
): Promise<void> {
  return apiFetch(`/api/runs/${runId}/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify({ action }),
  }).then(() => undefined);
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
