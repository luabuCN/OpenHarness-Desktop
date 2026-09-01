import { UNKNOWN_TOOL_POLICY } from "./policies.js";
import type {
  ApprovalBridge,
  PermissionMode,
  ToolPermissionMap,
  ToolPolicy,
} from "./types.js";

/** 面板预览通知：工具执行后希望在内置浏览器中打开的地址。 */
export interface PreviewNotification {
  url: string;
  kind: "file" | "server";
  label?: string;
}

export interface RunContextInit {
  conversationId: string;
  runId?: string;
  projectId?: string;
  /** Filesystem root every workspace tool resolves paths against. */
  workspacePath: string;
  agentId?: string;
  permissionMode: PermissionMode;
  readOnly: boolean;
  /** Raw project grants, kept so sub-agent contexts can re-resolve policies. */
  permissionOverrides: ToolPermissionMap;
  disabledTools: ReadonlySet<string>;
  /** Resolved policies for this run; computed via ToolProviderRegistry.policiesFor. */
  toolPolicies: ToolPermissionMap;
  approvals?: ApprovalBridge;
  signal?: AbortSignal;
  /** True for derived sub-agent contexts (no per-conversation task tools). */
  subAgent?: boolean;
  /** 向当前聊天流推送 data-oh:preview.open 数据部件。由 agent-runtime 在
   * 流式执行回调里注入；工具用它请求前端在内置浏览器面板中打开预览。 */
  notifyPreview?: (data: PreviewNotification) => void;
}

/**
 * Per-run state bag handed to every tool provider (aime-chat's RequestContext
 * equivalent). One object per run; sub-agents derive their own copy with a
 * different readOnly posture through ToolProviderRegistry.deriveContext.
 */
export interface RunContext extends RunContextInit {
  policyFor(name: string): ToolPolicy;
}

export function createRunContext(init: RunContextInit): RunContext {
  return {
    ...init,
    policyFor: (name) => init.toolPolicies[name] ?? UNKNOWN_TOOL_POLICY,
  };
}
