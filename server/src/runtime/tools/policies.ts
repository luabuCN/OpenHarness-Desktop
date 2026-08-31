import type { PermissionMode } from "../types.js";
import type { ToolDescriptor } from "./registry.js";
import type { ToolPermissionMap, ToolPolicy } from "./types.js";

/** Policy applied to any tool without a descriptor (e.g. an MCP tool that
 * connected after permissions were resolved): usable, but always gated. */
export const UNKNOWN_TOOL_POLICY: ToolPolicy = { enabled: true, requireApproval: true };

/** Tools that edit files; they skip approval in auto_edit mode, unlike shell commands. */
const AUTO_EDIT_TOOLS = new Set(["writeFile", "editFile", "mkdir"]);

/** High-impact tools that no global permission mode may auto-approve;
 * only an explicit per-project "always allow" grant can skip their prompt. */
const ALWAYS_APPROVE_TOOLS = new Set(["gitPush"]);

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

export interface ResolveToolPoliciesInput {
  descriptors: ToolDescriptor[];
  mode: PermissionMode;
  readOnly?: boolean;
  /** Explicit per-tool grants persisted on the project ("always allow"). */
  overrides?: ToolPermissionMap;
  /** Tools switched off globally on the tools settings page. */
  disabledTools?: ReadonlySet<string>;
}

/**
 * Single source of truth for tool policies: descriptor defaults decide the
 * baseline, the global permission mode relaxes approvals, read-only agents
 * cannot mutate, explicit project grants win over both, and the global kill
 * switch wins over everything. Names outside the descriptor set keep their
 * override so grants survive providers appearing and disappearing.
 */
export function resolveToolPolicies(input: ResolveToolPoliciesInput): ToolPermissionMap {
  const policies: ToolPermissionMap = {};
  for (const descriptor of input.descriptors) {
    policies[descriptor.name] = { ...descriptor.defaultPolicy };
  }
  for (const name of Object.keys(input.overrides ?? {})) {
    if (!policies[name]) policies[name] = { ...UNKNOWN_TOOL_POLICY };
  }

  if (input.mode === "auto_edit") {
    for (const name of AUTO_EDIT_TOOLS) {
      if (policies[name]) policies[name] = { ...policies[name], requireApproval: false };
    }
  } else if (input.mode === "full") {
    for (const name of Object.keys(policies)) {
      policies[name] = { ...policies[name], requireApproval: false };
    }
  }

  for (const name of ALWAYS_APPROVE_TOOLS) {
    if (policies[name]) policies[name] = { ...policies[name], requireApproval: true };
  }

  if (input.readOnly) {
    for (const descriptor of input.descriptors) {
      if (descriptor.mutating) {
        policies[descriptor.name] = { enabled: false, requireApproval: false };
      }
    }
  }

  for (const [name, override] of Object.entries(input.overrides ?? {})) {
    policies[name] = { ...override };
  }

  for (const name of input.disabledTools ?? []) {
    if (policies[name]) policies[name] = { ...policies[name], enabled: false };
  }

  return policies;
}
