import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import { PROVIDER_TYPES } from "../providers/provider-types.js";
import {
  createProvider,
  deleteProvider,
  fetchRemoteModels,
  listProviders,
  updateProvider,
} from "../providers/provider-service.js";

export const providerRoutes = new Hono();

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  isCustom: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  release_date: z.string().optional(),
  limit: z
    .object({ context: z.number().optional(), output: z.number().optional() })
    .optional(),
  modalities: z
    .object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() })
    .optional(),
});

const providerInputSchema = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.string().trim().min(1).max(64),
  apiBase: z.string().trim().min(1),
  apiKey: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  models: z.array(modelSchema).optional(),
});

providerRoutes.get("/", async (c) => {
  return c.json({ providers: await listProviders() });
});

providerRoutes.get("/types", (c) => {
  return c.json({ types: PROVIDER_TYPES });
});

providerRoutes.post("/fetch-models", async (c) => {
  const body = z
    .object({ apiBase: z.string().trim().min(1), apiKey: z.string().optional().nullable() })
    .parse(await c.req.json());
  const models = await fetchRemoteModels(body.apiBase, body.apiKey);
  return c.json({ models });
});

providerRoutes.post("/:id/fetch-models", async (c) => {
  const provider = await prisma.provider.findUnique({ where: { id: c.req.param("id") } });
  if (!provider) return c.json({ error: "Provider not found" }, 404);
  const models = await fetchRemoteModels(provider.apiBase, provider.apiKey);
  return c.json({ models });
});

providerRoutes.post("/", async (c) => {
  const input = providerInputSchema.parse(await c.req.json());
  return c.json({ provider: await createProvider(input) }, 201);
});

providerRoutes.put("/:id", async (c) => {
  const input = providerInputSchema.partial().parse(await c.req.json());
  return c.json({ provider: await updateProvider(c.req.param("id"), input) });
});

providerRoutes.delete("/:id", async (c) => {
  await deleteProvider(c.req.param("id"));
  return c.json({ ok: true });
});
