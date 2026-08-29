import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { taskService } from "../task-service.js";
import type { ToolDescriptor, ToolProvider } from "./registry.js";
import type { RunContext } from "./run-context.js";
import type { RuntimeTool } from "./types.js";

function createTaskTools(run: RunContext): Record<string, RuntimeTool> {
  const context = {
    conversationId: run.conversationId,
    ...(run.runId ? { runId: run.runId } : {}),
  };
  const taskId = z.string().regex(/^\d+$/).describe("Task ID, for example 1");

  return {
    TaskCreate: createTool({
      id: "TaskCreate",
      description:
        "Create a persistent task for a complex multi-step request. Check TaskList first for duplicates.",
      inputSchema: z.object({
        subject: z.string().min(1).max(300).describe("Short imperative title"),
        description: z.string().max(4_000).optional().describe("Requirements and acceptance criteria"),
        activeForm: z.string().max(200).optional().describe("Present-progressive status label"),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }).strict(),
      execute: async (input) => {
        try {
          const task = await taskService.create({ ...input, ...context });
          return { task };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskGet: createTool({
      id: "TaskGet",
      description: "Get one task, including its description, owner, and dependencies.",
      inputSchema: z.object({ taskId }).strict(),
      execute: async ({ taskId: id }) => {
        try {
          return { task: await taskService.get(context.conversationId, id) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskList: createTool({
      id: "TaskList",
      description: "List persistent tasks for this conversation.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        try {
          const tasks = await taskService.list(context.conversationId);
          return { count: tasks.length, tasks };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskUpdate: createTool({
      id: "TaskUpdate",
      description:
        "Update task status or details and add dependencies. Mark completed only after the work is verified.",
      inputSchema: z.object({
        taskId,
        subject: z.string().min(1).max(300).optional(),
        description: z.string().max(4_000).optional(),
        activeForm: z.string().max(200).optional(),
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        owner: z.string().max(120).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        addBlockedBy: z.array(taskId).max(100).optional(),
        addBlocks: z.array(taskId).max(100).optional(),
      }).strict(),
      execute: async ({ taskId: id, ...input }) => {
        try {
          return { task: await taskService.update(context.conversationId, id, input) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}

/** Persistent per-conversation task tools (Claude Code style todo list). */
export class TaskToolProvider implements ToolProvider {
  readonly id = "tasks";
  readonly label = "任务工具";

  listTools(): ToolDescriptor[] {
    const base = {
      risk: "low" as const,
      mutating: false,
      defaultPolicy: { enabled: true, requireApproval: false },
      providerId: this.id,
    };
    return [
      { ...base, name: "TaskCreate", label: "Create task", description: "Create a persistent conversation task." },
      { ...base, name: "TaskGet", label: "Get task", description: "Read one persistent conversation task." },
      { ...base, name: "TaskList", label: "List tasks", description: "List persistent conversation tasks." },
      { ...base, name: "TaskUpdate", label: "Update task", description: "Update persistent task details and dependencies." },
    ];
  }

  createTools(run: RunContext): Record<string, RuntimeTool> {
    // Task lists belong to the primary agent; sub-agents coordinate through it.
    if (run.subAgent) return {};
    return createTaskTools(run);
  }
}
