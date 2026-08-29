import { prisma } from "../db.js";
import { sessionRepository } from "../repositories/session-repository.js";
import type { ChatUIMessage } from "../chat-types.js";
import type { ModelSelection } from "../providers/provider-service.js";
import { parseToolPermissionMap, type ApprovalDecision } from "./tools/index.js";

export const ACTIVE_RUN_STATUSES = ["queued", "running", "waiting_approval"] as const;

interface StartRunInput {
  conversationId: string;
  messages: ChatUIMessage[];
  projectId?: string;
  agentId?: string;
  thinkingMode: string;
  permissionMode: string;
  selection?: ModelSelection;
}

interface ActiveRunHandle {
  abort(): void;
  approvals: InteractiveApprovalBridge;
}

function messageTitle(messages: ChatUIMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const title = message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (title) return title.slice(0, 80);
  }
  return undefined;
}

class InteractiveApprovalBridge {
  private static readonly TIMEOUT_MS = 5 * 60 * 1_000;

  /** Tool names the user chose to always allow; skips new approval records for the rest of the run. */
  private readonly alwaysAllowed = new Set<string>();

  constructor(
    private readonly runId: string,
    private readonly signal?: AbortSignal,
  ) {}

  allowAlways(toolName: string) {
    this.alwaysAllowed.add(toolName);
  }

  async request(toolName: string, input: string): Promise<ApprovalDecision> {
    if (this.alwaysAllowed.has(toolName)) {
      return { kind: "approved" };
    }
    const approval = await prisma.toolApproval.create({
      data: { runId: this.runId, toolName, input },
    });
    await runService.updateStatus(this.runId, "waiting_approval");

    const deadline = Date.now() + InteractiveApprovalBridge.TIMEOUT_MS;
    while (Date.now() < deadline && !this.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const decision = await prisma.toolApproval.findUnique({ where: { id: approval.id } });
      if (!decision) break;
      if (decision.status === "approved") {
        await runService.updateStatus(this.runId, "running");
        return { kind: "approved", approvalId: decision.id };
      }
      if (decision.status === "rejected") {
        await runService.updateStatus(this.runId, "running");
        return { kind: "rejected", reason: decision.decisionBy ? `by ${decision.decisionBy}` : undefined };
      }
    }

    if (this.signal?.aborted) {
      await prisma.toolApproval.update({
        where: { id: approval.id },
        data: { status: "cancelled", decidedAt: new Date() },
      });
      return { kind: "aborted" };
    }

    await prisma.toolApproval.update({
      where: { id: approval.id },
      data: { status: "timeout", decidedAt: new Date() },
    });
    await runService.updateStatus(this.runId, "running");
    return { kind: "timeout" };
  }
}

class ThreadRunService {
  private readonly activeRuns = new Map<string, ActiveRunHandle>();

  async start(input: StartRunInput) {
    // Persist the user's current input before streaming so a browser reload or
    // disconnect cannot lose the turn that initiated the run.
    if (!input.messages || input.messages.length === 0) {
      throw new Error("A chat run requires at least one message.");
    }
    await sessionRepository.saveUIMessages(
      input.conversationId,
      input.messages,
      messageTitle(input.messages),
    );
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: input.projectId ? { projectId: input.projectId } : {},
    });

    return prisma.threadRun.create({
      data: {
        conversationId: input.conversationId,
        projectId: input.projectId ?? null,
        thinkingMode: input.thinkingMode,
        permissionMode: input.permissionMode,
        agentId: input.agentId ?? null,
        providerId: input.selection?.providerId ?? null,
        modelId: input.selection?.modelId ?? null,
        status: "running",
        startedAt: new Date(),
      },
    });
  }

  registerAbortSource(runId: string, externalSignal: AbortSignal) {
    const controller = new AbortController();
    const approvals = new InteractiveApprovalBridge(runId, controller.signal);
    const handle: ActiveRunHandle = {
      abort: () => controller.abort(),
      approvals,
    };
    this.activeRuns.set(runId, handle);

    const onAbort = () => {
      void this.finish(runId, "aborted").catch(console.error);
    };
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });

    return {
      signal: controller.signal,
      approvals,
      cleanup: () => {
        externalSignal.removeEventListener("abort", onAbort);
        this.activeRuns.delete(runId);
      },
    };
  }

  /**
   * "Always allow" for one tool: suppress further prompts in the current run and,
   * when the run belongs to a project, persist the grant so later runs skip asking too.
   */
  async allowAlways(runId: string, toolName: string) {
    this.activeRuns.get(runId)?.approvals.allowAlways(toolName);

    const run = await prisma.threadRun.findUnique({
      where: { id: runId },
      select: { projectId: true },
    });
    if (!run?.projectId) return;

    const project = await prisma.project.findUnique({
      where: { id: run.projectId },
      select: { toolPermissions: true },
    });
    const permissions = parseToolPermissionMap(project?.toolPermissions);
    permissions[toolName] = { enabled: true, requireApproval: false };
    await prisma.project.update({
      where: { id: run.projectId },
      data: { toolPermissions: JSON.stringify(permissions) },
    });
  }

  async appendTransition(runId: string, eventType: string, payload: unknown) {
    const transitionTypes = new Set([
      "start", "start-step", "finish-step", "finish", "abort", "error",
      "reasoning-start", "reasoning-end",
      "tool-input-available", "tool-input-error",
      "tool-approval-request",
      "tool-output-available", "tool-output-error",
      "tool-output-denied",
    ]);
    if (!transitionTypes.has(eventType)) return;

    const aggregate = await prisma.runEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    const sequence = (aggregate._max.sequence ?? -1) + 1;
    await prisma.runEvent.create({
      data: { runId, sequence, eventType, payload: JSON.stringify(payload) },
    });
  }

  async saveStep(conversationId: string, messages: ChatUIMessage[], title?: string) {
    await sessionRepository.saveUIMessages(conversationId, messages, title);
  }

  async finish(runId: string, status: "completed" | "failed" | "aborted", error?: string) {
    const existing = await prisma.threadRun.findUnique({ where: { id: runId } });
    if (!existing || !ACTIVE_RUN_STATUSES.includes(existing.status as typeof ACTIVE_RUN_STATUSES[number])) {
      return;
    }

    await prisma.threadRun.update({
      where: { id: runId },
      data: {
        status,
        error: error?.slice(0, 2_000),
        completedAt: new Date(),
      },
    });
  }

  async updateStatus(runId: string, status: "running" | "waiting_approval") {
    await prisma.threadRun.update({
      where: { id: runId },
      data: { status },
    });
  }

  abort(runId: string) {
    return this.activeRuns.get(runId)?.abort();
  }

  listForConversation(conversationId: string) {
    return prisma.threadRun.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });
  }

  find(id: string) {
    return prisma.threadRun.findUnique({
      where: { id },
      include: {
        approvals: { orderBy: { createdAt: "desc" }, take: 50 },
        events: { orderBy: { sequence: "asc" }, take: 200 },
      },
    });
  }
}

export const runService = new ThreadRunService();
