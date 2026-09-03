import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { RunContext } from "./run-context.js";
import type { ToolDescriptor, ToolProvider } from "./registry.js";
import type { DelegationRecord, RuntimeTool } from "./types.js";

/**
 * Delegate tool family (PI-Desktop ADR 0089 lifecycle):
 * Delegate starts a subagent in the background and returns immediately;
 * DelegateWait converges on running delegations; DelegateList reports;
 * DelegateStop stops. Only the delegate's final report re-enters the main
 * context, and the bridge caps that text — delegation must not become the
 * context problem it exists to avoid.
 */

const MAX_DELEGATE_WAIT_SECONDS = 900;

function formatRecord(record: DelegationRecord): string {
  const duration = record.completedAt
    ? ` (${Math.round((record.completedAt - record.startedAt) / 1000)}s)`
    : "";
  const error = record.error ? ` — ${record.error}` : "";
  const report = record.report.trim()
    ? `\n${record.report}`
    : record.status === "running"
      ? ""
      : "\n(no report)";
  return `## ${record.agentName} (${record.delegationId}) — ${record.status}${duration}${error}${report}`;
}

/** Sub-agent contexts get no delegation tools at all: a delegate is a bounded
 * worker, not a fan-out point. */
export class DelegationToolProvider implements ToolProvider {
  readonly id = "delegation";
  readonly label = "委派工具";

  listTools(): ToolDescriptor[] {
    return [
      {
        name: "Delegate",
        label: "Delegate",
        description: "Start a subagent in the background and return immediately.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "DelegateWait",
        label: "Delegate wait",
        description: "Wait for background delegations and return their reports.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "DelegateList",
        label: "Delegate list",
        description: "List this session's delegations with their status.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "DelegateStop",
        label: "Delegate stop",
        description: "Stop running delegations.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
    ];
  }

  createTools(run: RunContext): Record<string, RuntimeTool> {
    if (run.subAgent || !run.delegate) return {};

    const delegate = run.delegate;
    const catalog = delegate.catalog();
    const catalogText = catalog
      .map((entry) => `- ${entry.name} (tools: ${entry.tools.join(", ")}): ${entry.description}`)
      .join("\n");

    const delegateTool: RuntimeTool = createTool({
      id: "Delegate",
      description:
        "Start one subagent in the background and return immediately; keep working on your own line, then converge with DelegateWait when you need the report. " +
        "Use it when the work is separable: parallel exploration of independent directions (one Delegate call per direction in the same assistant message), a multi-file implementation with a complete spec, an adversarial review of a change you just made, or a wide search / long log whose intermediate output would fill this context. " +
        "Do not delegate what you can finish in a couple of tool calls, and do not delegate anything that needs the user — a subagent cannot ask questions on your behalf. " +
        "`task` is the delegate's only instruction: it cannot see this conversation, so state the goal, the paths and facts it cannot infer, and exactly what to report back. " +
        "Never end the turn with subagents still running: wait with DelegateWait or stop them with DelegateStop." +
        (catalogText ? `\n\nAvailable subagents:\n${catalogText}` : ""),
      inputSchema: z.object({
        agent: z.string().describe("Name of the subagent to run."),
        task: z
          .string()
          .min(1)
          .describe("The complete brief: goal, context the delegate cannot infer, and the exact report you want back."),
        description: z.string().optional().describe("Short label for this delegation (3-6 words), shown to the user."),
      }),
      execute: async ({ agent, task, description }) => {
        const started = await delegate.start(agent, task.trim(), description?.trim() || undefined);
        if (!started.ok) return { error: started.error };
        return {
          delegationId: started.delegationId,
          status: "running",
          message: `Delegation ${started.delegationId} started. Continue your own independent work, then call DelegateWait with this delegationId to converge, or DelegateStop to stop it.`,
        };
      },
    });

    const delegateWait: RuntimeTool = createTool({
      id: "DelegateWait",
      description:
        'Wait for one or more subagents started by Delegate and return their reports. `delegationIds` defaults to every running subagent; use mode "any" with minCompleted to converge as soon as the first (or first N) finish. Settled delegations return immediately, so re-reading a report by id is cheap. Never end the turn with subagents still running.',
      inputSchema: z.object({
        delegationIds: z.array(z.string()).optional().describe("Defaults to all running subagents."),
        mode: z.enum(["all", "any"]).optional(),
        minCompleted: z.number().int().min(1).optional(),
        timeoutSeconds: z.number().int().min(1).max(MAX_DELEGATE_WAIT_SECONDS).optional(),
      }),
      execute: async (input) => {
        const result = await delegate.wait(input);
        const parts = [
          result.note,
          ...result.delegations.map(formatRecord),
        ].filter((part) => part && part.trim());
        return {
          note: result.note ?? null,
          unknownIds: result.unknownIds ?? [],
          delegations: result.delegations.map((record) => ({
            delegationId: record.delegationId,
            agent: record.agentName,
            status: record.status,
          })),
          report: parts.join("\n\n") || "No matching delegations.",
        };
      },
    });

    const delegateList: RuntimeTool = createTool({
      id: "DelegateList",
      description:
        "List the subagents started in this session with their status. Use it to check progress without waiting, or before DelegateStop to choose what to stop.",
      inputSchema: z.object({}),
      execute: async () => {
        const records = delegate.list();
        if (records.length === 0) {
          return { delegations: [], summary: "No subagents have been started in this session." };
        }
        return {
          delegations: records.map((record) => ({
            delegationId: record.delegationId,
            agent: record.agentName,
            status: record.status,
          })),
          summary: records
            .map(
              (record) =>
                `- ${record.delegationId} ${record.agentName}: ${record.status}`,
            )
            .join("\n"),
        };
      },
    });

    const delegateStop: RuntimeTool = createTool({
      id: "DelegateStop",
      description:
        "Stop one or more running subagents. `delegationIds` defaults to every running subagent. Stopped subagents report as stopped; their partial work is lost.",
      inputSchema: z.object({
        delegationIds: z.array(z.string()).optional(),
      }),
      execute: async ({ delegationIds }) => {
        const stopped = delegate.stop(delegationIds?.length ? delegationIds : undefined);
        return {
          stopped,
          message:
            stopped === 0
              ? "No matching running subagents to stop."
              : `Stopped ${stopped} subagent${stopped === 1 ? "" : "s"}.`,
        };
      },
    });

    return {
      Delegate: delegateTool,
      DelegateWait: delegateWait,
      DelegateList: delegateList,
      DelegateStop: delegateStop,
    };
  }
}
