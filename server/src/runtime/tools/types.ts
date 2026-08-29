import type { ToolAction } from "@mastra/core/tools";
import type { PermissionMode } from "../types.js";

export type RuntimeTool = ToolAction<any, any, any, any, any>;

export type ToolRisk = "low" | "medium" | "high";

export interface ToolPolicy {
  enabled: boolean;
  requireApproval: boolean;
}

/** Tool name → policy. Deliberately open-ended: providers that appear at
 * runtime (MCP servers, knowledge bases) contribute names outside the static
 * descriptor list, and stale project grants must survive provider restarts. */
export type ToolPermissionMap = Record<string, ToolPolicy>;

export type ApprovalDecision =
  | { kind: "approved"; approvalId?: string }
  | { kind: "rejected"; reason?: string }
  | { kind: "timeout" }
  | { kind: "aborted" };

export interface ApprovalBridge {
  request(toolName: string, input: string): Promise<ApprovalDecision>;
}

export type { PermissionMode };
