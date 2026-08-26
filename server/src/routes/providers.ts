import { Hono } from "hono";
import { z } from "zod";
import { PROVIDER_TYPES } from "../providers/provider-types.js";
import {
  createProvider,
  deleteProvider,
  fetchRemoteModels,
  getDefaultModelSetting,
  listProviders,
  setDefaultModelSetting,
  updateProvider,
} from "../providers/provider-service.js";

export const providerRoutes = new Hono();

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
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

providerRoutes.get("/default-model", async (c) => {
  return c.json({ setting: await getDefaultModelSetting() });
});

providerRoutes.put("/default-model", async (c) => {
  const body = z
    .object({ providerId: z.string().min(1), modelId: z.string().min(1) })
    .nullable()
    .parse(await c.req.json());
  await setDefaultModelSetting(body);
  return c.json({ ok: true });
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
