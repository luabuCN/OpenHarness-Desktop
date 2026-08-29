import { type PermissionMode } from "./types.js";

export type ToolRisk = "low" | "medium" | "high";

export interface ToolPolicy {
  enabled: boolean;
  requireApproval: boolean;
}

export type ToolPermissionMap = Record<string, ToolPolicy>;

export interface ToolCatalogEntry {
  name: string;
  label: string;
  description: string;
  risk: ToolRisk;
  mutating: boolean;
  defaultPolicy: ToolPolicy;
}

export const TOOL_CATALOG = [
  {
    name: "announce",
    label: "Announce",
    description: "Report short progress updates during multi-step work.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "readFile",
    label: "Read file",
    description: "Read bounded text file contents with line numbers.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "listFiles",
    label: "List files",
    description: "List files and directories in the workspace.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "glob",
    label: "Glob",
    description: "Find workspace paths with glob patterns.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "grep",
    label: "Grep",
    description: "Search file contents with regular expressions.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "writeFile",
    label: "Write file",
    description: "Create or replace a text file in the workspace.",
    risk: "high",
    mutating: true,
    defaultPolicy: { enabled: true, requireApproval: true },
  },
  {
    name: "editFile",
    label: "Edit file",
    description: "Replace exact text in an existing file.",
    risk: "high",
    mutating: true,
    defaultPolicy: { enabled: true, requireApproval: true },
  },
  {
    name: "mkdir",
    label: "Make directory",
    description: "Create a directory and its parents.",
    risk: "medium",
    mutating: true,
    defaultPolicy: { enabled: true, requireApproval: true },
  },
  {
    name: "bash",
    label: "Shell",
    description: "Run a shell command in the project workspace.",
    risk: "high",
    mutating: true,
    defaultPolicy: { enabled: true, requireApproval: true },
  },
  {
    name: "TaskCreate",
    label: "Create task",
    description: "Create a persistent conversation task.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "TaskGet",
    label: "Get task",
    description: "Read one persistent conversation task.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "TaskList",
    label: "List tasks",
    description: "List persistent conversation tasks.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
  {
    name: "TaskUpdate",
    label: "Update task",
    description: "Update persistent task details and dependencies.",
    risk: "low",
    mutating: false,
    defaultPolicy: { enabled: true, requireApproval: false },
  },
] as const satisfies readonly ToolCatalogEntry[];

export function defaultToolPermissions(options: { readOnly?: boolean } = {}): ToolPermissionMap {
  return Object.fromEntries(
    TOOL_CATALOG.map((tool) => [
      tool.name,
      options.readOnly && tool.mutating
        ? { enabled: false, requireApproval: false }
        : { ...tool.defaultPolicy },
    ]),
  );
}

export function parseToolPermissionMap(raw?: string | null): ToolPermissionMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const permissions: ToolPermissionMap = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { enabled, requireApproval } = value as Record<string, unknown>;
    if (typeof enabled === "boolean" && typeof requireApproval === "boolean") {
      permissions[name] = { enabled, requireApproval };
    }
  }
  return permissions;
}

/** Tools that edit files; they skip approval in auto_edit mode, unlike shell commands. */
const AUTO_EDIT_TOOLS = new Set(["writeFile", "editFile", "mkdir"]);

/**
 * Single source of truth for tool policies: the global permission mode decides
 * the baseline, read-only agents cannot mutate, and explicit "always allow"
 * grants from the project win last.
 */
export function resolveToolPermissions(options: {
  mode: PermissionMode;
  readOnly?: boolean;
  projectOverrides?: ToolPermissionMap;
}): ToolPermissionMap {
  const policies: ToolPermissionMap = Object.fromEntries(
    TOOL_CATALOG.map((tool) => [tool.name, { ...tool.defaultPolicy }]),
  );

  if (options.mode === "auto_edit") {
    for (const name of AUTO_EDIT_TOOLS) {
      if (policies[name]) policies[name] = { ...policies[name], requireApproval: false };
    }
  } else if (options.mode === "full") {
    for (const name of Object.keys(policies)) {
      policies[name] = { ...policies[name], requireApproval: false };
    }
  }

  if (options.readOnly) {
    for (const tool of TOOL_CATALOG) {
      if (tool.mutating) policies[tool.name] = { enabled: false, requireApproval: false };
    }
  }

  for (const [name, override] of Object.entries(options.projectOverrides ?? {})) {
    if (policies[name]) policies[name] = override;
  }

  return policies;
}
