import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { chatRoutes } from "./routes/chat.js";
import { fileRoutes } from "./routes/files.js";
import { healthRoutes } from "./routes/health.js";
import { providerRoutes } from "./routes/providers.js";
import { sessionRoutes } from "./routes/sessions.js";

const allowedOrigins = new Set(
  [
    process.env.OPENHARNESS_ALLOWED_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
  ].filter((origin): origin is string => Boolean(origin)),
);

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
    credentials: true,
  }),
);

app.onError((error, c) => {
  console.error(error);
  if (error instanceof ZodError) {
    return c.json({ error: "Invalid request", details: error.issues }, 400);
  }
  return c.json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
});

app.route("/health", healthRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/providers", providerRoutes);
app.route("/api/chat", chatRoutes);
