import { Hono } from "hono";
import { agentDefinitions } from "../runtime/agents.js";

export const agentRoutes = new Hono();

agentRoutes.get("/", (c) => {
  return c.json({
    agents: agentDefinitions.map(({ id, name, description }) => ({ id, name, description })),
  });
});
