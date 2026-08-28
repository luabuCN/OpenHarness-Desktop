import { Hono } from "hono";
import { z } from "zod";
import { TASK_STATUSES, TaskServiceError, taskService } from "../runtime/task-service.js";

const updateTaskSchema = z.object({
  subject: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(4_000).optional(),
  activeForm: z.string().trim().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  owner: z.string().trim().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  addBlockedBy: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  addBlocks: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
}).strict();

export const taskRoutes = new Hono();

taskRoutes.get("/:id/tasks", async (c) => {
  const tasks = await taskService.list(c.req.param("id"));
  return c.json({ tasks });
});

taskRoutes.get("/:id/tasks/:taskId", async (c) => {
  try {
    const task = await taskService.get(c.req.param("id"), c.req.param("taskId"));
    return c.json({ task });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      return c.json({ error: error.message }, error.httpStatus);
    }
    throw error;
  }
});

taskRoutes.patch("/:id/tasks/:taskId", async (c) => {
  const input = updateTaskSchema.parse(await c.req.json());
  try {
    const task = await taskService.update(
      c.req.param("id"),
      c.req.param("taskId"),
      input,
    );
    return c.json({ task });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      return c.json({ error: error.message }, error.httpStatus);
    }
    throw error;
  }
});
